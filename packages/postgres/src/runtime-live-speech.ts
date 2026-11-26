import {randomUUID} from 'node:crypto';
import type {z} from 'zod';
import {AppError,canonical,hasPermission,requirePermission,type Principal} from '../../domain/src/index.js';
import {liveSpeechPlanSchema,liveSpeechJobSchema,liveSpeechSessionSchema,liveSpeechSource,systemVoiceSchema,type SystemVoice,type LiveSpeechSource,type liveSpeechPlanCreate,type liveSpeechJobCreate,type liveSpeechPlanControl,type liveSpeechJobControl,type liveSpeechPlay} from '../../contracts/src/index.js';
import {systemSpeechVoices} from '../../providers/src/system-speech.js';
import {liveSpeechHash,planSpeechInput,jobSpeechInput} from '../../domain/src/live-speech.js';
import {NativeLiveAudience} from './runtime-live-audience.js';
import {nativeLiveSpeechJobRow,type NativeLiveSpeechPlanRow,type NativeLiveSpeechJobRow} from './runtime-live-speech-sources.js';
import {nativeOutputAttachment} from './runtime-live-output-state.js';
import {sealNativeReviewFiles} from './runtime-review-seal.js';
import type {NativeLiveSessionRow} from './runtime-live-shapes.js';
import type {NativeReviewSeal} from './runtime-team-reviews.js';

