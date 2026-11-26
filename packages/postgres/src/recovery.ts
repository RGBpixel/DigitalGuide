import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import type pg from 'pg';
import {RecoveryError,recoveryEntryExists,recoveryPolicyFile} from '../../recovery/src/guard.js';
import {withRecoveryOperation,inspectRecoveryLock,unlockRecovery,type RecoveryOptions} from '../../recovery/src/index.js';
import {assertNoLinks,dataRoot,within,inventory,copyChecked,hashFile,limits,checkCancelled,type RecoveryLimits} from '../../recovery/src/files.js';
import {readRecoveryKey,encryptArchive,decryptArchive,inspectArchiveZip} from '../../recovery/src/codec.js';
import {createPostgresClient,parseConnectionConfig,identifier,PostgresMigrationError,type PostgresConnectionConfig} from './config.js';
import {loadNativeRuntimeConfig,assertNativeRuntimeDirectory,runtimeDataHash,type NativeRuntimeConfig} from './runtime-config.js';
import {nativeRuntimeMigrations,nativeRuntimeCatalog} from './runtime-database.js';
import {nativeRecoverySnapshot,recoveryConnectionHash} from './recovery-snapshot.js';
import {validateNativeRecoveryManifest,type NativeRecoveryManifest} from './recovery-manifest.js';
import {nativeRecoveryTools,runNativeRecoveryTool,type NativeRecoveryTools} from './recovery-tools.js';
import {nativeRecoverySnapshotsEqual} from './recovery-catalog.js';
import {recoveryCheckDefinition} from './recovery-catalog.js';

