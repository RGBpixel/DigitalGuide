import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type pg from 'pg';
import {createPostgresClient,identifier,PostgresMigrationError,type PostgresConnectionConfig} from './config.js';
import {assertNativeRuntimeDirectory,runtimeDataHash,type NativeRuntimeConfig} from './runtime-config.js';
import {nativeRuntimeCatalog,nativeRuntimeMigrations} from './runtime-database.js';

// R-058/R-129: offline correction of the existing validation-only speaker schema.
// Deliberately limited to the reviewed 076 -> 077 function replacement. This is
// not a production activator or a general data-migration/backup bypass.
export async function nativeSpeakerUpgradeFingerprint(client:pg.Client,schema:string){
 const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename NOT IN('_dg_postgres_migrations','_dg_native_runtime_control') ORDER BY tablename",[schema])).rows as {tablename:string}[],out:Record<string,{rows:number;sha256:string}>={};
 for(const{tablename}of tables){const rows=(await client.query('SELECT to_jsonb(t)::text AS value FROM '+identifier(schema)+'.'+identifier(tablename)+' t ORDER BY to_jsonb(t)::text')).rows as {value:string}[],h=createHash('sha256');for(const row of rows)h.update(row.value+'\n');out[tablename]={rows:rows.length,sha256:h.digest('hex')};}return out;
}
export async function applyNativeSpeakerValidationCorrection(input:{config:NativeRuntimeConfig;loader:PostgresConnectionConfig;root?:string}){
 const{config,loader}=input,root=input.root??process.cwd(),loaded=nativeRuntimeMigrations(root),target=loaded.migrations.at(-1)!,prefix=loaded.migrations.slice(0,-1),error=(code:string,message:string):never=>{throw new PostgresMigrationError(code,message);};
 assertNativeRuntimeDirectory(config);
 if(target.name!=='077-native-speaker-known-grant-prelock.sql'||prefix.at(-1)?.name!=='076-native-speaker-ticket-trigger.sql')error('PG_RUNTIME_UPGRADE_SCOPE','本接续工具仅接受已审查的076到077修复。');
 if(loader.host!==config.connection.host||loader.port!==config.connection.port||loader.database!==config.connection.database||loader.user===config.connection.user)error('PG_RUNTIME_CONNECTION_MISMATCH','迁移账号须独立连接同一私有验证实例。');
 const keys=['.session-secret','.provenance-secret'].map(name=>({name,bytes:fs.readFileSync(path.join(config.dataDir,name))})),client=createPostgresClient(loader);let transaction=false;
 try{
  await client.connect();const role=(await client.query("SELECT current_user AS name,(SELECT usesuper FROM pg_user WHERE usename=current_user) AS superuser,current_setting('server_encoding') encoding,current_setting('server_version_num') version")).rows[0];
  if(role.superuser||role.encoding!=='UTF8'||Number(role.version)<180000)error('PG_RUNTIME_ROLE_INVALID','接续需要专用非超级用户迁移账号及PostgreSQL18/UTF8。');
  const owner=(await client.query('SELECT pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname=$1',[config.schema])).rows[0];if(owner?.owner!==role.name)error('PG_RUNTIME_ROLE_INVALID','迁移账号须拥有指定原生验证schema。');
  await client.query('BEGIN');transaction=true;await client.query("SET LOCAL lock_timeout='3s'");await client.query('SET LOCAL search_path TO '+identifier(config.schema)+',pg_catalog,pg_temp');
  if(!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',['digitalguide-native-upgrade:'+config.schema])).rows[0].locked)error('PG_RUNTIME_BUSY','原生验证实例正在接续，请等待当前操作结束。');
  if((await client.query('SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2',[config.schema,'_dg_import_control'])).rowCount)error('PG_IMPORTED_DATA_ISOLATED','迁移归档必须保持隔离，不能用此工具接续。');
  await client.query('LOCK TABLE _dg_native_runtime_control IN ACCESS EXCLUSIVE MODE');await client.query('LOCK TABLE _dg_postgres_migrations IN EXCLUSIVE MODE');
  const control=(await client.query('SELECT * FROM _dg_native_runtime_control WHERE id=1')).rows[0];
  if(!control||control.runtime_id!==config.runtimeId||control.purpose!=='native-application-validation-only'||control.status!=='validation_only'||control.environment!=='mock'||control.app_env!==config.appEnv||control.data_dir_sha256!==runtimeDataHash(config.dataDir)||role.name===control.app_role||role.name===control.worker_role)error('PG_RUNTIME_IDENTITY_MISMATCH','原schema、用途、数据目录或运行身份不匹配，未执行接续。');
  if((await client.query('SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename=ANY($1::text[]) AND pid<>pg_backend_pid() LIMIT 1',[[control.app_role,control.worker_role]])).rowCount)error('PG_RUNTIME_BUSY','API或worker仍连接该私有实例，请先停止相关验证进程。');
  const actual=(await client.query('SELECT name,sha256 FROM _dg_postgres_migrations ORDER BY name')).rows;
  if(JSON.stringify(actual)!==JSON.stringify(prefix)&&JSON.stringify(actual)!==JSON.stringify(loaded.migrations))error('PG_RUNTIME_MIGRATION_CHANGED','已有迁移不是受审查的原前缀，不能覆盖、跳过或重建。');
  const beforeCatalog=await nativeRuntimeCatalog(client,config.schema);if(beforeCatalog!==control.catalog_sha256)error('PG_RUNTIME_CATALOG_CHANGED','原目录、权限或约束已变化，接续已拒绝。');
  const before=await nativeSpeakerUpgradeFingerprint(client,config.schema),history=(await client.query('SELECT to_jsonb(t)::text value FROM _dg_postgres_migrations t ORDER BY name')).rows;
  const alreadyApplied=actual.length===loaded.migrations.length;
  if(!alreadyApplied){await client.query(loaded.sql.at(-1)!);await client.query('INSERT INTO _dg_postgres_migrations(name,sha256) VALUES($1,$2)',[target.name,target.sha256]);}
  const after=await nativeSpeakerUpgradeFingerprint(client,config.schema);if(JSON.stringify(after)!==JSON.stringify(before))error('PG_RUNTIME_UPGRADE_DATA_CHANGED','修复改变了原业务记录，已回滚；不能重置原时钟、状态、次数或数据。');
  const retained=(await client.query('SELECT to_jsonb(t)::text value FROM _dg_postgres_migrations t WHERE name<>$1 ORDER BY name',[target.name])).rows;if(JSON.stringify(retained)!==JSON.stringify(alreadyApplied?history.slice(0,-1):history))error('PG_RUNTIME_MIGRATION_CHANGED','原迁移行发生变化，已回滚。');
  const catalog=await nativeRuntimeCatalog(client,config.schema);if(!alreadyApplied)await client.query('UPDATE _dg_native_runtime_control SET catalog_sha256=$1 WHERE id=1',[catalog]);
  const current=(await client.query('SELECT * FROM _dg_native_runtime_control WHERE id=1')).rows[0],withoutCatalog=(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='catalog_sha256'));
  if(JSON.stringify(withoutCatalog(current))!==JSON.stringify(withoutCatalog(control)))error('PG_RUNTIME_IDENTITY_MISMATCH','原运行身份或用途改变，已回滚。');for(const key of keys)if(!fs.readFileSync(path.join(config.dataDir,key.name)).equals(key.bytes))error('PG_RUNTIME_DIRECTORY_MISMATCH','原私有密钥改变，未提交接续。');
  await client.query('COMMIT');transaction=false;return{result:alreadyApplied?'ALREADY_APPLIED':'APPLIED',schema:config.schema,runtimeId:config.runtimeId,migration:target.name,sha256:target.sha256,oldCatalogSHA256:beforeCatalog,catalogSHA256:catalog,preservedTables:Object.keys(before).length,preservedRows:Object.values(before).reduce((n,t)=>n+t.rows,0),businessBefore:before,businessAfter:after,originalMigrationRowsUnchanged:true,originalControlIdentityUnchanged:true,bothOriginalKeysUnchanged:true,originalClocksAndCountersUnchanged:true};
 }catch(error){if(transaction)try{await client.query('ROLLBACK');}catch{/* A disconnected transaction is never treated as success. */}throw error;}finally{await client.end();}
}