export class NativeLiveSpeech extends NativeLiveAudience{
 async capabilities(){try{const voices=await systemSpeechVoices(this.root);return{available:voices.length>0,voices,reason:voices.length?null:'本机没有可用的Windows系统声音，请安装所需语言。',clonedVoice:false as const,notice:'实际系统播音用于本地连续媒体；声音、语气克隆和实时人物驱动分别验收。'};}catch(e){if(!(e instanceof AppError))throw e;return{available:false,voices:[],reason:e.message,clonedVoice:false as const,notice:'系统声音缺失时明确失败，不返回模拟语音。'};}}
 async voice(id:string){const cap=await this.capabilities(),voice=cap.voices.find(v=>v.id===id);if(!cap.available||!voice)throw new AppError('LIVE_SPEECH_VOICE_UNAVAILABLE',cap.reason??'所选系统声音不存在，请重新核对。',409);return voice;}
 async createPlan(p:Principal,r:NativeLiveSessionRow,input:z.infer<typeof liveSpeechPlanCreate>,voice:SystemVoice,seals:NativeReviewSeal[]){
  requirePermission(p,'live.start');this.version(r,input.sessionVersion);await this.checked(p,r,seals);
  if(!['ready','scheduled'].includes(r.status)||await nativeOutputAttachment(this,r.id))throw new AppError('LIVE_SPEECH_PREPARE_STATE','请在开播及准备连续媒体前，先准备系统播音方案。',409);
  if(voice.id!==input.voiceId)throw new AppError('LIVE_SPEECH_VOICE_UNAVAILABLE','检查期间系统声音发生变化，请重新核对。',409);
  if(Number((await this.db.query<{n:string}>('SELECT count(*) AS n FROM live_speech_plans WHERE session_id=$1',[r.id])).rows[0].n)>=5)throw new AppError('LIVE_SPEECH_PLAN_LIMIT','本场最多五份播音方案，请复用已准备方案或新建场次。',429);
  const id=randomUUID(),cues=this.snapshot(r).definition.cues.filter(c=>c.kind!=='video').map(c=>({cueId:c.id,text:c.text,durationMs:c.durationMs})),fixed={sessionHash:r.snapshot_hash,voice:systemVoiceSchema.parse(voice),cues},text=canonical(fixed),hash=liveSpeechHash(fixed);
  await this.db.query("INSERT INTO live_speech_plans(id,session_id,tenant_id,workspace_id,actor_id,environment,app_env,session_hash,voice,cues,input_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'mock',$6,$7,$8,$9,$10,dg_utc_now(),dg_utc_now())",[id,r.id,p.tenantId,r.workspace_id,p.userId,this.db.config.appEnv,r.snapshot_hash,canonical(voice),canonical(cues),hash]);
  await this.db.query('INSERT INTO _dg_native_live_speech_plan_inputs VALUES($1,$2,$3,dg_utc_now())',[id,text,hash]);const plan=await this.speech.plan(p,id);for(const cue of cues)await this.insertJob(p,plan,{kind:'cue',...cue});await this.refresh(plan);
  return id;
 }
 async insertJob(p:Principal,plan:NativeLiveSpeechPlanRow,source:LiveSpeechSource){
  if(Number((await this.db.query<{n:string}>('SELECT count(*) AS n FROM live_speech_jobs WHERE session_id=$1',[plan.session_id])).rows[0].n)>=200)throw new AppError('LIVE_SPEECH_JOB_LIMIT','本场最多二百份播音任务，请拆分场次；不会覆盖旧任务。',429);
  const id=randomUUID(),fixed=liveSpeechSource.parse(source),input={planId:plan.id,planInputHash:plan.input_hash,sessionHash:plan.session_hash,voice:systemVoiceSchema.parse(JSON.parse(plan.voice)),source:fixed},hash=liveSpeechHash(input);
  await this.db.query("INSERT INTO live_speech_jobs(id,plan_id,session_id,tenant_id,workspace_id,actor_id,environment,app_env,source,input_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'mock',$7,$8,$9,dg_utc_now(),dg_utc_now())",[id,plan.id,plan.session_id,plan.tenant_id,plan.workspace_id,p.userId,this.db.config.appEnv,canonical(fixed),hash]);await this.db.query('INSERT INTO _dg_native_live_speech_job_inputs VALUES($1,$2,$3,dg_utc_now())',[id,canonical(input),hash]);return id;
 }
 async refresh(plan:NativeLiveSpeechPlanRow){
  if(plan.result_hash||['cancelled','withdrawn'].includes(plan.status))return;
  const rows=(await this.db.query<NativeLiveSpeechJobRow>("SELECT * FROM live_speech_jobs WHERE plan_id=$1 AND source::jsonb->>'kind'='cue' ORDER BY id",[plan.id])).rows.map(nativeLiveSpeechJobRow);
  let result:string|null=null,hash:string|null=null;
  if(rows.length===JSON.parse(plan.cues).length&&rows.every(r=>r.status==='succeeded'&&!r.withdrawn_at&&!r.invalidated_at)){
   const clips=[];for(const row of rows){const r=await this.speech.receipt(row);clips.push({id:row.id,inputHash:row.input_hash,wav:r.wav.format,pcm:r.pcm.format});}const value={inputHash:plan.input_hash,clips};result=canonical(value);hash=liveSpeechHash(value);
  }
  await this.db.query('SELECT dg_native_live_speech_plan_state($1,$2,$3)',[plan.id,result,hash]);
 }
 async createJob(p:Principal,r:NativeLiveSessionRow,input:z.infer<typeof liveSpeechJobCreate>,seals:NativeReviewSeal[]){
  requirePermission(p,'live.start');this.version(r,input.sessionVersion);await this.checked(p,r,seals);const plan=await this.speech.plan(p,input.planId);await this.speech.planCurrent(p,plan,true);if(plan.session_id!==r.id)throw new AppError('LIVE_SPEECH_PLAN_SCOPE','播音方案必须属于本场。',409);await this.speech.selected(p,r.id,plan.id);
  const state=this.clock(r);if(!['live','preview'].includes(r.status)||state.epoch!==input.epoch)throw new AppError('LIVE_SPEECH_EPOCH','场控已经变化，请保留输入并核对当前场景。',409);
  if(input.kind==='manual'){if(!state.manual||state.surface!=='manual')throw new AppError('LIVE_TAKEOVER_REQUIRED','请先进入当前人工接管，再准备口播。',409);return this.insertJob(p,plan,{kind:'manual',epoch:state.epoch,text:input.text});}
  const q=await this.question(p,input.questionId);this.version(q,input.questionVersion);if(q.session_id!==r.id||q.status!=='ready'||!q.answer||q.prepared_epoch!==state.epoch||state.manual||state.interactionsPaused||state.answerId)throw new AppError('LIVE_SPEECH_ANSWER_STATE','答复、队列或场控已变化，请按当前代次重新核对。',409);await this.knowledge.current(q);return this.insertJob(p,plan,{kind:'answer',questionId:q.id,questionVersion:q.version,epoch:state.epoch,text:q.answer,citations:JSON.parse(q.citations)});
 }
 async workCurrent(row:NativeLiveSpeechJobRow){
  const p=await this.core.principal(row.actor_id),context=await this.speech.current(p,row),{session,source,plan}=context,state=this.clock(session);
  if(source.kind==='cue'){if(!['ready','scheduled'].includes(session.status)||plan.result_hash)throw new AppError('LIVE_SPEECH_SOURCE_CHANGED','节目已启动或方案已结束，旧配音未保存。',409);}
  else{await this.speech.selected(p,session.id,plan.id);if(!['live','preview'].includes(session.status)||source.epoch!==state.epoch)throw new AppError('LIVE_SPEECH_EPOCH','节目或场控已切换，旧配音未保存。',409);if(source.kind==='manual'){if(!state.manual||state.surface!=='manual')throw new AppError('LIVE_SPEECH_EPOCH','人工接管已经释放，旧口播未保存。',409);}else{const q=await this.question(p,source.questionId);if(q.version!==source.questionVersion||q.prepared_epoch!==source.epoch||q.status!=='ready'||state.manual||state.interactionsPaused||state.answerId)throw new AppError('LIVE_SPEECH_EPOCH','原答复、接管或队列已变化，旧配音未保存。',409);}}
  if(liveSpeechHash(jobSpeechInput(row,plan))!==row.input_hash||liveSpeechHash(planSpeechInput(plan))!==plan.input_hash)throw new AppError('LIVE_SPEECH_INPUT','固定播音输入摘要不符。',409);return{...context,p};
 }
 async play(p:Principal,row:NativeLiveSpeechJobRow,input:z.infer<typeof liveSpeechPlay>,requestId:string,seals:NativeReviewSeal[]){
  requirePermission(p,'live.start');this.version(row,input.jobVersion);const{session:r,plan,source}=await this.speech.current(p,row,true);this.version(r,input.sessionVersion);await this.checked(p,r,seals);await this.speech.selected(p,r.id,plan.id);const state=this.clock(r);
  if(!['live','preview'].includes(r.status)||state.epoch!==input.epoch||source.kind==='cue'||source.epoch!==state.epoch)throw new AppError('LIVE_SPEECH_PLAY_STALE','语音不属于当前场控，请重新准备；不会播放旧口播。',409);
  const receipt=await this.speech.receipt(row);seals.push(await sealNativeReviewFiles(this.db.config,this.speech.files(receipt),async()=>{await this.speech.current(p,await this.speech.job(p,row.id),true);}));
  if(source.kind==='answer'){const q=await this.question(p,source.questionId);this.version(q,source.questionVersion);await this.playAnswer(p,q,{version:q.version,sessionVersion:r.version,epoch:state.epoch,durationMs:Math.ceil(receipt.pcm.format.frames*1000/24)+42,confirmed:true},requestId,seals);}
  else{if(!state.manual||state.surface!=='manual')throw new AppError('LIVE_TAKEOVER_REQUIRED','请先进入当前人工接管。',409);await this.control(p,r,{version:r.version,epoch:state.epoch,action:'manual_text',text:source.text,confirmed:true},requestId,seals);}
  const next=await this.session(p,r.id),epoch=this.clock(next).epoch;
  await this.db.query("INSERT INTO live_speech_playbacks(session_id,job_id,kind,epoch,program_cue_index,program_offset_ms,started_at) VALUES($1,$2,$3,$4,$5,$6,dg_utc_now()) ON CONFLICT(session_id) DO UPDATE SET job_id=EXCLUDED.job_id,kind=EXCLUDED.kind,epoch=EXCLUDED.epoch,version=live_speech_playbacks.version+1,position_frames=0,program_cue_index=EXCLUDED.program_cue_index,program_offset_ms=EXCLUDED.program_offset_ms,status='active',started_at=EXCLUDED.started_at,ended_at=NULL",[r.id,row.id,source.kind,epoch,state.cueIndex,state.offsetMs]);return r.id;
 }
 async controlJob(p:Principal,row:NativeLiveSpeechJobRow,input:z.infer<typeof liveSpeechJobControl>){
  requirePermission(p,'live.start');if(input.action!=='cancel'||input.version<row.control_version||input.version>row.version)this.version(row,input.version);
  if(input.action==='retry'){if(!['failed','cancelled','stale'].includes(row.status)||row.attempts>=3||row.withdrawn_at||row.invalidated_at)throw new AppError('LIVE_SPEECH_RETRY','此任务不能重试或已达三次上限，请按当前场控重新准备。',409);await this.workCurrent(row);await this.db.query("UPDATE live_speech_jobs SET status='queued',control_version=version+1,version=version+1,progress=0,lease_token=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=$1",[row.id]);await this.refresh(await this.speech.plan(p,row.plan_id));return row.id;}
  if(input.action==='cancel'&&!['queued','processing'].includes(row.status))throw new AppError('LIVE_SPEECH_CANCEL_STATE','此播音任务已经结束，请载入当前状态。',409);
  await this.db.query("UPDATE live_speech_jobs SET status=CASE WHEN status IN('queued','processing') THEN 'cancelled' ELSE status END,version=version+1,lease_token=NULL,lease_until=NULL,withdrawn_at=CASE WHEN $2='withdraw' THEN coalesce(withdrawn_at,dg_utc_now()) ELSE withdrawn_at END,updated_at=dg_utc_now() WHERE id=$1",[row.id,input.action]);const playing=await this.speech.playback(row.session_id,true);if(playing?.job_id===row.id)await this.speech.stop(row.session_id);await this.refresh(await this.speech.plan(p,row.plan_id));return row.id;
 }
 async controlPlan(p:Principal,row:NativeLiveSpeechPlanRow,input:z.infer<typeof liveSpeechPlanControl>){
  requirePermission(p,'live.start');this.version(row,input.version);if(input.action==='cancel'&&row.result_hash)throw new AppError('LIVE_SPEECH_PLAN_FINISHED','已完成方案如需停止使用，请明确撤回。',409);
  await this.db.query("UPDATE live_speech_plans SET status=$2,withdrawn_at=CASE WHEN $2='withdrawn' THEN coalesce(withdrawn_at,dg_utc_now()) ELSE withdrawn_at END,version=version+1,updated_at=dg_utc_now() WHERE id=$1",[row.id,input.action==='withdraw'?'withdrawn':'cancelled']);await this.db.query("UPDATE live_speech_jobs SET status='cancelled',version=version+1,lease_token=NULL,lease_until=NULL,updated_at=dg_utc_now() WHERE plan_id=$1 AND status IN('queued','processing')",[row.id]);const active=await this.speech.playback(row.session_id,true);if(active&&(await this.speech.job(p,active.job_id)).plan_id===row.id)await this.speech.stop(row.session_id);return row.id;
 }
 async jobView(p:Principal,row:NativeLiveSpeechJobRow){
  let reason:string|null=null,canRetry=false,canPlay=false;try{await this.speech.current(p,row,row.status==='succeeded');}catch(e){if(!(e instanceof AppError))throw e;reason=e.message;}
  if(!reason&&hasPermission(p,'live.start')){if(['failed','cancelled','stale'].includes(row.status)&&row.attempts<3)try{await this.workCurrent(row);canRetry=true;}catch{/* Old epochs stay unusable. */}if(row.status==='succeeded')try{const{plan,session,source}=await this.speech.current(p,row,true),state=this.clock(session);await this.speech.selected(p,session.id,plan.id);canPlay=source.kind!=='cue'&&source.epoch===state.epoch&&['live','preview'].includes(session.status)&&(source.kind==='manual'?state.manual&&state.surface==='manual':!state.manual&&!state.interactionsPaused&&!state.answerId&&(await this.question(p,source.questionId)).status==='ready'&&(await this.question(p,source.questionId)).version===source.questionVersion);}catch{/* Historical audio is readable but cannot control a new epoch. */}}
  const source=liveSpeechSource.parse(JSON.parse(row.source));return liveSpeechJobSchema.parse({id:row.id,planId:row.plan_id,sessionId:row.session_id,kind:source.kind,cueId:source.kind==='cue'?source.cueId:null,questionId:source.kind==='answer'?source.questionId:null,text:reason?null:source.text,status:row.status,version:row.version,attempts:row.attempts,progress:row.progress,available:!reason,unavailableReason:reason,wav:reason||!row.wav_format?null:JSON.parse(row.wav_format),pcm:reason||!row.pcm_format?null:JSON.parse(row.pcm_format),audioUrl:reason||!row.wav_format?null:'/api/v1/live-speech-jobs/'+row.id+'/audio',errorCode:row.error_code,errorMessage:row.error_message,canControl:hasPermission(p,'live.start'),canRetry,canPlay,clonedVoice:false,createdAt:row.created_at,updatedAt:row.updated_at});
 }
 async planView(p:Principal,row:NativeLiveSpeechPlanRow){let reason:string|null=null;try{await this.speech.planCurrent(p,row,row.status==='ready');}catch(e){if(!(e instanceof AppError))throw e;reason=e.message;}const jobs=[];for(const r of(await this.db.query<NativeLiveSpeechJobRow>('SELECT * FROM live_speech_jobs WHERE plan_id=$1 ORDER BY created_at,id',[row.id])).rows)jobs.push(await this.jobView(p,nativeLiveSpeechJobRow(r)));return liveSpeechPlanSchema.parse({id:row.id,sessionId:row.session_id,status:row.status,version:row.version,voice:reason?null:JSON.parse(row.voice),resultHash:reason?null:row.result_hash,available:!reason,unavailableReason:reason,canControl:hasPermission(p,'live.start'),jobs,createdAt:row.created_at});}
 async speechView(p:Principal,id:string){await this.session(p,id);const plans=[];for(const r of(await this.db.query<{id:string}>('SELECT id FROM live_speech_plans WHERE session_id=$1 ORDER BY created_at,id',[id])).rows)plans.push(await this.planView(p,await this.speech.plan(p,r.id)));const playing=await this.speech.playback(id),job=playing?await this.speech.job(p,playing.job_id):null;return liveSpeechSessionSchema.parse({plans,playback:playing&&job?.pcm_format?{jobId:playing.job_id,kind:playing.kind,version:playing.version,epoch:playing.epoch,positionFrames:playing.position_frames,totalFrames:JSON.parse(job.pcm_format).frames,status:playing.status}:null});}
}
