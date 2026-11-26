import fs from 'node:fs';
import {createHash} from 'node:crypto';
function edit(file,old,value){const text=fs.readFileSync(file,'utf8');if(!text.includes(old))throw new Error('Missing binding '+file+' '+old.slice(0,80));fs.writeFileSync(file,text.replace(old,value));}
edit('packages/postgres/src/runtime-live.ts',"if(d.recordingEnabled)throw new AppError('LIVE_RECORDING_NOT_MIGRATED','原生录制仍在迁移，请明确关闭本节目录制后预检；不会跳过录制却报告成功。',503);",'');
edit('packages/postgres/src/runtime-live.ts','连续媒体、录制、公开知识、系统播音、数字人和连麦仍在原生迁移；未迁移接口明确失败。','开启录制的场次须先绑定连续输出；录制保存实际本地片段。时间轴重建、公开知识、系统播音、数字人和连麦仍在原生迁移。');
edit('packages/postgres/src/runtime-live-control.ts',"export class NativeLiveControl", "import {startNativeOutput,stopNativeOutput} from './runtime-live-output-state.js';\n\nexport class NativeLiveControl");
edit('packages/postgres/src/runtime-live-control.ts','const s=this.clock(r);s.clockAt=Date.parse(now);','const attached=await startNativeOutput(this,p,r);const s=this.clock(r);s.clockAt=attached?null:Date.parse(now);');
edit('packages/postgres/src/runtime-live-control.ts',"await this.core.audit(p,r.workspace_id,status==='ended'?'live.ended':'live.failed',r.id,requestId);","await stopNativeOutput(this,r.id,status==='failed');await this.core.audit(p,r.workspace_id,status==='ended'?'live.ended':'live.failed',r.id,requestId);");
edit('packages/postgres/src/runtime-live-worker.ts',"export class NativeLiveWorker", "import {nativeOutputAttachment} from './runtime-live-output-state.js';\n\nexport class NativeLiveWorker");
edit('packages/postgres/src/runtime-live-worker.ts','await this.db.query("UPDATE live_commands SET status=\'applied\',simulator_applied_at=dg_utc_now()', 'if(!await nativeOutputAttachment(this.service,r.id))await this.db.query("UPDATE live_commands SET status=\'applied\',simulator_applied_at=dg_utc_now()');
// This route is now owned by the native media router.
const route='apps/api/src/postgres-live-routes.ts';fs.writeFileSync(route,fs.readFileSync(route,'utf8').split('\n').filter(l=>!l.includes("app.get('/api/v1/live-sessions/:id/output'")).join('\n'));
edit('packages/postgres/src/runtime-live-audience.ts','recording:null,commands,observations,','recording:await this.recordingForView(p,r.id),commands,observations,');
edit('packages/postgres/src/runtime-live-audience.ts',' async view(p:Principal,',' async recordingForView(p:Principal,sessionId:string){const row=(await this.db.query<{id:string}>(\'SELECT id FROM live_recordings WHERE session_id=$1\',[sessionId])).rows[0];if(!row)return null;const{NativeLiveRecordings}=await import(\'./runtime-live-recordings.js\');const service=new NativeLiveRecordings(this.core,this.root);return service.recordingView(p,await service.recording(p,row.id));}\n async view(p:Principal,');
const assets='packages/postgres/src/runtime-assets.ts';edit(assets,"'recording','ae_media'].includes", "'recording','ae_media','live_recording'].includes");edit(assets,"['media_processing','recording','ae_media'].includes", "['media_processing','recording','ae_media','live_recording'].includes");
edit(assets,"  if(row.origin_kind==='ae_media')", "  if(row.origin_kind==='live_recording'){const{verifyNativeLiveRecordingOrigin}=await import('./runtime-live-recordings.js');row.video=(await verifyNativeLiveRecordingOrigin(this.core,p,row)).video;}\n  if(row.origin_kind==='ae_media')");
edit(assets,"row.origin_kind==='ae_media'?(","row.origin_kind==='live_recording'?(v.transferKind!=='live_recording'||v.transferAssetId!==row.id||v.transferSha!==row.sha256):row.origin_kind==='ae_media'?(");
edit('packages/postgres/src/runtime-live-outputs.ts','sealNativeReviewFiles(this.core,','sealNativeReviewFiles(this.db.config,');edit('packages/postgres/src/runtime-live-outputs.ts','sealNativeReviewFiles(this.core,','sealNativeReviewFiles(this.db.config,');
// Hold asset handles and check their original deadline again at commit.
for(const v of ['s','snapshot'])edit('packages/postgres/src/runtime-live-outputs.ts',v+'.assets.map(a=>a.expiresAt).filter((s):s is string=>!!s).sort()[0]??null', 'async()=>{const expires='+v+'.assets.map(a=>a.expiresAt).filter((s):s is string=>!!s).sort()[0];if(expires&&expires<=await this.db.now())throw new AppError(\'LIVE_OUTPUT_EXPIRED\',\'背景或音乐已到期。\',409);}');
edit('packages/postgres/src/runtime-live-recordings.ts',"import {NativePrivateObjects} from './runtime-objects.js';\n",'');
edit('apps/api/src/postgres-core-app.ts',"import {registerNativeLiveRoutes}","import {registerNativeLiveOutputRoutes} from './postgres-live-output-routes.js';\nimport {registerNativeLiveRoutes}");
edit('apps/api/src/postgres-core-app.ts','  registerNativeLiveRoutes({app,repo,authenticated,send,scope},config.root);','  registerNativeLiveRoutes({app,repo,authenticated,send,scope},config.root);\n  registerNativeLiveOutputRoutes({app,repo,authenticated,send,scope},config.root);');
edit('apps/worker/src/postgres-core.ts',"import {NativeLiveWorker}","import {NativeLiveOutputWorker} from '../../../packages/postgres/src/runtime-live-output-worker.js';\nimport {NativeLiveWorker}");
edit('apps/worker/src/postgres-core.ts','liveControl=new NativeLiveWorker(repo,config.root),','liveControl=new NativeLiveWorker(repo,config.root),liveOutput=new NativeLiveOutputWorker(repo,config.root),outputPending=new Set<Promise<unknown>>(),');
edit('apps/worker/src/postgres-core.ts',"'live_control']","'live_control','live_output','live_output_capture']");
edit('apps/worker/src/postgres-core.ts','lastLiveTick=Date.now();livePending',"lastLiveTick=Date.now();for(let i=outputPending.size;i<3;i++){const outputWork=liveOutput.runOne(mediaStop.signal,lease=>console.log(JSON.stringify({event:'native_live_output_claimed',outputId:lease.id,attempt:lease.attempts}))).catch(failure).finally(()=>outputPending.delete(outputWork));outputPending.add(outputWork);}livePending");
edit('apps/worker/src/postgres-core.ts','await Promise.allSettled([...pending,','await Promise.allSettled([...pending,...outputPending,');
const boot='packages/postgres/src/runtime-bootstrap.ts';edit(boot,"  await client.query('GRANT SELECT(session_id) ON live_outputs TO '+apiRole);",`  for(const role of [apiRole,workerRole]){
   await client.query('GRANT SELECT ON live_outputs,live_output_generations,live_output_parts,live_output_spans,live_output_presentations,live_output_observations,live_output_recordings,live_recordings,live_recording_origins,live_recording_clips,_dg_native_live_captures TO '+role);
   await client.query('GRANT UPDATE(status,version,presentation,presentation_hash,presentation_version,attempts,lease_token,lease_until,generation_id,generation,accepted_frames,encoded_frames,published_frames,published_duration_ms,interruptions,error_message,withdrawn_at,updated_at) ON live_outputs TO '+role);
   await client.query('GRANT UPDATE(status,generation_id,media_frame,applied_at) ON live_output_presentations TO '+role);
  }
  await client.query('GRANT INSERT ON live_outputs,live_output_presentations,live_output_observations,live_recording_clips TO '+apiRole);
  await client.query('GRANT UPDATE(generation_id,sequence,decoded_frames,position_ms,status,observed_at) ON live_output_observations TO '+apiRole);
  await client.query('GRANT UPDATE(status,version,withdrawn_at,updated_at) ON live_recordings TO '+apiRole);
  await client.query('GRANT INSERT ON live_output_generations,live_output_parts,live_output_spans TO '+workerRole);
  await client.query('GRANT UPDATE(accepted_frames,encoded_frames,published_frames,duration_ms,status,helper_pid,helper_entry,ended_at) ON live_output_generations TO '+workerRole);
  await client.query('GRANT UPDATE(last_frame) ON live_output_spans TO '+workerRole);
  await client.query('GRANT UPDATE(media_applied_at,media_frame) ON live_commands TO '+workerRole);
  await client.query('GRANT EXECUTE ON FUNCTION dg_native_commit_live_capture(text,text,text,text,text,text,text,text,text) TO '+workerRole);`);
edit('packages/postgres/src/runtime-database.ts',"'037-native-live-stop-cleanup.sql'];","'037-native-live-stop-cleanup.sql','038-native-live-output.sql'];");edit('packages/postgres/src/runtime-database.ts','manifest.version!==34','manifest.version!==35');
const file='migrations/postgres/runtime.json',m=JSON.parse(fs.readFileSync(file,'utf8'));m.version=35;m.migrations.push({name:'038-native-live-output.sql',sha256:createHash('sha256').update(fs.readFileSync('migrations/postgres/038-native-live-output.sql')).digest('hex')});fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n');
