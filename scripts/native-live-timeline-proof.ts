import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {blankStudioDocument,type LiveDefinition,type LiveProgram,type LivePlan,type LiveSession,type LiveRecording,type StudioProject,type StudioExport,type StudioReview,type ExportPlan,type Asset} from '../packages/contracts/src/index.js';
import {enableTimeline,newTimelineClip} from '../packages/domain/src/timeline.js';
import {liveDefinitionFixture} from '../packages/test-fixtures/src/live.js';
import {syntheticToneWav} from '../packages/media/src/index.js';
import {probeLocalMedia,runMediaTool} from '../packages/media/src/media-tools.js';
import {nativeTimelineSnapshot} from '../packages/postgres/src/runtime-live-timeline-state.js';
import {NativeContentProofRuntime,proofHash,proofUntil,proofPause,type NativeProofProcess} from './postgres-content-proof-runtime.js';
import {nativeLiveTimelineBrowser} from './native-live-timeline-browser.js';

const base='docs/evidence/T20/postgres-live-reconstruction',label=process.argv[2]??'compiled-core',prior=process.argv[3],phase=prior?'media':'core';
const c=prior?await NativeContentProofRuntime.resume(base+'/'+label,base+'/'+prior+'/proof.json'):await NativeContentProofRuntime.create(base+'/'+label);
const tenant='10000000-0000-4000-8000-000000000001',workspace='20000000-0000-4000-8000-000000000001';
let error:unknown,api:NativeProofProcess|undefined,worker:NativeProofProcess|undefined;
let headersB:Record<string,string>={};
const getSession=(id:string)=>c.get<LiveSession>('/live-sessions/'+id),getRecording=(id:string)=>c.get<LiveRecording>('/live-recordings/'+id);
const post=<T>(url:string,body:unknown,key=randomUUID(),port=c.apiA,headers=c.headers)=>c.http<T>('/api/v1'+url,body,port,{...headers,'idempotency-key':key}).then(r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;});
const count=(sql:string,args:unknown[]=[])=>c.owner(async q=>Number((await q.query(sql,args)).rows[0].n));
const start=(s:LiveSession)=>post<LiveSession>('/live-sessions/'+s.id+'/start',{version:s.version,planHash:s.snapshotHash,confirmed:true});
async function control(id:string,action:string){const s=await getSession(id);return post<LiveSession>('/live-sessions/'+id+'/control',{version:s.version,epoch:s.epoch,action,confirmed:true});}
async function prepare(d:LiveDefinition){
 const program=await c.good<LiveProgram>('/live-programs',{workspaceId:workspace,name:'编译版时间轴归档 '+phase,definition:d,rightsConfirmed:true});
 const plan=await post<LivePlan>('/live-programs/'+program.id+'/preflight',{version:1});assert.equal(plan.canStart,true,plan.problems.join('；'));
 const session=await c.good<LiveSession>('/live-sessions',{programId:program.id,programVersion:1,planHash:plan.hash,kind:'broadcast_simulation',confirmed:true,rightsConfirmed:true});
 return{program,session};
}
function plain(){const d=liveDefinitionFixture();return{...d,recordingEnabled:true,loop:true,maxDurationMs:180000,products:[],cues:[{...d.cues[0],durationMs:180000}]};}
async function barrier(table:'audit_events'|'live_recording_origins'){
 const q=await c.cluster.client();await q.query('SET search_path TO "'+c.schema+'",pg_catalog,pg_temp');await q.query('BEGIN');await q.query('LOCK TABLE '+table+' IN SHARE MODE');return q;
}
async function blocked(table:string,role:string,waitMs=25000){
 const rows=await proofUntil(()=>c.owner(async q=>(await q.query("SELECT a.pid,l.mode,l.granted,(extract(epoch FROM(clock_timestamp()-l.waitstart))*1000)::int AS wait_ms FROM pg_locks l JOIN pg_class t ON t.oid=l.relation JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_stat_activity a ON a.pid=l.pid WHERE NOT l.granted AND t.relname=$1 AND n.nspname=$2 AND a.application_name=$3",[table,c.schema,'digitalguide-native-validation-'+role])).rows),r=>r.length===1,waitMs);
 assert.ok(rows[0].wait_ms<1800,'A fresh precommit lock witness is required before physical termination');return{checkedAt:new Date().toISOString(),...rows[0]};
}
async function sessionRows(id:string){return c.owner(async q=>({
 session:(await q.query('SELECT * FROM live_sessions WHERE id=$1',[id])).rows,
 segments:(await q.query('SELECT * FROM live_segments WHERE session_id=$1 ORDER BY seq',[id])).rows,
 recordings:(await q.query('SELECT * FROM live_recordings WHERE session_id=$1',[id])).rows,
 commands:(await q.query('SELECT * FROM live_commands WHERE session_id=$1 ORDER BY id',[id])).rows,
 audit:(await q.query('SELECT * FROM audit_events WHERE resource_id=$1 ORDER BY id',[id])).rows,
}));}
async function derivedCounts(id:string){return c.owner(async q=>{
 const values:Record<string,number>={};
 for(const table of['assets','uploads','video_sources','live_recording_origins','_dg_native_asset_origins','_dg_native_live_timeline_outputs'])values[table]=Number((await q.query('SELECT count(*) AS n FROM '+table)).rows[0].n);
 values.events=Number((await q.query('SELECT count(*) AS n FROM outbox_events WHERE aggregate_id=$1',[id])).rows[0].n);return values;
});}
async function secondCookie(){const r=await c.http('/api/v1/auth/login',{accountId:'30000000-0000-4000-8000-000000000001'},c.apiB,{});assert.equal(r.status,200);const cookie=r.cookie!.split(';')[0],me=await c.http<{csrfToken:string}>('/api/v1/me',undefined,c.apiB,{cookie});headersB={cookie,'x-csrf-token':me.body.data.csrfToken};assert.notEqual(cookie,c.cookie);c.secrets.push(cookie,me.body.data.csrfToken);}
async function untilWorker(){worker=c.worker('owned-'+phase+'-worker-'+c.running.length);await proofUntil(async()=>worker!.stdout(),s=>s.includes('native_worker_ready'));return worker;}
async function stopWorker(){if(worker){await c.stop(worker);worker=undefined;}}
function currentCompiled(){const files:string[]=[];function visit(dir:string){for(const name of fs.readdirSync(dir)){const f=path.join(dir,name);if(fs.statSync(f).isDirectory())visit(f);else files.push(f);}}visit('dist');return Object.fromEntries(files.map(f=>[f.replaceAll('\\','/'),proofHash(f)]));}

