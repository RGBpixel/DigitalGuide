import type {FileHandle} from 'node:fs/promises';
import type {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {AppError,canonical,requirePermission,requireWorkspace,type Principal} from '../../domain/src/index.js';
import {presentationAnswerSources,presentationAnswerHash as hash} from '../../domain/src/presentation-answers.js';
import {assertPresentationAnswerComposition} from '../../domain/src/presentation-question-parts.js';
import {presentationAnswerConfiguration,presentationAnswerRequest,presentationAnswerNativeResult,presentationAnswerJobSchema,type PresentationAnswerJob,type PresentationAnswerNativeResult,type presentationAnswerConfigure,type presentationAnswerJobControl,type presentationAnswerPlaybackStart,type presentationAnswerPlaybackEnd} from '../../contracts/src/index.js';
import {presentationModel} from '../../providers/src/presentation-answer-model.js';
import {systemSpeechVoices} from '../../providers/src/system-speech.js';
import {NativePresentations,nativePresentationSessionRow,type NativePresentationSessionRow,type NativePresentationQuestionRow} from './runtime-presentations.js';
import {nativeBusinessInteger as integer,type NativeCoreRepository} from './runtime-repository.js';

export interface NativeAnswerRow{
 id:string;session_id:string;question_id:string;tenant_id:string;workspace_id:string;actor_id:string;source_hash:string;request:string;configuration:string;input_hash:string;control_generation:number;
 status:PresentationAnswerJob['status'];version:number;attempts:number;progress:number;lease_token:string|null;lease_until:string|null;result:string|null;evidence:string|null;audio_key:string|null;audio_format:string|null;error_code:string|null;error_message:string|null;
 playback_version:number;playback_state:PresentationAnswerJob['playback']['state'];playback_actor_id:string|null;playback_client_id:string|null;playback_started_at:string|null;playback_lease_until:string|null;created_at:string;updated_at:string;
}
export function nativeAnswerRow(r:NativeAnswerRow){return{...r,version:integer(r.version),attempts:integer(r.attempts),control_generation:integer(r.control_generation),playback_version:integer(r.playback_version)};}
interface InputLedger{request_sha256:string;host_id:string;artifact_id:string;artifact_hash:string}
interface WorkerContext{session:NativePresentationSessionRow;question:NativePresentationQuestionRow}
type Configuration=z.infer<typeof presentationAnswerConfiguration>;
export class NativePresentationAnswers{
 readonly presentations:NativePresentations;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd()){this.presentations=new NativePresentations(core,root);}
 get db(){return this.core.db;}
 get files(){return this.presentations.media.files;}
 async capabilities(){try{const model=await presentationModel(this.root),voices=await systemSpeechVoices(this.root);return{available:voices.length>0,engine:model.answerEngine,engineHash:hash(model.answerEngine),voices,reason:voices.length?null:'本机未安装所需系统声音，请安装后重试。',notice:'实际本机模型仅依据本场讲稿和文本框逐项答疑，出处仍需核对；系统语音不是音色或语气复刻，没有实时数字人驱动或业务操作。'};}catch(e){if(!(e instanceof AppError))throw e;return{available:false,engine:null,engineHash:null,voices:[],reason:e.message,notice:'模型或系统声音缺失时明确失败，人工答疑仍可继续。'};}}
 async prepareConfiguration(input:z.infer<typeof presentationAnswerConfigure>):Promise<Configuration|null>{
  if(input.mode==='human_text')return null;const cap=await this.capabilities(),voice=cap.voices.find(v=>v.id===input.voiceId);
  if(!cap.available||!cap.engine||cap.engineHash!==input.engineHash||!voice)throw new AppError('PRESENTATION_ANSWER_CAPABILITY',cap.reason||'模型或声音已变化，请重新核对。',409);
  return presentationAnswerConfiguration.parse({engine:cap.engine,voice,autoResume:input.autoResume});
 }
 async assertConfiguration(input:z.infer<typeof presentationAnswerConfigure>,prepared:Configuration|null){const current=await this.prepareConfiguration(input);if(canonical(current)!==canonical(prepared))throw new AppError('PRESENTATION_ANSWER_CAPABILITY','配置检查期间模型或声音已变化，请重新核对。',409);}
 async configure(p:Principal,r:NativePresentationSessionRow,input:z.infer<typeof presentationAnswerConfigure>,prepared:Configuration|null){
  this.presentations.host(p,r);const live=await this.presentations.liveSource(p,r);this.presentations.studio.version(r,input.version);
  if(r.state==='question'||r.state==='ended')throw new AppError('PRESENTATION_ANSWER_CONFIG_STATE','请先处理当前问题并继续，再调整后续问题的答疑方式。',409);
  if(input.mode==='local_model'){presentationAnswerSources(live.source.doc);if(!prepared||hash(prepared.engine)!==input.engineHash||prepared.voice.id!==input.voiceId)throw new AppError('PRESENTATION_ANSWER_CAPABILITY','配置检查未完成，请重新核对。',409);}
  await this.presentations.interruptAutomatic(r);await this.db.query('UPDATE studio_presentation_sessions SET answer_mode=$1,answer_configuration=$2,answer_generation=answer_generation+1,version=version+1,updated_at=dg_utc_now() WHERE id=$3',[input.mode,prepared?JSON.stringify(prepared):null,r.id]);return r.id;
 }
 async question(r:NativePresentationSessionRow,id=r.active_question_id){const q=(await this.db.query<NativePresentationQuestionRow>('SELECT * FROM studio_presentation_questions WHERE session_id=$1 AND id=$2',[r.id,id])).rows[0];if(!q)throw new AppError('PRESENTATION_QUESTION_CHANGED','本次问题不存在或已经变化。',409);return{...q,position_ms:integer(q.position_ms),version:integer(q.version)};}
 async enqueue(p:Principal,r:NativePresentationSessionRow){
  if(r.answer_mode!=='local_model')return null;const live=await this.presentations.liveSource(p,r),q=await this.question(r),configuration=presentationAnswerConfiguration.parse(JSON.parse(r.answer_configuration!)),request=presentationAnswerRequest.parse({question:q.body,pageId:q.page_id,sources:presentationAnswerSources(live.source.doc),language:configuration.voice.locale});
  if(q.status!=='pending'||q.actor_id!==p.userId)throw new AppError('PRESENTATION_QUESTION_CHANGED','当前问题不能生成新的自动任务。',409);
  const id=randomUUID(),inputHash=hash({request,configuration,sourceHash:r.source_hash,artifactHash:r.artifact_hash,actorId:q.actor_id});
  await this.db.query("INSERT INTO studio_presentation_answer_jobs(id,session_id,question_id,tenant_id,workspace_id,actor_id,environment,app_env,source_hash,request,configuration,input_hash,control_generation,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'mock',$7,$8,$9,$10,$11,$12,dg_utc_now(),dg_utc_now())",[id,r.id,q.id,r.tenant_id,r.workspace_id,q.actor_id,this.db.config.appEnv,r.source_hash,JSON.stringify(request),JSON.stringify(configuration),inputHash,r.answer_generation]);
  await this.db.query('INSERT INTO _dg_native_answer_inputs VALUES($1,$2,$3,$4,$5,dg_utc_now())',[id,hash(request),r.actor_id,r.artifact_id,r.artifact_hash]);return id;
 }
 async row(p:Principal,id:string,write=false,host=false){
  requirePermission(p,'asset.read');const found=(await this.db.query<NativeAnswerRow>("SELECT * FROM studio_presentation_answer_jobs WHERE id=$1 AND tenant_id=$2 AND environment='mock' AND app_env=$3",[id,p.tenantId,this.db.config.appEnv])).rows[0];
  if(!found)throw new AppError('NOT_FOUND','自动答疑任务不存在或不在当前环境。',404);
  await this.db.query('SELECT user_id FROM dg_native_locked_membership($1)',[found.actor_id]);await this.presentations.session(p,found.session_id,write,host);
  const row=(await this.db.query<NativeAnswerRow>('SELECT * FROM studio_presentation_answer_jobs WHERE id=$1 FOR '+(write?'UPDATE':'SHARE'),[id])).rows[0];return nativeAnswerRow(row);
 }
 fixed(row:NativeAnswerRow){return{request:presentationAnswerRequest.parse(JSON.parse(row.request)),configuration:presentationAnswerConfiguration.parse(JSON.parse(row.configuration))};}
 active(row:NativeAnswerRow,r:NativePresentationSessionRow){return r.state==='question'&&r.active_question_id===row.question_id&&r.answer_generation===row.control_generation;}
 async checkFixed(p:Principal,row:NativeAnswerRow,r:NativePresentationSessionRow,q:NativePresentationQuestionRow){
  const live=await this.presentations.liveSource(p,r),fixed=this.fixed(row),ledger=(await this.db.query<InputLedger>('SELECT request_sha256,host_id,artifact_id,artifact_hash FROM _dg_native_answer_inputs WHERE job_id=$1',[row.id])).rows[0];
  if(!ledger||ledger.request_sha256!==hash(fixed.request)||ledger.host_id!==r.actor_id||ledger.artifact_id!==r.artifact_id||ledger.artifact_hash!==r.artifact_hash||row.source_hash!==r.source_hash||fixed.request.question!==q.body||fixed.request.pageId!==q.page_id||canonical(fixed.request.sources)!==canonical(presentationAnswerSources(live.source.doc))||hash({request:fixed.request,configuration:fixed.configuration,sourceHash:r.source_hash,artifactHash:r.artifact_hash,actorId:q.actor_id})!==row.input_hash)throw new AppError('PRESENTATION_ANSWER_INPUT_CHANGED','固定讲稿、问题、声音或来源校验不符，旧答复已隐藏。',409);
  return{p,session:r,question:q,...fixed};
 }
 async readContext(p:Principal,row:NativeAnswerRow){const r=await this.presentations.session(p,row.session_id),q=await this.question(r,row.question_id);return this.checkFixed(p,row,r,q);}
 async current(row:NativeAnswerRow){let p:Principal;try{p=await this.core.principal(row.actor_id);requireWorkspace(p,row.workspace_id);}catch(e){if(e instanceof AppError&&(e.status===401||e.status===403))throw new AppError('PRESENTATION_ANSWER_ACTOR_CHANGED','提问成员权限已变化，请转人工处理当前问题。',409);throw e;}const c=await this.readContext(p,row);if(!this.active(row,c.session)||c.session.answer_mode!=='local_model'||c.session.answer_configuration!==row.configuration||c.question.status!=='pending')throw new AppError('PRESENTATION_ANSWER_STALE','当前问题、成员权限或控制代次已变化，旧答复不会写回。',409);return c;}
 async workerContext(row:NativeAnswerRow,completed=false,write=false){
  const value=(await this.db.query<{value:WorkerContext|null}>('SELECT dg_native_answer_context($1,$2,$3) AS value',[row.id,row.lease_token,completed])).rows[0].value;
  if(!value)throw new AppError('PRESENTATION_ANSWER_STALE','本机任务租约、问题、成员权限或控制代次已变化。',409);
  const session=nativePresentationSessionRow(value.session);
  for(const id of [...new Set([row.actor_id,session.actor_id])].sort())await this.core.principal(id);
  const p=await this.core.principal(row.actor_id);requireWorkspace(p,row.workspace_id);await this.core.workspaceLock(p,row.workspace_id,write);
  const latest=(await this.db.query<{value:WorkerContext|null}>('SELECT dg_native_answer_context($1,$2,$3) AS value',[row.id,row.lease_token,completed])).rows[0].value;
  if(!latest)throw new AppError('PRESENTATION_ANSWER_STALE','等待期间当前问题或本机租约已变化。',409);
  const fresh=nativePresentationSessionRow(latest.session),question={...latest.question,version:integer(latest.question.version),position_ms:integer(latest.question.position_ms)};return this.checkFixed(p,row,fresh,question);
 }
 validateNative(context:Awaited<ReturnType<NativePresentationAnswers['checkFixed']>>,value:unknown):PresentationAnswerNativeResult{
  const native=presentationAnswerNativeResult.parse(value);if(canonical(native.evidence.engine)!==canonical(context.configuration.engine)||native.evidence.inputSHA256!==hash(context.request))throw new AppError('PRESENTATION_ANSWER_ENGINE_CHANGED','实际模型或输入不符合固定任务，未采用答复。',409);
  assertPresentationAnswerComposition(context.request,native.result,native.evidence);this.presentations.text(native.result.answer,...(native.result.composition?.parts.map(p=>p.answer)??[]));
  for(const c of native.result.citations){const source=context.request.sources.find(s=>s.id===c.sourceId);if(!source||source.pageId!==c.pageId||source.pageNumber!==c.pageNumber||source.title!==c.title||!source.text.includes(c.quote)||!native.evidence.retrievedSourceIds.includes(c.sourceId))throw new AppError('PRESENTATION_ANSWER_CITATION','实际答复的讲稿出处不符，未采用。',409);}
  if(native.result.supported!==!!native.result.citations.length)throw new AppError('PRESENTATION_ANSWER_CITATION','答复与出处状态不一致，未采用。',409);return native;
 }
 async control(p:Principal,row:NativeAnswerRow,input:z.infer<typeof presentationAnswerJobControl>){
  const c=await this.readContext(p,row),r=c.session;this.presentations.host(p,r);this.presentations.studio.version(r,input.version);this.presentations.studio.version(row,input.jobVersion);
  if(!this.active(row,r))throw new AppError('PRESENTATION_ANSWER_STALE','当前问题已变化，不能操作旧任务。',409);
  if(input.action==='take_over'){
   await this.presentations.interruptAutomatic(r,true);await this.db.query('UPDATE studio_presentation_sessions SET answer_generation=answer_generation+1,version=version+1,updated_at=dg_utc_now() WHERE id=$1',[r.id]);
   if(c.question.status==='answered'&&c.question.answer_job_id===row.id)await this.db.query("UPDATE studio_presentation_questions SET status='pending',answer=NULL,answer_job_id=NULL,answer_by=NULL,answer_at=NULL,version=version+1 WHERE id=$1",[row.question_id]);return row.id;
  }
  if(!['failed','cancelled'].includes(row.status)||row.attempts>=3)throw new AppError('PRESENTATION_ANSWER_RETRY','任务不可重试或已达到三次上限，请转人工处理当前问题。',409);await this.current(row);
  await this.db.query("UPDATE studio_presentation_answer_jobs SET status='queued',version=version+1,progress=0,error_code=NULL,error_message=NULL,lease_token=NULL,lease_until=NULL,updated_at=dg_utc_now() WHERE id=$1",[row.id]);return row.id;
 }
 async playbackContext(p:Principal,row:NativeAnswerRow){const c=await this.readContext(p,row);this.presentations.host(p,c.session);if(!this.active(row,c.session)||row.status!=='succeeded'||c.question.answer_job_id!==row.id||!row.audio_key||!row.audio_format)throw new AppError('PRESENTATION_ANSWER_PLAYBACK_STALE','问题已变化、答复已停止或语音尚未完成，请刷新核对。',409);return c;}
 async openAudio(row:NativeAnswerRow){
  if(row.status!=='succeeded'||!row.audio_key||!row.audio_format)throw new AppError('PRESENTATION_ANSWER_AUDIO_UNAVAILABLE','答复语音尚未完成或不可用。',409);
  const ledger=(await this.db.query<{result:string;evidence:string;audio_key:string;audio_format:string}>('SELECT result,evidence,audio_key,audio_format FROM _dg_native_answer_outputs WHERE job_id=$1',[row.id])).rows[0];
  if(!ledger||ledger.result!==row.result||ledger.evidence!==row.evidence||ledger.audio_key!==row.audio_key||ledger.audio_format!==row.audio_format)throw new AppError('PRESENTATION_ANSWER_AUDIO_CHANGED','答复与语音凭据不一致，已停止提供文件。',409);
  const format=JSON.parse(row.audio_format) as {sha256:string;size:number;durationMs:number};return this.files.open({storage_key:row.audio_key,media_type:'audio/wav',sha256:format.sha256,size:format.size});
 }
 async startPlayback(p:Principal,row:NativeAnswerRow,input:z.infer<typeof presentationAnswerPlaybackStart>){
  const c=await this.playbackContext(p,row),r=c.session;this.presentations.studio.version(r,input.version);this.presentations.studio.version(row,input.jobVersion);
  if(row.playback_version!==input.playbackVersion)throw new AppError('PRESENTATION_ANSWER_PLAYER_CHANGED','播放代次已变化，请刷新核对。',409);
  const at=await this.db.now();if(!input.replace&&row.playback_state==='playing'&&row.playback_lease_until&&row.playback_lease_until>at&&(row.playback_client_id!==input.clientId||row.playback_actor_id!==p.userId))throw new AppError('PRESENTATION_ANSWER_PLAYER_BUSY','另一主持设备正在播放，请明确接管或等待播放租约到期。',409);
  const audio=await this.openAudio(row);await audio.handle.close();const format=JSON.parse(row.audio_format!) as {durationMs:number},start=await this.db.now();
  await this.db.query("UPDATE studio_presentation_answer_jobs SET version=version+1,playback_state='playing',playback_version=playback_version+1,playback_actor_id=$1,playback_client_id=$2,playback_started_at=$3,playback_lease_until=$4,updated_at=$3 WHERE id=$5",[p.userId,input.clientId,start,new Date(Date.parse(start)+Math.ceil(format.durationMs)+30000).toISOString(),row.id]);return row.id;
 }
 async endPlayback(p:Principal,row:NativeAnswerRow,input:z.infer<typeof presentationAnswerPlaybackEnd>){
  const c=await this.playbackContext(p,row),at=await this.db.now();if(row.playback_state!=='playing'||row.playback_actor_id!==p.userId||row.playback_client_id!==input.clientId||row.playback_version!==input.playbackVersion||!row.playback_started_at||!row.playback_lease_until||row.playback_lease_until<=at)throw new AppError('PRESENTATION_ANSWER_PLAYER_CHANGED','播放设备、代次或租约已变化，旧回调不会继续讲解。',409);
  const format=JSON.parse(row.audio_format!) as {durationMs:number};if(Date.parse(at)-Date.parse(row.playback_started_at)<Math.ceil(format.durationMs)-100)throw new AppError('PRESENTATION_ANSWER_AUDIO_NOT_FINISHED','服务端尚未到达语音结束时间，请播完后再继续。',409);
  const audio=await this.openAudio(row);await audio.handle.close();await this.db.query("UPDATE studio_presentation_answer_jobs SET version=version+1,playback_state='completed',playback_lease_until=NULL,updated_at=dg_utc_now() WHERE id=$1",[row.id]);
  if(c.configuration.autoResume){const view=await this.presentations.viewSession(p,c.session);await this.presentations.control(c.session,{version:c.session.version,observedPageId:view.currentPageId,action:'continue',questionId:row.question_id,confirmed:true});}return row.id;
 }
 async view(p:Principal,row:NativeAnswerRow):Promise<PresentationAnswerJob>{
  let reason:string|null=null;try{await this.readContext(p,row);if(row.status==='succeeded'){const a=await this.openAudio(row);await a.handle.close();}}catch(e){if(!(e instanceof AppError))throw e;reason=e.message;}
  const r=await this.presentations.session(p,row.session_id);let host=false;try{this.presentations.host(p,r);host=true;}catch(e){if(!(e instanceof AppError))throw e;}
  const active=!reason&&this.active(row,r);let canRetry=false;if(active&&host&&['failed','cancelled'].includes(row.status)&&row.attempts<3)try{await this.current(row);canRetry=true;}catch(e){if(!(e instanceof AppError))throw e;}
  return presentationAnswerJobSchema.parse({id:row.id,sessionId:row.session_id,questionId:row.question_id,version:row.version,status:row.status,attempts:row.attempts,progress:row.progress,active,available:!reason,unavailableReason:reason,result:reason||!row.result?null:JSON.parse(row.result),evidence:reason||!row.evidence?null:JSON.parse(row.evidence),audio:reason||row.status!=='succeeded'||!row.audio_format?null:{...JSON.parse(row.audio_format),url:'/api/v1/studio/presentations/answers/'+row.id+'/audio'},playback:{version:row.playback_version,state:row.playback_state,clientId:row.playback_client_id,startedAt:row.playback_started_at,leaseUntil:row.playback_lease_until},canControl:host&&active,canRetry,errorCode:row.error_code,errorMessage:row.error_message,createdAt:row.created_at,updatedAt:row.updated_at});
 }
 async list(p:Principal,sessionId:string){
  const ids=(await this.db.query<{id:string;actor_id:string}>("SELECT id,actor_id FROM studio_presentation_answer_jobs WHERE session_id=$1 AND tenant_id=$2 AND environment='mock' AND app_env=$3 ORDER BY created_at,id LIMIT 100",[sessionId,p.tenantId,this.db.config.appEnv])).rows;
  for(const actor of [...new Set(ids.map(r=>r.actor_id))].sort())await this.db.query('SELECT user_id FROM dg_native_locked_membership($1)',[actor]);await this.presentations.session(p,sessionId);const result=[];for(const r of ids)result.push(await this.view(p,await this.row(p,r.id)));return result;
 }
 async audio(p:Principal,id:string):Promise<{handle:FileHandle;size:number}>{const row=await this.row(p,id);await this.readContext(p,row);const opened=await this.openAudio(row);try{await this.readContext(p,row);return opened;}catch(e){await opened.handle.close();throw e;}}
}
