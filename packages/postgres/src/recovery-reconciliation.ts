import {canonical} from '../../domain/src/index.js';
import {RecoveryError} from '../../recovery/src/guard.js';
import {identifier} from './config.js';
import {nativeRuntimeCatalog} from './runtime-database.js';
import {nativeRecoverySnapshot,recoveryConnectionHash} from './recovery-snapshot.js';
import {recoveryCheckDefinition} from './recovery-catalog.js';
import {journalTargetIdentity} from './recovery-journal-identity.js';
import {nativeRecoveryJournalCheckpoint} from './recovery-journal-checkpoint.js';
import {journalDigest} from './recovery-journal-format.js';
import type {NativeJournalPlanOptions,VerifiedJournalContext} from './recovery-journal-plan.js';

export interface NativeRecoveryReconciliationOptions extends NativeJournalPlanOptions {planId:string}
export async function lockRecoveryReconciliation(context:VerifiedJournalContext,input:NativeRecoveryReconciliationOptions,family:'privacy'|'authority'='privacy'){
 const fail=(code:string,message:string)=>new RecoveryError('PG_RECOVERY_'+family.toUpperCase()+'_'+code,message);const migration=family==='privacy'?'127-native-recovery-privacy.sql':'128-native-recovery-authority.sql';
 const{client,policy,previous,head,headBytes,cap}=context;
 if(!previous||previous.id!==input.planId||Number(previous.generation)!==head.metadata.generation||previous.head_sha256!==journalDigest(headBytes))throw fail('PLAN_STALE','此计划不是当前完整日志的最新固定计划，请重新生成并预览。');
 if(policy.quarantineCatalogAlgorithm!=='check-bool-function-identity-v2'||!policy.quarantineCatalogSHA256)throw fail('CATALOG_REQUIRED','恢复副本缺少恢复完成时固定的隔离结构摘要；请使用当前恢复工具验证新的独立副本。');
 if(!(await client.query('SELECT 1 FROM _dg_postgres_migrations WHERE name=$1',[migration])).rowCount)throw fail('MIGRATION_REQUIRED','此备份缺少该恢复操作要求的审计或准确依赖规则，请使用包含相应迁移的备份。');
 context.phase(family+'_before_locks');
 const names=(await client.query<{tablename:string}>('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename COLLATE "C"',[policy.schema])).rows;
 if(!names.length||names.length>Math.min(cap.maxFiles,2048))throw fail('LIMIT_EXCEEDED','恢复表数量超过当前核对容量。');
 await client.query('LOCK TABLE '+names.map(t=>identifier(policy.schema)+'.'+identifier(t.tablename)).join(',')+' IN SHARE ROW EXCLUSIVE MODE');await client.query('LOCK TABLE public._dg_native_recovery_control IN SHARE ROW EXCLUSIVE MODE');
 await journalTargetIdentity(client,input.loader,input.dataDir,policy);
 const base=await nativeRecoveryJournalCheckpoint(client,policy.schema,cap,input.signal),latest=(await client.query('SELECT id,head_sha256 FROM _dg_native_recovery_journal_plans WHERE backup_id=$1 AND stream_id=$2 ORDER BY generation DESC LIMIT 1',[policy.backupId,context.identity.streamId])).rows[0];if(!base||base.eventCount!==policy.recoveryJournal.eventCount||base.eventSetSHA256!==policy.recoveryJournal.eventSetSHA256||latest?.id!==previous.id||latest.head_sha256!==previous.head_sha256)throw fail('TARGET_CHANGED','等待资料锁期间原日志或计划发生变化，拒绝旧清理依据。');
 if(await nativeRuntimeCatalog(client,policy.schema,recoveryCheckDefinition,true)!==policy.quarantineCatalogSHA256)throw fail('CATALOG_CHANGED','恢复后的表、函数、约束或权限已变化，拒绝在未知结构上清理。');
 return previous;
}
export async function recoveryDatabaseDigest(context:VerifiedJournalContext,input:NativeRecoveryReconciliationOptions){
 const{client,policy,cap}=context,control=(await client.query('SELECT app_env,app_role,worker_role,current_user owner FROM _dg_native_runtime_control WHERE id=1')).rows[0],snapshot=await nativeRecoverySnapshot(client,policy.schema,{runtimeId:policy.runtimeId,appEnv:control.app_env,ownerRole:control.owner,apiRole:control.app_role,workerRole:control.worker_role,sourceConnectionSHA256:recoveryConnectionHash(input.loader),recoveryCatalogAlgorithm:'check-bool-function-identity-v2'},cap,input.signal);
 return journalDigest(canonical({tables:snapshot.tables,sequences:snapshot.sequences,migrations:snapshot.migrations,catalog:snapshot.recoveryCatalogSHA256}));
}