try{
 if(prior)await c.prepareResume();else await c.prepare();api=c.running.find(p=>p.label==='api-a');
 if(!prior){
  const dir=path.join(c.compiledRoot,'storage/tools/ffmpeg-9.0.2');fs.mkdirSync(dir,{recursive:true});
  for(const name of['ffmpeg.exe','ffprobe.exe','media-tools.json']){const target=path.join(dir,name);fs.linkSync(path.resolve('storage/tools/ffmpeg-9.0.2',name),target);c.linkedTools.push({file:'ffmpeg-9.0.2/'+name,sha256:proofHash(target),size:fs.statSync(target).size});}
 }
 const compiled=currentCompiled();assert.equal(Object.keys(compiled).length,76);for(const[file,sha]of Object.entries(compiled))assert.equal(proofHash(path.join(c.compiledRoot,file)),sha,file);
 if(prior)assert.deepEqual(compiled,JSON.parse(fs.readFileSync(base+'/'+prior+'/all-compiled.json','utf8')).files);
 c.save('all-compiled.json',{result:'PASS',files:compiled,sourceDirectoriesPresent:false});
 const first=JSON.parse(fs.readFileSync(base+'/first-applied-040.json','utf8'));assert.equal(proofHash(first.file),first.sha256);assert.equal(proofHash(path.join(c.compiledRoot,first.file)),first.sha256);
 await secondCookie();c.add('runtime37_frozen040_same76_compiled_programs_and_independent_two_api_cookies');

 if(phase==='core'){
  const fixture=await prepare(plain());await start(fixture.session);await proofPause(1200);await control(fixture.session.id,'pause');
  const before=await sessionRows(fixture.session.id),s=await getSession(fixture.session.id),key=randomUUID(),body={version:s.version,epoch:s.epoch,action:'stop',confirmed:true};
  await c.observe('observed-api-before-stop');const lock=await barrier('audit_events');let settled=false;
  const request=c.http('/api/v1/live-sessions/'+s.id+'/control',body,c.apiA,{...c.headers,'idempotency-key':key}).then(r=>{settled=true;return{status:r.status};},()=>{settled=true;return{transportClosed:true};});
  try{
   await blocked('audit_events','api');const witness=await blocked('audit_events','api');assert.equal(settled,false);assert.ok(api);await c.stop(api,'SIGKILL');api=undefined;await request;await lock.query('COMMIT');
   assert.deepEqual(await sessionRows(s.id),before);assert.equal(await count('SELECT count(*) AS n FROM idempotency WHERE tenant_id=$1 AND key=$2',[tenant,key]),0);
   c.save('api-stop-precommit.json',{result:'PASS',witness,physicalApiSigkill:true,requestUnsettledImmediatelyBeforeKill:true,sessionSegmentsRecordingInputAuditAndKeyRolledBack:true,mainTouched:false});
  }finally{await lock.query('ROLLBACK').catch(()=>{});await lock.end();await request;}
  api=await c.api('api-after-stop-sigkill');const ended=await post<LiveSession>('/live-sessions/'+s.id+'/control',body,key),rec=ended.recording!;
  assert.equal(rec.status,'queued');assert.equal(await count('SELECT count(*) AS n FROM _dg_native_live_timeline_inputs WHERE recording_id=$1',[rec.id]),1);
  c.add('physical_api_stop_precommit_atomic_queue_rollback_original_key_recovers_exactly_once');

  const beforeDerived=await derivedCounts(rec.id);await c.observe('observed-before-recording-worker');const commitLock=await barrier('live_recording_origins');await untilWorker();
  let lease:{lease_until:string;attempts:number}|undefined;
  try{
   await blocked('live_recording_origins','worker');lease=await c.owner(async q=>(await q.query('SELECT lease_until,attempts FROM live_recordings WHERE id=$1',[rec.id])).rows[0]);
   const witness=await blocked('live_recording_origins','worker');assert.ok(worker);await c.stop(worker,'SIGKILL');worker=undefined;await commitLock.query('COMMIT');
   assert.deepEqual(await derivedCounts(rec.id),beforeDerived);const now=await getRecording(rec.id);assert.equal(now.status,'rendering');assert.equal(now.assetId,null);assert.equal(now.attempts,1);
   c.save('worker-commit-precommit.json',{result:'PASS',witness,lease,actualWorkerSigkill:true,uploadsAssetsOriginsReceiptEventRolledBack:true,originalLeaseEdited:false,attemptsRewound:false});
  }finally{await commitLock.query('ROLLBACK').catch(()=>{});await commitLock.end();}
  await untilWorker();await proofPause(1200);assert.equal((await getRecording(rec.id)).attempts,1);await stopWorker();
  const long=await prepare(plain());await start(long.session);
  c.save('recovery-wait.json',{result:'WAITING_ORIGINAL_DEADLINE',recordingId:rec.id,originalLeaseUntil:lease!.lease_until,longSessionId:long.session.id,leaseEdited:false});
  await proofUntil(async()=>new Date().toISOString(),now=>now>=lease!.lease_until,100000);
  await untilWorker();const recovered=await proofUntil(()=>getRecording(rec.id),r=>r.status==='ready',45000);assert.equal(recovered.attempts,2);await stopWorker();
  c.save('worker-natural-recovery.json',{result:'PASS',recordingId:rec.id,originalLeaseUntil:lease!.lease_until,attempts:2,noEarlyClaim:true,leaseOrClockEdited:false});
  c.add('physical_worker_commit_rollback_then_original90s_lease_recovery_without_deadline_or_attempt_edits');

  const longEnded=await control(long.session.id,'stop'),longRec=longEnded.recording!;assert.ok(longRec.durationMs>60000);
  await untilWorker();const marker=await proofUntil(async()=>{
   const work=path.join(c.nativeDir,'live-timeline-work');if(!fs.existsSync(work))return null;
   const dir=fs.readdirSync(work).find(n=>n.startsWith(longRec.id+'-'));if(!dir)return null;const file=path.join(work,dir,'process.json');return fs.existsSync(file)?{file,...JSON.parse(fs.readFileSync(file,'utf8'))}:null;
  },v=>!!v,20000);assert.ok(marker);
  await c.powershell('kill-owned-timeline-helper','native-live-timeline-process.ps1',['-HelperPid',String(marker.pid),'-CompiledRoot',c.compiledRoot,'-WorkRoot',path.dirname(marker.file),'-ExpectedTool',c.tools.ffmpeg,'-OutputPath',path.join(c.out,'helper-killed.json')]);
  const failed=await proofUntil(()=>getRecording(longRec.id),r=>r.status==='failed',20000);assert.equal(failed.attempts,1);assert.equal(await count('SELECT count(*) AS n FROM _dg_native_live_timeline_outputs WHERE recording_id=$1',[failed.id]),0);await stopWorker();
  const retryKey=randomUUID(),retryBody={version:failed.version,action:'retry',confirmed:true},replies=await Promise.all(Array.from({length:12},(_,i)=>post<LiveRecording>('/live-recordings/'+failed.id+'/control',retryBody,retryKey,i%2?c.apiB:c.apiA,i%2?headersB:c.headers)));
  assert.ok(replies.every(r=>r.id===failed.id&&r.version===failed.version+1&&r.status==='queued'));
  assert.equal(await count("SELECT count(*) AS n FROM audit_events WHERE resource_id=$1 AND action='live.timeline_retry'",[failed.id]),1);
  const cancelled=await post<LiveRecording>('/live-recordings/'+failed.id+'/control',{version:failed.version+1,action:'cancel',confirmed:true});assert.equal(cancelled.status,'cancelled');
  c.add('actual_owned_helper_kill_reaps_real_ffmpeg_visible_failure_no_partial_adoption_two_api12_retry_once_and_cancel');
  c.save('fixture.json',{recordingId:rec.id,recoveredDurationMs:recovered.durationMs,helperKilledRecordingId:failed.id,helperKilledTimelineDurationMs:longRec.durationMs,privateRoot:c.cluster.root});
 }else{
  const upload=await c.good<{uploadId:string}>('/assets/uploads',{workspaceId:workspace,fileName:'原创归档纯音.wav',contentBase64:syntheticToneWav(3000).toString('base64')}),tone=await c.good<Asset>('/assets',{uploadId:upload.uploadId,name:'原创归档纯音',category:'voice'});
  const doc=blankStudioDocument();doc.segments[0].durationMs=3000;doc.segments[0].speakerId=null;doc.segments[0].elements=[];doc.segments[0].text='原创蓝红有声';enableTimeline(doc);for(const t of doc.timeline!.tracks)t.clips=[];
  doc.timeline!.tracks.find(t=>t.type==='background')!.clips=[newTimelineClip({type:'color',color:'#1234bc'},{durationMs:1500}),newTimelineClip({type:'color',color:'#bc3412'},{startMs:1500,durationMs:1500})];
  doc.timeline!.tracks.find(t=>t.type==='voice')!.clips=[newTimelineClip({type:'asset',assetId:tone.id},{durationMs:3000,voiceRole:'narration'})];
  const project=await c.good<StudioProject>('/studio/projects',{workspaceId:workspace,name:'编译版归档实际有声来源',purpose:'video',document:doc}),input={version:1,kind:'video',settings:{preset:'hd',fps:24,transparent:false,omitBackground:false,burnSubtitles:false},startMs:0,durationMs:3000};
  const plan=await post<ExportPlan>('/studio/projects/'+project.id+'/export-plan',input),job=await c.good<StudioExport>('/studio/projects/'+project.id+'/exports',{...input,planHash:plan.hash,confirmed:true,rightsConfirmed:true});await untilWorker();
  const exported=await proofUntil(()=>c.get<StudioExport>('/studio/exports/'+job.id),e=>e.status==='succeeded',50000);await stopWorker();
  const reviewer=randomUUID();await c.owner(async q=>{await q.query('INSERT INTO users VALUES($1,$2)',[reviewer,'虚构独立归档审核人']);await q.query('INSERT INTO memberships VALUES($1,$2,$3,$4)',[reviewer,tenant,'reviewer',JSON.stringify([workspace])]);});
  const login=await c.http('/api/v1/auth/login',{accountId:reviewer},c.apiB,{}),reviewCookie=login.cookie!.split(';')[0],me=await c.http<{csrfToken:string}>('/api/v1/me',undefined,c.apiB,{cookie:reviewCookie});c.secrets.push(reviewCookie,me.body.data.csrfToken);
  const review=await c.good<StudioReview>('/studio/projects/'+project.id+'/reviews',{version:1,stage:'delivery',exportId:exported.id,reviewerId:reviewer,confirmed:true});await post('/studio/reviews/'+review.id+'/decision',{version:1,decision:'approve',note:'原创有声片独立审核',confirmed:true},randomUUID(),c.apiB,{cookie:reviewCookie,'x-csrf-token':me.body.data.csrfToken});
  const artifact=exported.artifacts.find(v=>v.kind==='video')!,d={...plain(),cues:[{id:randomUUID(),kind:'video' as const,title:'蓝红有声归档原片',exportId:exported.id,artifactId:artifact.id,sourceInMs:0,durationMs:3000}]};
  const r=await prepare(d);await start(r.session);await proofPause(350);await control(r.session.id,'pause');await proofPause(1400);await control(r.session.id,'resume');await proofPause(400);await control(r.session.id,'mute');await proofPause(400);await control(r.session.id,'unmute');await proofPause(300);const ended=await control(r.session.id,'stop');
  await untilWorker();const rec=await proofUntil(()=>getRecording(ended.recording!.id),v=>v.status==='ready',45000);await stopWorker();
  const response=await fetch('http://127.0.0.1:'+c.apiA+rec.url,{headers:c.headers});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),rec.sha256);
  const file=path.join(c.out,'actual-timeline-recording.mp4');fs.writeFileSync(file,bytes,{flag:'wx'});const probe=await probeLocalMedia(file);assert.equal(probe.streams.find(s=>s.codec_type==='video')!.width,1280);assert.equal(probe.streams.find(s=>s.codec_type==='video')!.height,720);assert.equal(probe.streams.find(s=>s.codec_type==='audio')!.codec_name,'aac');assert.ok(Math.abs(Number(probe.format.duration)*1000-rec.durationMs)<=120);
  const snapshot=await c.owner(async q=>nativeTimelineSnapshot.parse(JSON.parse((await q.query('SELECT snapshot FROM live_recordings WHERE id=$1',[rec.id])).rows[0].snapshot)));
  const voiced=snapshot.segments.find(s=>s.kind==='video'&&!s.muted&&!s.frozen&&s.durationMs>=300)!,muted=snapshot.segments.find(s=>s.kind==='video'&&s.muted&&s.durationMs>=300)!,frozen=snapshot.segments.find(s=>s.kind==='video'&&s.frozen&&s.durationMs>=1200)!;assert.ok(voiced&&muted&&frozen);
  async function pcm(label:string,at:number){const target=path.join(c.out,label+'.pcm');await runMediaTool(c.tools.ffmpeg,['-v','error','-nostdin','-n','-ss',String(at/1000),'-i',file,'-t','0.12','-map','0:a:0','-f','s16le','-ar','48000','-ac','2',target]);const b=fs.readFileSync(target);let sum=0;for(let i=0;i<b.length;i+=2)sum+=b.readInt16LE(i)**2;return Math.sqrt(sum/(b.length/2));}
  const voicedRms=await pcm('voiced',voiced.startMs+70),mutedRms=await pcm('muted',muted.startMs+70);assert.ok(voicedRms>100);assert.ok(mutedRms<25);
  await runMediaTool(c.tools.ffmpeg,['-v','error','-nostdin','-n','-ss',String((frozen.startMs+frozen.durationMs-100)/1000),'-i',file,'-frames:v','1','-update','1',path.join(c.out,'frozen-frame.png')]);
  c.save('actual-media.json',{result:'PASS',recording:rec,snapshot,probe,voicedRms,mutedRms,sourceSynthetic:true,remoteCapture:false});c.add('compiled_owned_actual_video_audio_pause_mute_sha_duration_and_fixed_timeline');

  const clipKey=randomUUID(),clipBody={version:rec.version,name:'双API原生归档拆条',startMs:0,durationMs:1000,confirmed:true},clips=await Promise.all(Array.from({length:12},(_,i)=>post<{projectId:string}>('/live-recordings/'+rec.id+'/create-clips',clipBody,clipKey,i%2?c.apiB:c.apiA,i%2?headersB:c.headers)));assert.equal(new Set(clips.map(v=>v.projectId)).size,1);
  const clipped=await c.get<StudioProject>('/studio/projects/'+clips[0].projectId),clipInput={...input,version:clipped.version,durationMs:1000},clipPlan=await post<ExportPlan>('/studio/projects/'+clipped.id+'/export-plan',clipInput),clipJob=await c.good<StudioExport>('/studio/projects/'+clipped.id+'/exports',{...clipInput,planHash:clipPlan.hash,confirmed:true,rightsConfirmed:true});await untilWorker();const clipExport=await proofUntil(()=>c.get<StudioExport>('/studio/exports/'+clipJob.id),j=>j.status==='succeeded',45000);await stopWorker();assert.ok(clipExport.artifacts.some(a=>a.url));
  c.add('two_independent_http_apis12_clip_replays_make_one_project_actual_export_and_private_range');
  const range=await fetch('http://127.0.0.1:'+c.apiB+rec.url,{headers:{...headersB,range:'bytes=0-31'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32);
  const web=c.start('built-timeline-web',process.execPath,[path.resolve('node_modules/vite/bin/vite.js'),'preview','--config',path.resolve('apps/web/vite.config.ts'),'--outDir',path.join(c.compiledRoot,'dist/web'),'--host','127.0.0.1','--port',String(c.web),'--strictPort'],{API_PORT:String(c.apiA),WEB_PORT:String(c.web)});await proofUntil(()=>fetch('http://127.0.0.1:'+c.web).then(r=>r.status),v=>v===200);
  const browser=await nativeLiveTimelineBrowser({origin:'http://127.0.0.1:'+c.web,folder:path.join(c.out,'browser'),profileRoot:c.cluster.root,cookie:c.cookie,viewerCookie:c.viewerCookie,sessionId:r.session.id});await c.stop(web);c.add('built_timeline_recording_player_clip_reload_readonly_and390px',{checks:browser.checks.length});
  const saved=await getRecording(rec.id);assert.ok(api);await c.stop(api,'SIGKILL');api=undefined;await c.cluster.stop();assert.equal((await c.http('/api/v1/live-recordings/'+rec.id,undefined,c.apiB)).status,503);await c.cluster.start();api=await c.api('api-after-timeline-database-restart');assert.deepEqual(await getRecording(rec.id),saved);for(const key of c.keys)assert.equal(proofHash(path.join(c.nativeDir,key.name)),key.sha256);
  c.add('api_postgres_restart_preserves_timeline_receipt_actual_files_and_private_keys_without_sqlite');
  await c.good('/studio/projects/'+project.id+'/save',{version:project.version,name:project.name,document:project.document});assert.equal((await getRecording(rec.id)).available,false);assert.equal((await fetch('http://127.0.0.1:'+c.apiA+rec.url,{headers:c.headers})).status,409);assert.equal((await fetch('http://127.0.0.1:'+c.apiA+'/api/v1/assets/'+rec.assetId+'/content',{headers:c.headers})).status,409);
  const replay=await c.http('/api/v1/live-recordings/'+rec.id+'/create-clips',clipBody,c.apiB,{...headersB,'idempotency-key':clipKey});assert.equal(replay.status,409);assert.ok((await c.get<StudioProject>('/studio/projects/'+clipped.id)).resourceProblems.length);assert.ok((await c.get<StudioExport>('/studio/exports/'+clipJob.id)).artifacts.every(a=>a.url===null));
  const now=await getRecording(rec.id);assert.equal((await post<LiveRecording>('/live-recordings/'+rec.id+'/control',{version:now.version,action:'withdraw',confirmed:true})).status,'withdrawn');
  c.add('original_source_revision_invalidates_recording_asset_clip_replay_project_and_export_and_still_allows_withdraw');
  c.save('fixture.json',{sessionId:r.session.id,recordingId:rec.id,sourceProjectId:project.id,sourceExportId:exported.id,clipProjectId:clipped.id,clipExportId:clipJob.id,privateRoot:c.cluster.root});
 }
}catch(e){error=e;}finally{await c.finish(error);}console.log(JSON.stringify({result:'PASS',phase,checks:c.checks.length,mainTouched:false}));
