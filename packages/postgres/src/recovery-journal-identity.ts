import path from 'node:path';
import type pg from 'pg';
import {z} from 'zod';
import {canonical} from '../../domain/src/index.js';
import {RecoveryError,recoveryPolicyFile} from '../../recovery/src/guard.js';
import {assertNoLinks,dataRoot,within} from '../../recovery/src/files.js';
import {identifier,type PostgresConnectionConfig} from './config.js';
import {nativeRuntimeCatalog,nativeRuntimeMigrations} from './runtime-database.js';
import {assertNativeRuntimeDirectory,runtimeDataHash,type NativeRuntimeConfig} from './runtime-config.js';
import {journalSHA,recoveryJournalCheckpointSchema,type RecoveryJournalCheckpoint} from './recovery-journal-format.js';
import {journalReadJSON,type JournalIdentity} from './recovery-journal-events.js';

export function journalStore(dataDir:string,storeDir:string,keyFile:string,mustExist:boolean,signerFile?:string){
 const store=dataRoot(storeDir,mustExist),data=path.resolve(dataDir);if(within(store,data)||within(data,store))throw new RecoveryError('PG_JOURNAL_STORE_LOCATION','独立日志库必须在DATA_DIR之外，且不能包含DATA_DIR。');
 for(const input of [keyFile,...(signerFile?[signerFile]:[])]){const file=path.resolve(input);assertNoLinks(file);if(within(file,data)||within(file,store))throw new RecoveryError('PG_JOURNAL_KEY_LOCATION','加密密钥与签名私钥必须独立于DATA_DIR和日志库。');}return store;
}
export async function journalServer(client:pg.Client,schema:string,loader:PostgresConnectionConfig){
 const s=(await client.query("SELECT current_user role,current_setting('server_encoding') encoding,current_setting('server_version_num') version,(SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user) elevated,pg_is_in_recovery() replica,(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=$1) owner",[schema])).rows[0];
 if(s.elevated||s.replica||s.encoding!=='UTF8'||Number(s.version)<180000||Number(s.version)>=190000||s.role!==loader.user||s.owner!==loader.user)throw new RecoveryError('PG_JOURNAL_OWNER_REQUIRED','日志运维需要PostgreSQL18/UTF8和此schema的独立非集群管理所有者。');await client.query('SET LOCAL search_path TO '+identifier(schema)+",pg_catalog,pg_temp; SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO,YMD'");
}
const coverageSchema=z.array(z.object({tableName:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),keys:z.array(z.string()).min(1),tracked:z.literal(true)}).strict()).min(1).max(2048);
export async function journalIdentity(client:pg.Client,runtimeId:string,schema:string,pinned?:RecoveryJournalCheckpoint):Promise<JournalIdentity>{
 const c=(await client.query("SELECT runtime_id,stream_id,public_key,coverage,coverage_sha256,coverage_sha256=encode(sha256(convert_to(coverage::text,'UTF8')),'hex') digest_valid FROM _dg_native_recovery_journal_control WHERE id=1")).rows[0],coverage=coverageSchema.safeParse(c?.coverage);if(!c||c.runtime_id!==runtimeId||!coverage.success||!c.digest_valid||canonical(c.coverage)!==canonical((await client.query('SELECT dg_native_recovery_journal_coverage() value')).rows[0].value))throw new RecoveryError('PG_JOURNAL_COVERAGE_INVALID','当前日志信任根或表捕获覆盖不完整。');
 const names=coverage.data.map(t=>t.tableName);if(new Set(names).size!==names.length||pinned&&(pinned.streamId!==c.stream_id||pinned.publicKey!==c.public_key||pinned.coverageSHA256!==c.coverage_sha256||pinned.trackedTables!==names.length))throw new RecoveryError('PG_JOURNAL_SCOPE_MISMATCH','恢复实例与备份固定的日志公钥、流或覆盖不符。');return{runtimeId,schema,streamId:c.stream_id,publicKey:c.public_key,coverageSHA256:c.coverage_sha256,tables:new Set(names)};
}
export async function journalSourceIdentity(client:pg.Client,c:NativeRuntimeConfig,loader:PostgresConnectionConfig,root:string){
 assertNativeRuntimeDirectory(c);if(loader.user===c.connection.user||loader.host.toLowerCase()!==c.connection.host.toLowerCase()||loader.port!==c.connection.port||loader.database!==c.connection.database)throw new RecoveryError('PG_JOURNAL_SOURCE_IDENTITY','日志运维连接必须属于同一数据库，且与API账号分离。');await journalServer(client,c.schema,loader);const control=(await client.query('SELECT * FROM _dg_native_runtime_control WHERE id=1')).rows[0];
 if(!control||control.runtime_id!==c.runtimeId||control.status!=='validation_only'||control.purpose!==c.purpose||control.environment!=='mock'||control.app_env!==c.appEnv||control.data_dir_sha256!==runtimeDataHash(c.dataDir)||control.app_role!==c.connection.user||control.worker_role===loader.user)throw new RecoveryError('PG_JOURNAL_SOURCE_IDENTITY','源实例身份、用途或业务状态不匹配。');
 if(canonical((await client.query('SELECT name,sha256 FROM _dg_postgres_migrations ORDER BY name')).rows)!==canonical(nativeRuntimeMigrations(root).migrations)||await nativeRuntimeCatalog(client,c.schema)!==control.catalog_sha256)throw new RecoveryError('PG_JOURNAL_SOURCE_CHANGED','源迁移、结构、权限或约束与受审查版本不匹配。');return journalIdentity(client,c.runtimeId,c.schema);
}
const policySchema=z.object({version:z.literal(1),complete:z.literal(true),backupId:z.uuid(),archiveSHA256:journalSHA,activation:z.literal('isolated-validation-only'),database:z.literal('postgres'),runtimeId:z.uuid(),schema:z.string().regex(/^dg_validation_[a-f0-9]{32}$/),recoveryJournal:recoveryJournalCheckpointSchema,quarantineCatalogAlgorithm:z.literal('check-bool-function-identity-v2').optional(),quarantineCatalogSHA256:journalSHA.optional(),productionActivation:z.literal('pending-business-reconciliation')}).refine(v=>Boolean(v.quarantineCatalogAlgorithm)===Boolean(v.quarantineCatalogSHA256));
export function journalRecoveryPolicy(dataDir:string){const parsed=policySchema.safeParse(journalReadJSON(path.join(dataDir,recoveryPolicyFile)));if(!parsed.success)throw new RecoveryError('PG_JOURNAL_BACKUP_CHECKPOINT_REQUIRED','此恢复副本缺少已验证的备份日志检查点，不能声称完成撤权或删除核对。');return parsed.data;}
export async function journalTargetIdentity(client:pg.Client,loader:PostgresConnectionConfig,dataDir:string,policy:ReturnType<typeof journalRecoveryPolicy>){
 await journalServer(client,policy.schema,loader);const control=(await client.query('SELECT * FROM _dg_native_runtime_control WHERE id=1')).rows[0],recovery=(await client.query('SELECT * FROM public._dg_native_recovery_control WHERE id=1')).rows[0];
 if(!control||control.runtime_id!==policy.runtimeId||control.status!=='recovery_quarantined'||control.data_dir_sha256!==runtimeDataHash(dataDir)||!recovery||recovery.status!=='quarantined'||recovery.backup_id!==policy.backupId||recovery.archive_sha256!==policy.archiveSHA256||recovery.runtime_id!==policy.runtimeId||recovery.schema_name!==policy.schema)throw new RecoveryError('PG_JOURNAL_TARGET_IDENTITY','恢复目录、数据库、备份编号或隔离状态不匹配。');
 for(const role of [control.app_role,control.worker_role]){const p=(await client.query("SELECT has_database_privilege($1,current_database(),'CONNECT') db,has_schema_privilege($1,$2,'USAGE') schema",[role,policy.schema])).rows[0];if(p.db||p.schema)throw new RecoveryError('PG_JOURNAL_TARGET_NOT_QUARANTINED','恢复副本仍有业务访问权限，拒绝记录核对计划。');}return journalIdentity(client,policy.runtimeId,policy.schema,policy.recoveryJournal);
}
