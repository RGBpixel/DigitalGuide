import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {RecoveryError} from '../../recovery/src/guard.js';
import {withRecoveryOperation,type RecoveryOptions} from '../../recovery/src/index.js';
import {limits,dataRoot,type RecoveryLimits} from '../../recovery/src/files.js';
import {readRecoveryKey} from '../../recovery/src/codec.js';
import {createPostgresClient,parseConnectionConfig,safePostgresError,type PostgresConnectionConfig} from './config.js';
import {journalTargetIdentity,journalRecoveryPolicy,journalStore} from './recovery-journal-identity.js';
import {journalReadJSON,openJournalPacket,readJournalEvents,checkJournalScope,requireJournalSuperset,type JournalIdentity} from './recovery-journal-events.js';
import {journalDigest,validateJournalHead,type JournalHead} from './recovery-journal-format.js';
import {nativeRecoveryJournalCheckpoint} from './recovery-journal-checkpoint.js';
import type {RecoveryJournalCheckpoint} from './recovery-journal-format.js';

export interface NativeJournalPlanOptions extends RecoveryOptions {loader:PostgresConnectionConfig;dataDir:string;storeDir:string}
export interface NativeJournalPlanSummary {table:string;category:'privacy'|'authority'|'business';operation:'I'|'U'|'D'|'T';events:number;records:number}
export interface StoredJournalPlan {id:string;backup_id:string;generation:string;head_sha256:string;packet_sha256:string;base_events:string;source_events:string;delta_events:string;summary:NativeJournalPlanSummary[];status:'pending'}
function planReport(row:StoredJournalPlan,reused:boolean){return{result:'PASS' as const,operation:'plan' as const,planId:row.id,backupId:row.backup_id,generation:Number(row.generation),headSHA256:row.head_sha256,packetSHA256:row.packet_sha256,baseEvents:Number(row.base_events),sourceEvents:Number(row.source_events),pendingEvents:Number(row.delta_events),summary:row.summary,status:row.status,reused,changesApplied:false,activationAllowed:false,productionFreshnessProven:false,witness:'local-offline-file' as const};}
export interface VerifiedJournalContext {client:pg.Client;policy:ReturnType<typeof journalRecoveryPolicy>;identity:JournalIdentity;head:JournalHead;headBytes:Buffer;base:RecoveryJournalCheckpoint;previous?:StoredJournalPlan;cap:RecoveryLimits;phase:(value:string)=>void}
async function checkWitnessChain(head:JournalHead,headBytes:Buffer,directory:string,previous:StoredJournalPlan|undefined,identity:JournalIdentity,cap:RecoveryLimits){
 const generation=head.metadata.generation,seen=previous?Number(previous.generation):0;if(generation<seen)throw new RecoveryError('PG_JOURNAL_WITNESS_STALE','此恢复副本已核对更新的见证代数，拒绝旧见证回放。');if(generation===seen){if(journalDigest(headBytes)!==previous!.head_sha256)throw new RecoveryError('PG_JOURNAL_HISTORY_FORK','同代日志见证头与既有恢复计划不符。');return;}
 if(generation-seen>cap.maxFiles)throw new RecoveryError('PG_JOURNAL_LIMIT_EXCEEDED','待核对的见证链超过容量。');let expected:string|null=previous?.head_sha256??null;for(let n=seen+1;n<=generation;n++){const file=path.join(directory,'heads',n+'.json');if(n!==generation&&!fs.existsSync(file))throw new RecoveryError('PG_JOURNAL_HISTORY_GAP','中间历史见证文件缺失，拒绝跳过验证。');const bytes=n===generation?headBytes:(journalReadJSON(file),fs.readFileSync(file)),h=n===generation?head:validateJournalHead(JSON.parse(bytes.toString('utf8')),identity.publicKey);checkJournalScope(h.metadata,identity);if(h.metadata.generation!==n||h.metadata.previousHeadSHA256!==expected)throw new RecoveryError('PG_JOURNAL_HISTORY_FORK','日志见证链缺失、跳代或分叉。');expected=journalDigest(bytes);}
}
async function stageEvents(client:pg.Client,events:string,head:JournalHead,identity:JournalIdentity,cap:RecoveryLimits,signal?:AbortSignal){
 await client.query('CREATE TEMP TABLE dg_journal_stage(id text COLLATE "C" PRIMARY KEY,event_hash text NOT NULL,payload jsonb NOT NULL) ON COMMIT DROP');let batch:{id:string;event_hash:string;payload:unknown}[]=[];const flush=async()=>{if(batch.length){await client.query('INSERT INTO pg_temp.dg_journal_stage SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(id text,event_hash text,payload jsonb)',[JSON.stringify(batch)]);batch=[];}};
 for await(const event of readJournalEvents(events,identity,head.metadata,cap,signal)){batch.push({id:event.payload.id,event_hash:event.eventHash,payload:event.payload});if(batch.length===256)await flush();}await flush();
 if((await client.query('SELECT 1 FROM _dg_native_recovery_journal_events b LEFT JOIN pg_temp.dg_journal_stage s ON s.id=b.id AND s.event_hash=b.event_hash WHERE s.id IS NULL LIMIT 1')).rowCount)throw new RecoveryError('PG_JOURNAL_HISTORY_GAP','外置日志缺少备份时已存在的记录，拒绝形成恢复核对计划。');
}
// Plan and privacy execution use the same authenticated set, target lock and
// transaction. No command may consume an unchecked staged log or release the
// witness lock between verification and its database effect.
export async function withVerifiedNativeRecoveryJournal<T>(input:NativeJournalPlanOptions,work:(context:VerifiedJournalContext)=>Promise<T>,options:{privacyLocks?:boolean}={}){
 const dataDir=dataRoot(input.dataDir,true),policy=journalRecoveryPolicy(dataDir),loader=parseConnectionConfig(input.loader),store=journalStore(dataDir,input.storeDir,input.keyFile,true),directory=path.join(store,policy.recoveryJournal.streamId),resource=path.join(directory,'head.json'),cap=limits(input.limits),key=readRecoveryKey(input.keyFile);
 try{return await withRecoveryOperation(resource,'verify',input,async(lock,phase)=>{
  phase('validating_journal_witness');const bytes=(journalReadJSON(resource),fs.readFileSync(resource)),head=validateJournalHead(JSON.parse(bytes.toString('utf8')),policy.recoveryJournal.publicKey),client=createPostgresClient(loader);let transaction=false;
  try{
   await client.connect();await client.query(options.privacyLocks?'BEGIN ISOLATION LEVEL READ COMMITTED':'BEGIN ISOLATION LEVEL REPEATABLE READ');transaction=true;if(!(await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('digitalguide-native-journal-plan',0)) locked")).rows[0].locked)throw new RecoveryError('PG_JOURNAL_TARGET_BUSY','此恢复副本已有其他核对操作。');
   const identity=await journalTargetIdentity(client,loader,dataDir,policy),base=await nativeRecoveryJournalCheckpoint(client,policy.schema,cap,input.signal);if(!base||base.eventCount!==policy.recoveryJournal.eventCount||base.eventSetSHA256!==policy.recoveryJournal.eventSetSHA256)throw new RecoveryError('PG_JOURNAL_BASE_CHANGED','恢复副本的原始日志集合已偏离备份检查点。');
   const previous=(await client.query<StoredJournalPlan>('SELECT * FROM _dg_native_recovery_journal_plans WHERE backup_id=$1 AND stream_id=$2 ORDER BY generation DESC LIMIT 1',[policy.backupId,identity.streamId])).rows[0];await checkWitnessChain(head,bytes,directory,previous,identity,cap);phase('authenticating_journal');const packet=await openJournalPacket(head,directory,key,path.join(lock,'current'),identity,cap,input.signal);
   if(previous&&Number(previous.generation)<head.metadata.generation){const file=path.join(directory,'heads',previous.generation+'.json'),oldHead=validateJournalHead(journalReadJSON(file),identity.publicKey);if(journalDigest(fs.readFileSync(file))!==previous.head_sha256||oldHead.packetSHA256!==previous.packet_sha256)throw new RecoveryError('PG_JOURNAL_HISTORY_FORK','先前已核对的见证头或包被替换。');const oldPacket=await openJournalPacket(oldHead,directory,key,path.join(lock,'previous'),identity,cap,input.signal);await requireJournalSuperset(oldPacket.events,oldHead.metadata,packet.events,head.metadata,identity,cap,input.signal);}
   phase('staging_journal_plan');await stageEvents(client,packet.events,head,identity,cap,input.signal);const result=await work({client,policy,identity,head,headBytes:bytes,base,previous,cap,phase});await client.query('COMMIT');transaction=false;phase('journal_operation_recorded');return result;
  }finally{if(transaction)await client.query('ROLLBACK').catch(()=>undefined);await client.end();}
 });}catch(error){safePostgresError(error);}finally{key.fill(0);}
}
export async function planNativeRecoveryJournal(input:NativeJournalPlanOptions){
 return withVerifiedNativeRecoveryJournal(input,async({client,policy,identity,head,headBytes,base,previous})=>{
  if(previous&&Number(previous.generation)===head.metadata.generation)return planReport(previous,true);
  const summary=(await client.query("SELECT s.payload->>'tableName' AS table, s.payload->>'category' AS category,s.payload->>'operation' AS operation,count(*)::int events,count(DISTINCT s.payload->>'recordHash')::int records FROM pg_temp.dg_journal_stage s LEFT JOIN _dg_native_recovery_journal_events b ON b.id=s.id WHERE b.id IS NULL GROUP BY 1,2,3 ORDER BY 1,2,3")).rows;
  const row=(await client.query<StoredJournalPlan>("INSERT INTO _dg_native_recovery_journal_plans(id,backup_id,runtime_id,stream_id,generation,head_sha256,packet_sha256,base_events,source_events,delta_events,summary,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'pending',$12) RETURNING *",[randomUUID(),policy.backupId,identity.runtimeId,identity.streamId,head.metadata.generation,journalDigest(headBytes),head.packetSHA256,base.eventCount,head.metadata.eventCount,head.metadata.eventCount-base.eventCount,JSON.stringify(summary),new Date().toISOString()])).rows[0];return planReport(row,false);
 });
}
