import {randomUUID} from 'node:crypto';
import {speechJobApplyInput} from '../packages/contracts/src/index.js';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeSpeechJobs} from '../packages/postgres/src/runtime-speech-jobs.js';
const db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(process.argv[2]),'api',process.argv[3]),repo=new NativeCoreRepository(db),service=new NativeSpeechJobs(repo),jobId=process.argv[4],key=randomUUID();
try{await db.transaction(async()=>{
 const p=await repo.principal('30000000-0000-4000-8000-000000000001');await db.query("SELECT set_config('digitalguide.actor_id',$1,true)",[p.userId]);
 const job=await service.row(p,jobId,true),project=await service.s.project(p,job.project_id,true),body=speechJobApplyInput.parse({version:job.version,projectVersion:project.version,confirmed:true,rightsConfirmed:true,replaceExistingVoice:true,trimLongAudio:true});
 const beforeEvents=(await db.query<{id:string}>('SELECT id FROM outbox_events WHERE aggregate_id=ANY($1::text[])',[[jobId,project.id]])).rows.map(r=>r.id);
 await repo.idempotentResource(p,{action:'actual-native-speech-apply-probe',key,body,code:200},async()=>{await service.apply(p,job,body,key);await repo.audit(p,project.workspace_id,'voice.apply_transaction_probe',jobId,key);await repo.event(p.tenantId,project.workspace_id,jobId,'voice.changed');return jobId;});
 const live=await service.row(p,jobId),outputs=await service.outputs(live),assetIds=outputs.map(o=>o.assetId!),counts:Record<string,number>={studio_speech_jobs:Number(live.applied_project_version===project.version+1),studio_projects:Number((await service.s.project(p,project.id)).version===project.version+1)};
 for(const table of ['uploads','assets','_dg_native_asset_origins','_dg_native_speech_assets','asset_versions']){const column=['uploads','assets'].includes(table)?'id':'asset_id',ids=table==='uploads'?(await db.query<{upload_id:string}>('SELECT upload_id FROM assets WHERE id=ANY($1::text[])',[assetIds])).rows.map(r=>r.upload_id):assetIds;counts[table]=(await db.query<{n:number}>('SELECT count(*)::int AS n FROM '+table+' WHERE '+column+'=ANY($1::text[])',[ids])).rows[0].n;}
 counts.studio_project_versions=(await db.query<{n:number}>('SELECT count(*)::int AS n FROM studio_project_versions WHERE project_id=$1 AND version=$2',[project.id,project.version+1])).rows[0].n;
 counts._dg_native_speech_applications=(await db.query<{n:number}>('SELECT count(*)::int AS n FROM _dg_native_speech_applications WHERE job_id=$1',[jobId])).rows[0].n;
 counts.idempotency=(await db.query<{n:number}>('SELECT count(*)::int AS n FROM idempotency WHERE key=$1',[key])).rows[0].n;
 const auditIds=(await db.query<{id:string}>('SELECT id FROM audit_events WHERE request_id=$1',[key])).rows.map(r=>r.id),eventIds=(await db.query<{id:string}>('SELECT id FROM outbox_events WHERE aggregate_id=ANY($1::text[]) AND id<>ALL($2::text[])',[[jobId,project.id],beforeEvents])).rows.map(r=>r.id);counts.audit_events=auditIds.length;counts.outbox_events=eventIds.length;
 for(const[table,count]of Object.entries(counts))if(count!==(['audit_events','outbox_events'].includes(table)?2:1))throw new Error('Actual apply rows differ: '+table+'='+count);
 console.log(JSON.stringify({phase:'native_speech_apply_staged',jobId,projectId:project.id,projectVersion:project.version,assetIds,uploadIds:(await db.query<{upload_id:string}>('SELECT upload_id FROM assets WHERE id=ANY($1::text[])',[assetIds])).rows.map(r=>r.upload_id),auditIds,eventIds,key,counts}));await new Promise<void>(()=>{/* Parent SIGKILLs before the atomic application commits. */});
});}finally{await db.close();}
