import {randomUUID} from 'node:crypto';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeTranscriptions} from '../packages/postgres/src/runtime-transcriptions.js';
import {NativeTranscriptionWorker} from '../packages/postgres/src/runtime-transcription-worker.js';
import {transcriptionCreateInput,transcriptionConfirmInput,transcriptionSaveInput} from '../packages/contracts/src/index.js';

const [mode,configFile,root,raw]=process.argv.slice(2),db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(configFile),'finish'===mode?'worker':'api',root),repo=new NativeCoreRepository(db),s=new NativeTranscriptions(repo,root),key=randomUUID();
const pause=async(data:object)=>{console.log(JSON.stringify({phase:'native_transcription_'+mode+'_staged',key,...data}));await new Promise<void>(()=>{});};
try{
 if(mode==='queue'){
  const input=transcriptionCreateInput.parse(JSON.parse(raw)),cap=await s.capabilities();await db.transaction(async()=>{const p=await repo.principal('30000000-0000-4000-8000-000000000001'),jobId=await repo.idempotentResource(p,{action:'probe.transcription.queue',key,body:input,code:200},async()=>{const id=await s.create(p,input,cap.recognizers);await repo.audit(p,input.workspaceId,'probe.transcription.queue',id,key);await repo.event(p.tenantId,input.workspaceId,id,'transcription.changed');return id;});await pause({jobId,inputHash:(await s.row(p,jobId)).input_hash});});
 }else if(mode==='finish'){
  const worked=await new NativeTranscriptionWorker(repo,root).runOne(undefined,undefined,async data=>{const row=(await db.query<{analysis_hash:string;review_hash:string}>('SELECT analysis_hash,review_hash FROM studio_transcriptions WHERE id=$1',[data.jobId])).rows[0],counts:Record<string,number>={};for(const[table,column]of [['_dg_native_transcription_outputs','job_id'],['studio_transcription_revisions','transcription_id'],['audit_events','resource_id'],['outbox_events','aggregate_id']])counts[table]=(await db.query<{n:number}>('SELECT count(*)::int AS n FROM '+table+' WHERE '+column+'=$1',[data.jobId])).rows[0].n;await pause({...data,analysisSHA256:row.analysis_hash,reviewSHA256:row.review_hash,counts});});if(!worked)throw new Error('No queued native transcription reached the worker');
 }else if(mode==='confirm'||mode==='review'){
  await db.transaction(async()=>{const p=await repo.principal('30000000-0000-4000-8000-000000000001'),r=await s.row(p,raw,true),complete=await s.completed(r),body=mode==='confirm'?transcriptionConfirmInput.parse({version:r.version,reviewVersion:r.review_version,reviewHash:r.review_hash,name:'独立真实转写校对来源',rights:complete.snapshot.rights,listeningReviewed:true,confirmed:true}):transcriptionSaveInput.parse({version:r.version,reviewVersion:r.review_version,segments:complete.review.segments,note:'事务回滚检查，不会保存'});let sourceId:string|undefined;await repo.idempotentResource(p,{action:'probe.transcription.'+mode,key,body,code:200},async()=>{if(mode==='confirm')sourceId=await s.confirm(p,r,transcriptionConfirmInput.parse(body));else await s.save(p,r,transcriptionSaveInput.parse(body));await repo.audit(p,r.workspace_id,'probe.transcription.'+mode,r.id,key);await repo.event(p.tenantId,r.workspace_id,r.id,'transcription.changed');return sourceId??r.id;});await pause({jobId:r.id,sourceId,reviewVersion:r.review_version,reviewSHA256:r.review_hash,sourceMaterialSHA256:sourceId?(await s.sources.source(p,sourceId)).material_sha256:null});});
 }else throw new Error('Unknown bounded native transcription probe');
}finally{await db.close();}
// The harness terminates only its own staged process; reaching here is a failed interruption proof.
throw new Error('The native transaction probe was not terminated before commit');
