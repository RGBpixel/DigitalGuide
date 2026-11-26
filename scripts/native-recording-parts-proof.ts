import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {Recording,RecordingConfiguration,MediaTransfer,StudioProject} from '../packages/contracts/src/index.js';
import {NativeContentProofRuntime,proofHash,proofUntil} from './postgres-content-proof-runtime.js';

const base='docs/evidence/T20/postgres-recordings',c=await NativeContentProofRuntime.create(process.argv[2]??base+'/compiled-parts-final'),read=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8')),sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex'),workspaceId='20000000-0000-4000-8000-000000000001';
const configuration:RecordingConfiguration={source:'camera',audio:'microphone',layout:'landscape',pipCorner:'bottom-right',script:{kind:'manual',text:'原创合成画面录制，独立会话并发续传与明确采用。'},fontSize:36,scrollSpeed:100,mirror:false};
const plan=(name:string)=>c.good<Recording>('/studio/recordings',{workspaceId,name,configuration,rights:{subject:'原创合成素材作者',proof:'复用已留存的canvas与振荡器MediaRecorder原片，无物理设备、真人或外部业务',expiresAt:'2099-01-01T00:00:00.000Z',confirmed:true}});
const record=(id:string)=>c.get<Recording>('/studio/recordings/'+id);
async function content(url:string){const r=await fetch('http://127.0.0.1:'+c.apiA+url,{headers:c.headers});assert.equal(r.status,200);return Buffer.from(await r.arrayBuffer());}
let error:unknown;
try{
 const prior=read(base+'/compiled-media-verified-command.json'),deltas=[];
 for(const[file,previousSHA256]of Object.entries(prior.sourceSHA256 as Record<string,string>)){if(!file.startsWith('dist/'))continue;const currentSHA256=proofHash(file);if(currentSHA256!==previousSHA256)deltas.push({file,previousSHA256,currentSHA256});}
 assert.deepEqual(deltas.map(d=>d.file),['dist/api.mjs']);
 const front=read(base+'/compiled-ui-current/frontend-build.json');for(const item of front.entries){assert.equal(proofHash(item.file),item.sha256);assert.equal(proofHash(item.copied),item.sha256);}assert.equal(front.entries.length,50);
 c.save('binary-delta.json',{result:'PASS',deltas,unchangedCurrentFrontendFiles:50,mediaWorkerAndRenderUnchanged:true,earlierFilesNotOverwritten:true});
 await c.prepare();c.add('final_api_guard_build_only_changes_api_preserving_all_media_worker_and_fifty_frontend_files');
 const login=await c.http('/api/v1/auth/login',{accountId:'30000000-0000-4000-8000-000000000001'},c.apiB,{});assert.equal(login.status,200);const cookie=login.cookie!.split(';')[0];assert.notEqual(cookie,c.cookie);
 const me=await c.http<{csrfToken:string}>('/api/v1/me',undefined,c.apiB,{cookie});assert.equal(me.status,200);const alternate={cookie,'x-csrf-token':me.body.data.csrfToken};c.secrets.push(cookie,me.body.data.csrfToken);
 const browser=read(base+'/compiled-ui-current/browser/browser.json'),original=browser.artifacts.find((a:{label:string})=>a.label==='camera'),raw=fs.readFileSync(original.file);assert.equal(sha(raw),original.sha256);
 const bound=async(name:string)=>{const r=await plan(name);return c.good<Recording>('/studio/recordings/'+r.id+'/upload',{version:r.version,fileName:'actual-camera.webm',size:raw.length,sha256:sha(raw),partHashes:[sha(raw)],recordedDurationMs:original.output.sourceSpecs.durationHintMs,confirmed:true});};
 const recording=await bound('两个API和独立会话的同一原片'),transferId=recording.transfer!.id;
 async function concurrent(action:string,id:string,body:unknown){const key=randomUUID(),responses=await Promise.all(Array.from({length:12},(_,i)=>c.http<MediaTransfer>('/api/v1/studio/transfers/'+id+'/'+action,body,i%2?c.apiB:c.apiA,{...(i%2?alternate:c.headers),'idempotency-key':key})));assert.deepEqual(responses.map(r=>r.status),Array(12).fill(200));assert.ok(responses.every(r=>r.body.data.id===id));return{key,statuses:responses.map(r=>r.status)};}
 const parts=await concurrent('parts',transferId,{index:0,sha256:sha(raw),contentBase64:raw.toString('base64')}),received=await c.get<MediaTransfer>('/studio/transfers/'+transferId,c.apiB);assert.deepEqual(received.receivedParts,[0]);assert.equal(received.version,recording.transfer!.version+1);
 assert.equal(await c.owner(async client=>Number((await client.query('SELECT count(*) AS n FROM media_transfer_parts WHERE transfer_id=$1',[transferId])).rows[0].n)),1);
 c.add('two_real_http_apis_independent_same_actor_sessions_twelve_same_key_parts_all200_one_part_one_version');
 const finalize=await concurrent('finalize',transferId,{version:received.version}),queued=await c.get<MediaTransfer>('/studio/transfers/'+transferId);assert.equal(queued.status,'queued');assert.equal(queued.version,received.version+1);
 c.add('two_real_http_apis_twelve_same_key_finalizations_all200_one_queue_transition');
 const cancellation=await bound('两个API并发取消同一未完成传输'),cancel=await concurrent('cancel',cancellation.transfer!.id,{version:cancellation.transfer!.version}),cancelled=await record(cancellation.id);assert.equal(cancelled.transfer!.status,'cancelled');assert.equal(cancelled.transfer!.version,cancellation.transfer!.version+1);
 c.add('two_real_http_apis_twelve_same_key_cancellations_all200_one_cancel_transition');
 const worker=c.worker('final-recording-worker'),done=await proofUntil(()=>record(recording.id),r=>['ready','failed','cancelled'].includes(r.transfer?.status??''),90000);assert.equal(done.transfer!.status,'ready',done.transfer!.errorMessage??'');assert.equal(done.output!.inputSHA256,sha(raw));assert.equal(sha(await content(done.output!.rawUrl!)),sha(raw));
 const normalized=await content('/api/v1/assets/'+done.output!.assetId+'/content');assert.equal(sha(normalized),done.output!.outputSHA256);assert.notEqual(sha(normalized),sha(raw));assert.equal(done.output!.specs.fps,30);assert.ok(done.output!.specs.durationMs>1500);
 fs.writeFileSync(path.join(c.out,'same-original-normalized.mp4'),normalized,{flag:'wx'});
 c.add('final_guard_api_existing_native_media_worker_reuses_retained_actual_webm_with_separate_raw_normalized_sha_and_receipt');
 const project=await c.good<StudioProject>('/studio/recordings/'+done.id+'/apply',{kind:'new_project',version:done.version,name:'并发续传后明确采用的工程',confirmed:true});assert.equal((await c.get<StudioProject>('/studio/projects/'+project.id,c.apiB)).id,project.id);assert.equal((await record(done.id)).output!.outputSHA256,sha(normalized));
 c.add('final_api_guard_upload_result_explicit_project_adoption_and_other_api_reload_preserve_source');
 await c.good('/studio/recordings/'+done.id+'/withdraw',{version:done.version,confirmed:true});assert.equal((await record(done.id)).output!.rawUrl,null);assert.equal((await fetch('http://127.0.0.1:'+c.apiA+'/api/v1/assets/'+done.output!.assetId+'/content',{headers:c.headers})).status,409);assert.ok((await c.get<StudioProject>('/studio/projects/'+project.id)).resourceProblems.length);
 c.add('final_api_guard_source_withdrawal_still_blocks_normalized_content_and_project_plan');
 c.save('concurrency.json',{result:'PASS',independentSessions:true,realHttpApis:2,parts,finalize,cancel,recordingId:done.id,transferId,rawFile:original.file,rawSHA256:sha(raw),normalizedSHA256:sha(normalized),sourceResolution:[done.output!.specs.width,done.output!.specs.height],projectId:project.id,physicalDevicesUsed:false,modelsDownloaded:false,realExternalActions:false});
 await c.stop(worker);for(const file of fs.readdirSync(c.out).filter(f=>/\.(stdout|stderr)\.log$/.test(f))){const text=fs.readFileSync(path.join(c.out,file),'utf8');for(const secret of c.secrets)if(secret.length>=12)assert.equal(text.includes(secret),false);}
 c.add('final_api_guard_proof_keeps_credentials_private_and_performs_no_real_external_business_actions');
 await c.observe();
}catch(e){error=e;}
const result=await c.finish(error);console.log(JSON.stringify({result:result.result,checks:result.checks.length,children:result.children.length,goalComplete:false}));