export interface NativeRecoveryOptions extends RecoveryOptions {toolsDir?:string}
export interface NativeArchiveOptions extends NativeRecoveryOptions {archive:string;workDir?:string}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function privateJSON(file:string,value:unknown){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function outside(key:string,dir:string){const f=path.resolve(key);assertNoLinks(f);if(within(f,dir))throw new RecoveryError('PG_RECOVERY_KEY_LOCATION','加密备份密钥必须在业务数据目录之外。');return f;}
function safeFailure(error:unknown):never{
 if(error instanceof RecoveryError||error instanceof PostgresMigrationError)throw error;
 throw new RecoveryError('PG_RECOVERY_OPERATION_FAILED','原生备份或隔离恢复失败。请检查私有配置、数据库角色、停机状态、锁与容量；未启用恢复副本，不打印原始数据或凭据。');
}
async function server(client:pg.Client){const row=(await client.query("SELECT current_user role,current_setting('server_encoding') encoding,current_setting('server_version_num') version,(SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user) elevated,pg_is_in_recovery() replica")).rows[0];if(row.elevated||row.encoding!=='UTF8'||Number(row.version)<180000||Number(row.version)>=190000||row.replica)throw new RecoveryError('PG_RECOVERY_ROLE_INVALID','备份恢复需要PostgreSQL18/UTF8、非集群管理账号及可写的独立目标；不会使用超级用户或只读副本。');return row;}
async function businessRoles(client:pg.Client,owner:string,api:string,worker:string){
 const roles=(await client.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])',[[owner,api,worker]])).rows;
 if(new Set([owner,api,worker]).size!==3||roles.length!==3||roles.some(r=>r.rolsuper||r.rolcreatedb||r.rolcreaterole||r.rolreplication||r.rolbypassrls))throw new RecoveryError('PG_RECOVERY_ROLE_INVALID','恢复需要原三个分离的非集群管理角色；不会创建、降级或修改全局角色。');
 for(const[a,b]of [[api,owner],[worker,owner],[api,worker],[worker,api]])if((await client.query('SELECT pg_has_role($1,$2,$3) member',[a,b,'MEMBER'])).rows[0].member)throw new RecoveryError('PG_RECOVERY_ROLE_INVALID','业务角色不能继承运维角色或相互权限。');
}
async function sourceIdentity(client:pg.Client,c:NativeRuntimeConfig,loader:PostgresConnectionConfig,root:string){
 const s=await server(client);await client.query('SET LOCAL search_path TO '+identifier(c.schema)+',pg_catalog,pg_temp');
 const control=(await client.query('SELECT * FROM _dg_native_runtime_control WHERE id=1')).rows[0],owner=(await client.query('SELECT pg_get_userbyid(nspowner) role FROM pg_namespace WHERE nspname=$1',[c.schema])).rows[0]?.role;
 if(owner!==s.role||owner!==loader.user||!control||control.status!=='validation_only'||control.runtime_id!==c.runtimeId||control.purpose!==c.purpose||control.environment!=='mock'||control.app_env!==c.appEnv||control.data_dir_sha256!==runtimeDataHash(c.dataDir)||control.app_role!==c.connection.user)throw new RecoveryError('PG_RECOVERY_SOURCE_IDENTITY','源实例、所有者、用途、数据目录或当前业务状态不匹配。');
 const worker=loadNativeRuntimeConfig(path.join(c.dataDir,'worker.json'));if(worker.runtimeId!==c.runtimeId||worker.schema!==c.schema||worker.dataDir!==c.dataDir||worker.appEnv!==c.appEnv||worker.connection.user!==control.worker_role||worker.connection.host!==c.connection.host||worker.connection.port!==c.connection.port||worker.connection.database!==c.connection.database)throw new RecoveryError('PG_RECOVERY_SOURCE_IDENTITY','原生worker配置与源数据库不匹配。');
 await businessRoles(client,owner,control.app_role,control.worker_role);
 if((await client.query('SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND usename=ANY($1::text[])',[[owner,control.app_role,control.worker_role]])).rowCount)throw new RecoveryError('PG_RECOVERY_SOURCE_BUSY','源API、worker或其他运维连接仍存在。请停止相关服务和连接后重试，不会强制停机。');
 const actual=(await client.query('SELECT name,sha256 FROM _dg_postgres_migrations ORDER BY name')).rows;if(!equal(actual,nativeRuntimeMigrations(root).migrations)||await nativeRuntimeCatalog(client,c.schema)!==control.catalog_sha256)throw new RecoveryError('PG_RECOVERY_SOURCE_CHANGED','源迁移、结构、权限或约束与受审查实例不匹配。');
 return{runtimeId:c.runtimeId,appEnv:c.appEnv,ownerRole:owner as string,apiRole:control.app_role as string,workerRole:control.worker_role as string,sourceConnectionSHA256:recoveryConnectionHash(loader)};
}
function report(m:NativeRecoveryManifest,info:{archiveSHA256:string;archiveBytes:number}){return{result:'PASS' as const,format:m.format,backupId:m.backupId,...info,tableCount:m.database.tables.length,rows:m.database.rows,fileCount:m.files.length,latestMigration:m.database.migrations.at(-1)!.name,activation:'isolated-validation-only' as const,databaseRestoreVerified:false,productionRecoveryAccepted:false};}
function matchingTools(m:NativeRecoveryManifest,t:NativeRecoveryTools){if(m.tools.pgDumpSHA256!==t.pgDumpSHA256||m.tools.pgRestoreSHA256!==t.pgRestoreSHA256)throw new RecoveryError('PG_RECOVERY_TOOLS_CHANGED','归档记录的工具集与当前固定工具不一致，请使用兼容的受审查工具。');}
async function archiveContents(input:NativeArchiveOptions,key:Buffer,lock:string,cap:RecoveryLimits,materialize:boolean,tools:NativeRecoveryTools){
 const zip=path.join(lock,'archive.zip'),info=await decryptArchive(path.resolve(input.archive),zip,key,cap,input.signal),data=path.join(lock,'data');fs.mkdirSync(data,{mode:0o700});
 const m=await inspectArchiveZip(zip,data,cap,materialize,(value,limit)=>validateNativeRecoveryManifest(value,limit,input.root||process.cwd()),input.signal,['database.pgdump']);matchingTools(m,tools);
 await runNativeRecoveryTool(tools,'restore',['--list',path.join(data,'database.pgdump')],lock,undefined,input.signal);return{m,data,info};
}
export async function createNativeRecoveryBackup(input:NativeRecoveryOptions&{configFile:string;loader:PostgresConnectionConfig;output:string;confirmedStopped:boolean}){
 if(!input.confirmedStopped)throw new RecoveryError('PG_RECOVERY_STOP_CONFIRMATION_REQUIRED','请明确确认源API、worker及文件写入进程已停止，再执行备份；工具不会停止现有工作台。');
 const c=loadNativeRuntimeConfig(input.configFile);assertNativeRuntimeDirectory(c);const source=dataRoot(c.dataDir,true),loader=parseConnectionConfig(input.loader),output=path.resolve(input.output),cap=limits(input.limits),root=input.root||process.cwd();
 if(loader.host!==c.connection.host||loader.port!==c.connection.port||loader.database!==c.connection.database||loader.user===c.connection.user)throw new RecoveryError('PG_RECOVERY_SOURCE_IDENTITY','运维连接须与API分离，并指向同一显式源数据库。');
 const keyFile=outside(input.keyFile,source);if(within(output,source))throw new RecoveryError('PG_RECOVERY_OUTPUT_LOCATION','加密备份必须位于业务数据目录之外。');assertNoLinks(output,true);if(recoveryEntryExists(output))throw new RecoveryError('PG_RECOVERY_OUTPUT_EXISTS','备份输出已存在，不能覆盖。');fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
 const tools=await nativeRecoveryTools(input.toolsDir),key=readRecoveryKey(keyFile);let partial:string|undefined;
 try{return await withRecoveryOperation(source,'backup',input,async(lock,phase)=>{
  const client=createPostgresClient(loader);let transaction=false;
  try{
   await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');transaction=true;await client.query("SET LOCAL idle_in_transaction_session_timeout='10min'");
   const metadata=await sourceIdentity(client,c,loader,root),names=(await client.query<{tablename:string}>('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename COLLATE "C"',[c.schema])).rows;
   if(!(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',['digitalguide-native-bootstrap:'+c.schema])).rows[0].locked)throw new RecoveryError('PG_RECOVERY_SOURCE_BUSY','源实例有其他受控维护操作。');
   try{await client.query('LOCK TABLE '+names.map(r=>identifier(c.schema)+'.'+identifier(r.tablename)).join(',')+' IN SHARE MODE NOWAIT');}catch{throw new RecoveryError('PG_RECOVERY_SOURCE_BUSY','源业务表仍有写入或结构维护，请停止相关连接后重试。');}
   phase('database_snapshot');const database=await nativeRecoverySnapshot(client,c.schema,metadata,cap,input.signal),snapshot=(await client.query('SELECT pg_export_snapshot() snapshot')).rows[0].snapshot as string;
   const data=path.join(lock,'data'),runtime=path.join(data,'runtime');fs.mkdirSync(runtime,{recursive:true,mode:0o700});const before=inventory(source,cap);
   phase('database_dump');const dump=path.join(data,'database.pgdump');await runNativeRecoveryTool(tools,'dump',['--format=custom','--compress=0','--no-password','--strict-names','--schema='+c.schema,'--snapshot='+snapshot,'--file='+dump,'--dbname='+loader.database],lock,loader,input.signal);
   phase('private_files_snapshot');const files:NativeRecoveryManifest['files']=[{path:'database.pgdump',bytes:fs.statSync(dump).size,sha256:await hashFile(dump,input.signal)}],directories=['runtime',...before.directories.map(d=>'runtime/'+d)];for(const d of before.directories)fs.mkdirSync(path.join(runtime,...d.split('/')),{recursive:true,mode:0o700});
   for(const f of before.files){checkCancelled(input.signal);const file=await copyChecked(f,path.join(runtime,...f.relative.split('/')),input.signal);files.push({...file,path:'runtime/'+file.path});}
   if(!equal(before,inventory(source,cap)))throw new RecoveryError('PG_RECOVERY_SOURCE_CHANGED','备份期间源文件清单或元数据变化，未发布归档。');
   for(const f of before.files)if(await hashFile(f.absolute,input.signal)!==files.find(x=>x.path==='runtime/'+f.relative)!.sha256)throw new RecoveryError('PG_RECOVERY_SOURCE_CHANGED','备份期间源文件内容变化，未发布归档。');
   await client.query('COMMIT');transaction=false;
   const m=validateNativeRecoveryManifest({version:1,format:'postgres-native-local-v1',backupId:randomUUID(),createdAt:new Date().toISOString(),platform:process.platform,dataRoot:source,files,directories,database,tools:{major:18,pgDumpSHA256:tools.pgDumpSHA256,pgRestoreSHA256:tools.pgRestoreSHA256},activation:'isolated-validation-only'},cap,root);
   const operationId=JSON.parse(fs.readFileSync(path.join(lock,'state.json'),'utf8')).operationId as string;
   partial=path.join(path.dirname(output),'.'+path.basename(output)+'.partial-'+operationId);phase('encrypting',{encryptedPartial:partial});await encryptArchive(m,data,partial,key,input.signal);
   phase('readback_verification');const zip=path.join(lock,'readback.zip'),info=await decryptArchive(partial,zip,key,cap,input.signal),readback=await inspectArchiveZip(zip,path.join(lock,'unused'),cap,false,(value,limit)=>validateNativeRecoveryManifest(value,limit,root),input.signal);if(!equal(readback,m))throw new RecoveryError('PG_RECOVERY_MANIFEST_CHANGED','加密归档回读清单不一致。');
   phase('publishing');try{fs.linkSync(partial,output);}catch{throw new RecoveryError('PG_RECOVERY_OUTPUT_EXISTS','备份输出无法独占发布，未覆盖任何现有文件。');}fs.unlinkSync(partial);partial=undefined;return{...report(m,info),sourceStoppedRequired:true,sourceDatabaseChanged:false};
  }finally{if(transaction)await client.query('ROLLBACK').catch(()=>undefined);await client.end();}
 });}catch(error){safeFailure(error);}finally{key.fill(0);if(partial&&fs.existsSync(partial)){assertNoLinks(partial);fs.unlinkSync(partial);}}
}
function verificationResource(archive:string,workDir?:string){const dir=path.resolve(workDir||os.tmpdir());assertNoLinks(dir);if(!fs.statSync(dir).isDirectory())throw new RecoveryError('PG_RECOVERY_WORKSPACE_INVALID','验证工作目录必须已存在。');return path.join(dir,'.pg-verify-'+createHash('sha256').update(path.resolve(archive)).digest('hex').slice(0,24));}
export async function verifyNativeRecoveryBackup(input:NativeArchiveOptions){
 const cap=limits(input.limits),tools=await nativeRecoveryTools(input.toolsDir),key=readRecoveryKey(input.keyFile);
 try{return await withRecoveryOperation(verificationResource(input.archive,input.workDir),'verify',input,async(lock,phase)=>{phase('authenticating');const{m,info}=await archiveContents(input,key,lock,cap,false,tools);phase('verified');return report(m,info);});}catch(error){safeFailure(error);}finally{key.fill(0);}
}
async function fenceTarget(client:pg.Client,loader:PostgresConnectionConfig,m:NativeRecoveryManifest,archiveSHA256:string){
 const s=await server(client),db=m.database;if(s.role!==db.ownerRole||loader.user!==db.ownerRole)throw new RecoveryError('PG_RECOVERY_TARGET_OWNER','目标需要原所有者角色，以保持权限摘要；不自动创建或修改全局角色。');await businessRoles(client,db.ownerRole,db.apiRole,db.workerRole);
 const owner=(await client.query('SELECT pg_get_userbyid(datdba) role FROM pg_database WHERE datname=current_database()')).rows[0]?.role;if(owner!==s.role)throw new RecoveryError('PG_RECOVERY_TARGET_OWNER','目标必须是此运维角色拥有的独立新数据库。');
 if((await client.query("SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema','public') UNION ALL SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' LIMIT 1")).rowCount)throw new RecoveryError('PG_RECOVERY_TARGET_NOT_EMPTY','目标数据库含已有对象，不能覆盖、合并或重试恢复；请保留现场并使用独立空库。');
 if((await client.query('SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')).rowCount)throw new RecoveryError('PG_RECOVERY_TARGET_BUSY','目标数据库仍有其他连接，不能恢复。');
 await client.query('REVOKE CONNECT ON DATABASE '+identifier(loader.database)+' FROM PUBLIC,'+identifier(db.apiRole)+','+identifier(db.workerRole));
 for(const role of [db.apiRole,db.workerRole])if((await client.query("SELECT has_database_privilege($1,current_database(),'CONNECT') allowed",[role])).rows[0].allowed)throw new RecoveryError('PG_RECOVERY_TARGET_PRIVILEGED','目标业务角色仍能经其他授权连接数据库，恢复已拒绝。');
 await client.query("CREATE TABLE public._dg_native_recovery_control(id integer PRIMARY KEY CHECK(id=1),backup_id text NOT NULL,archive_sha256 text NOT NULL,runtime_id text NOT NULL,schema_name text NOT NULL,status text NOT NULL CHECK(status IN ('restoring','quarantined','failed')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),failure_code text)");
 await client.query('REVOKE ALL ON TABLE public._dg_native_recovery_control FROM PUBLIC');await client.query("INSERT INTO public._dg_native_recovery_control(id,backup_id,archive_sha256,runtime_id,schema_name,status) VALUES(1,$1,$2,$3,$4,'restoring')",[m.backupId,archiveSHA256,db.runtimeId,db.schema]);
}
export async function restoreNativeRecoveryBackup(input:NativeArchiveOptions&{loader:PostgresConnectionConfig;dataDir:string;confirmed:boolean}){
 if(!input.confirmed)throw new RecoveryError('PG_RECOVERY_CONFIRMATION_REQUIRED','恢复需要明确确认；仅向独立空库和原绝对数据目录的空缺位置恢复，始终保持隔离。');
 const target=dataRoot(input.dataDir,false);if(recoveryEntryExists(target))throw new RecoveryError('PG_RECOVERY_TARGET_EXISTS','恢复数据目录必须不存在，不能覆盖或合并。');const loader=parseConnectionConfig(input.loader),cap=limits(input.limits),tools=await nativeRecoveryTools(input.toolsDir),key=readRecoveryKey(outside(input.keyFile,target));
 try{return await withRecoveryOperation(target,'restore',input,async(lock,phase)=>{
  phase('authenticating');const{m,data,info}=await archiveContents(input,key,lock,cap,true,tools),same=process.platform==='win32'?m.dataRoot.toLowerCase()===target.toLowerCase():m.dataRoot===target;if(!same)throw new RecoveryError('PG_RECOVERY_ROOT_MISMATCH','原生记录含绝对文件引用，必须恢复到备份中的原绝对数据目录；跨目录迁移仍待实现。');
  const client=createPostgresClient(loader);let transaction=false,fenced=false;
  try{
   await client.connect();if(!(await client.query("SELECT pg_try_advisory_lock(hashtextextended('digitalguide-native-recovery-target',0)) locked")).rows[0].locked)throw new RecoveryError('PG_RECOVERY_TARGET_BUSY','目标数据库有其他恢复操作。');
   phase('fencing_database');await client.query('BEGIN');transaction=true;await fenceTarget(client,loader,m,info.archiveSHA256);await client.query('COMMIT');transaction=false;fenced=true;
   phase('restoring_database');await runNativeRecoveryTool(tools,'restore',['--format=custom','--single-transaction','--exit-on-error','--no-password','--dbname='+loader.database,path.join(data,'database.pgdump')],lock,loader,input.signal);
   phase('validating_database');await client.query('BEGIN READ ONLY');transaction=true;const actual=await nativeRecoverySnapshot(client,m.database.schema,m.database,cap,input.signal);if(!nativeRecoverySnapshotsEqual(actual,m.database))throw new RecoveryError('PG_RECOVERY_DATABASE_CHANGED','恢复的表、行、序列、结构或权限摘要与备份不符，副本保持隔离。');await client.query('COMMIT');transaction=false;
   phase('quarantining_database');await client.query('BEGIN');transaction=true;await client.query('SET LOCAL search_path TO '+identifier(m.database.schema)+",pg_catalog,pg_temp; SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO,YMD'");
   await client.query('UPDATE '+identifier(m.database.schema)+"._dg_native_runtime_control SET status='recovery_quarantined' WHERE id=1 AND runtime_id=$1 AND status='validation_only'",[m.database.runtimeId]);
   await client.query('REVOKE USAGE ON SCHEMA '+identifier(m.database.schema)+' FROM PUBLIC,'+identifier(m.database.apiRole)+','+identifier(m.database.workerRole));
   for(const role of [m.database.apiRole,m.database.workerRole]){const row=(await client.query("SELECT has_database_privilege($1,current_database(),'CONNECT') db,has_schema_privilege($1,$2,'USAGE') schema",[role,m.database.schema])).rows[0];if(row.db||row.schema)throw new RecoveryError('PG_RECOVERY_TARGET_PRIVILEGED','恢复后业务访问仍未完全关闭，保留数据库隔离并拒绝文件发布。');}
   await client.query("UPDATE public._dg_native_recovery_control SET status='quarantined' WHERE id=1");const quarantineCatalogSHA256=await nativeRuntimeCatalog(client,m.database.schema,recoveryCheckDefinition,true);await client.query('COMMIT');transaction=false;
   const runtime=path.join(data,'runtime'),quarantine={version:1,purpose:'native-recovery-quarantined',runtimeId:m.database.runtimeId,schema:m.database.schema,dataDir:target,appEnv:m.database.appEnv,targetConnectionSHA256:recoveryConnectionHash(loader),backupId:m.backupId,activation:'pending-post-backup-business-reconciliation'};
   for(const n of ['api.json','worker.json','.dg-native-postgres.json']){fs.unlinkSync(path.join(runtime,n));privateJSON(path.join(runtime,n),{...quarantine,sourceFileSHA256:m.files.find(f=>f.path==='runtime/'+n)!.sha256});}
   const policy={version:1,complete:false,backupId:m.backupId,archiveSHA256:info.archiveSHA256,restoredAt:new Date().toISOString(),activation:'isolated-validation-only',database:'postgres',runtimeId:m.database.runtimeId,schema:m.database.schema,recoveryJournal:m.database.recoveryJournal??null,quarantineCatalogAlgorithm:'check-bool-function-identity-v2',quarantineCatalogSHA256,productionActivation:'pending-business-reconciliation'};
   phase('publishing');try{fs.mkdirSync(target,{mode:0o700});}catch{throw new RecoveryError('PG_RECOVERY_TARGET_EXISTS','恢复发布时目标被占用，没有覆盖现有目录。');}privateJSON(path.join(target,recoveryPolicyFile),policy);
   for(const entry of fs.readdirSync(runtime))fs.renameSync(path.join(runtime,entry),path.join(target,entry));
   const final=path.join(target,'.recovery-policy-'+randomUUID()+'.tmp');privateJSON(final,{...policy,complete:true});fs.renameSync(final,path.join(target,recoveryPolicyFile));return{...report(m,info),databaseRestoreVerified:true,databaseQuarantined:true,workerEnabled:false,liveActionsEnabled:false,configurationActivation:false,sourceDatabaseChanged:false};
  }catch(error){if(transaction){await client.query('ROLLBACK').catch(()=>undefined);transaction=false;}if(fenced)await client.query("UPDATE public._dg_native_recovery_control SET status='failed',failure_code=$1 WHERE id=1",[error instanceof RecoveryError?error.code:'PG_RECOVERY_RESTORE_FAILED']).catch(()=>undefined);throw error;}finally{if(transaction)await client.query('ROLLBACK').catch(()=>undefined);await client.end();}
 });}catch(error){safeFailure(error);}finally{key.fill(0);}
}
export function inspectNativeRecoveryLock(input:{dataDir?:string;archive?:string;workDir?:string}){return inspectRecoveryLock({dataDir:input.dataDir||verificationResource(input.archive||'',input.workDir)});}
export function unlockNativeRecovery(input:{dataDir?:string;archive?:string;workDir?:string;operationId:string}){return unlockRecovery({dataDir:input.dataDir||verificationResource(input.archive||'',input.workDir),operationId:input.operationId});}
