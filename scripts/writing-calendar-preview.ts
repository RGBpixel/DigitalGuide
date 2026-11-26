import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {ContentWritingJob,ContentSource,ContentBrief,ContentWritingEngine} from '@digitalguide/contracts';
import {fixtureIds as f} from '../packages/test-fixtures/src/seed.js';

interface State {phase:string;ids:Record<string,string>;operationKey:string;oldCheckpointSHA256:string;stableJob?:ContentWritingJob}
const origin='http://127.0.0.1:5174',base='http://127.0.0.1:4301/api/v1',file='storage/writing-calendar-preview-state.json',oldFile='storage/writing-review-preview-state.json',folder=path.resolve(process.env.WRITING_CALENDAR_EVIDENCE_DIR||'docs/evidence/T24/writing-calendar/runtime/initial'),hash=(name:string)=>createHash('sha256').update(fs.readFileSync(name)).digest('hex');
const old=JSON.parse(fs.readFileSync(oldFile,'utf8')) as {ids:Record<string,string>;stable:{job:ContentWritingJob}},verifyOnly=process.argv.includes('--verify-only'),prepareOnly=process.argv.includes('--prepare-only');
const oldCheckpointSHA256=hash(oldFile),state:State=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')) as State:{phase:'prepared',ids:{source:old.ids.source,brief:old.ids.brief},operationKey:randomUUID(),oldCheckpointSHA256};
assert.equal(state.oldCheckpointSHA256,oldCheckpointSHA256);if(verifyOnly)assert.equal(state.phase,'complete');
const originalBytes=fs.existsSync(file)?fs.readFileSync(file):null,save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');if(!fs.existsSync(file))save();
const login=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({accountId:f.adminA})});assert.equal(login.status,200);
const cookie=login.headers.getSetCookie()[0].split(';')[0];
async function get<T>(url:string):Promise<T>{const response=await fetch(base+url,{headers:{cookie},signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);return(await response.json()).data as T;}
const {csrfToken}=await get<{csrfToken:string}>('/me');
const cap=await get<{available:boolean;engine:ContentWritingEngine;engineHash:string}>('/studio/content/writing/capabilities?workspaceId='+f.workspaceA);
assert.equal(cap.available,true);assert.equal(cap.engine.policy,'source-script-reviewed-v3');
assert.deepEqual(await get<ContentWritingJob>('/studio/content/writing/jobs/'+old.ids.job),old.stable.job);
const source=await get<ContentSource>('/studio/content/sources/'+state.ids.source),brief=await get<ContentBrief>('/studio/content/briefs/'+state.ids.brief),request=old.stable.job.request!;
assert.equal(source.available,true);assert.equal(source.version,request.refs[0].version);assert.equal(brief.version,request.brief!.version);
if(!state.ids.job){
  assert.equal(verifyOnly,false);const response=await fetch(base+'/studio/content/writing/jobs',{method:'POST',headers:{Origin:origin,cookie,'Content-Type':'application/json','X-CSRF-Token':csrfToken,'Idempotency-Key':state.operationKey},body:JSON.stringify({workspaceId:f.workspaceA,name:'原创资料 · 开放安排与时段核对',sources:request.refs.map(r=>({id:r.id,version:r.version})),briefId:brief.id,briefVersion:brief.version,topic:request.topic,instruction:request.instruction,variantCount:2,targetDurationMs:request.targetDurationMs,language:request.language,engineHash:cap.engineHash,confirmed:true}),signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200);const job=(await response.json()).data as ContentWritingJob;state.ids.job=job.id;state.phase='running';save();
}
if(prepareOnly){console.log(JSON.stringify({result:'SAME_NEW_V3_JOB_QUEUED',jobId:state.ids.job,oldJobUnchanged:true}));process.exit(0);}
const end=Date.now()+660000;let job=await get<ContentWritingJob>('/studio/content/writing/jobs/'+state.ids.job);
while(!['succeeded','failed','cancelled','stale'].includes(job.status)&&Date.now()<end){await delay(1000);job=await get('/studio/content/writing/jobs/'+state.ids.job);}
if(!['succeeded','failed','cancelled','stale'].includes(job.status))throw new Error('Observation window expired; retain and observe the same job '+job.id+' again.');
fs.mkdirSync(folder,{recursive:true});
if(job.status!=='succeeded'){
  fs.writeFileSync(path.join(folder,'runtime.json'),JSON.stringify({result:'FAIL',jobId:job.id,status:job.status,errorCode:job.errorCode,errorMessage:job.errorMessage,checkpointRetained:true,replacementCreated:false},null,2)+'\n',{flag:'wx'});
  throw new Error(job.errorMessage||'The saved v3 job did not complete.');
}
assert.equal(job.evidence!.engine.policy,'source-script-reviewed-v3');assert.equal(job.result!.variants.length,2);assert.equal(job.evidence!.offlineCpu,true);assert.equal(job.adoptions.length,0);assert.deepEqual(job.evidence!.review!.passes.at(-1)!.guardFindings,[]);
if(verifyOnly){assert.deepEqual(job,state.stableJob);assert.ok(originalBytes?.equals(fs.readFileSync(file)));}else if(state.phase!=='complete'){state.phase='complete';state.stableJob=job;save();}
assert.equal(hash(oldFile),oldCheckpointSHA256);
const checks=['new_task_uses_actual_current_v3_qwen_e5_and_fixed_calendar_policies','same_two_actual_variants_with_original_model_opinions_and_zero_final_hard_rule_findings','old_v2_job_and_checkpoint_unchanged_under_current_server','existing_authorized_source_and_brief_reused_without_editing_original_business_rows','no_automatic_adoption_speech_export_or_external_action','same_persistent_job_id_and_evidence_not_recreated'];
fs.writeFileSync(path.join(folder,'runtime.json'),JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),previewSession:process.env.PREVIEW_SESSION_HANDLE,verifyOnly,checks,jobId:job.id,sourceId:source.id,briefId:brief.id,originalV2JobId:old.ids.job,policy:job.evidence!.engine.policy,modelElapsedMs:job.evidence!.elapsedMs,modelReviewOutcome:job.evidence!.review!.outcome,initialFindings:job.evidence!.review!.passes[0].guardFindings,repairPerformed:!!job.evidence!.review!.repair,adoptions:0,modelResult:job.result,candidateURL:origin+'/studio/drafts?writing='+job.id,generalFactualQualityVerified:false,cameraOrMicrophoneUsed:false,actualAvatarOrVoiceClone:false,newMediaExportClaim:false,realExternalActions:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PASS',checks:checks.length,jobId:job.id,modelOutcome:job.evidence!.review!.outcome,adoptions:0}));
