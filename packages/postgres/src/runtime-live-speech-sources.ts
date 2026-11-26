import {z} from 'zod';
import {AppError,canonical,requirePermission,type Principal} from '../../domain/src/index.js';
import {liveSpeechSource,liveSpeechWav,liveSpeechPCM,systemVoiceSchema} from '../../contracts/src/index.js';
import {liveSpeechHash,planSpeechInput,jobSpeechInput,type LiveSpeechPlanRow,type LiveSpeechJobRow,type LiveSpeechPlaybackRow} from '../../domain/src/live-speech.js';
import type {NativeLive} from './runtime-live.js';
import {nativeBusinessInteger as integer} from './runtime-repository.js';
import type {NativeMediaArtifact} from './runtime-media-files.js';

export interface NativeLiveSpeechPlanRow extends LiveSpeechPlanRow{invalidated_at:string|null;invalidation_reason:string|null}
export interface NativeLiveSpeechJobRow extends LiveSpeechJobRow{invalidated_at:string|null;invalidation_reason:string|null}
const hash=z.string().regex(/^[a-f0-9]{64}$/),object=z.strictObject({storage_key:z.string().regex(/^[a-f0-9-]{36}\.bin$/),size:z.int().positive(),sha256:hash});
export const nativeLiveSpeechReceipt=z.strictObject({schemaVersion:z.literal(1),pipeline:z.literal('native-live-system-speech-v1'),jobId:z.uuid(),inputHash:hash,voice:systemVoiceSchema,wav:z.strictObject({object,format:liveSpeechWav}),pcm:z.strictObject({object,format:liveSpeechPCM})});
export const nativeLiveSpeechBinding=z.strictObject({planId:z.uuid(),inputHash:hash,planHash:hash});
export type NativeLiveSpeechReceipt=z.infer<typeof nativeLiveSpeechReceipt>;
function numbers<T>(value:T,keys:string[]):T{const result={...value};for(const key of keys)(result as Record<string,unknown>)[key]=integer((value as Record<string,string|number>)[key]);return result;}
export const nativeLiveSpeechPlanRow=(row:NativeLiveSpeechPlanRow)=>numbers(row,['version']);
export const nativeLiveSpeechJobRow=(row:NativeLiveSpeechJobRow)=>numbers(row,['version','control_version','attempts']);
export const nativeLiveSpeechPlaybackRow=(row:LiveSpeechPlaybackRow)=>numbers(row,['epoch','version','position_frames','program_cue_index','program_offset_ms']);

export class NativeLiveSpeechSources{
 constructor(readonly live:NativeLive){}
 get db(){return this.live.db;}
 async plan(p:Principal,id:string,write=false){
  const row=(await this.db.query<NativeLiveSpeechPlanRow>("SELECT * FROM live_speech_plans WHERE id=$1 AND tenant_id=$2 AND environment='mock' AND app_env=$3",[id,p.tenantId,this.db.config.appEnv])).rows[0];
  if(!row)throw new AppError('NOT_FOUND','直播播音方案不存在或不在当前环境。',404);
  await this.live.session(p,row.session_id,write);if(write)requirePermission(p,'live.start');return nativeLiveSpeechPlanRow(row);
 }
 async job(p:Principal,id:string,write=false){
  const row=(await this.db.query<NativeLiveSpeechJobRow>("SELECT * FROM live_speech_jobs WHERE id=$1 AND tenant_id=$2 AND environment='mock' AND app_env=$3",[id,p.tenantId,this.db.config.appEnv])).rows[0];
  if(!row)throw new AppError('NOT_FOUND','直播播音任务不存在或不在当前环境。',404);
  await this.live.session(p,row.session_id,write);if(write)requirePermission(p,'live.start');return nativeLiveSpeechJobRow(row);
 }
 async actor(p:Principal,row:{actor_id:string;tenant_id:string;workspace_id:string}){const actor=await this.live.core.principal(row.actor_id);if(actor.tenantId!==p.tenantId||actor.tenantId!==row.tenant_id)throw new AppError('LIVE_SPEECH_ACTOR_CHANGED','原播音准备人的组织或权限已变化。',409);await this.live.scope(actor,row.workspace_id,false,'live.start');return actor;}
 async planCurrent(p:Principal,row:NativeLiveSpeechPlanRow,ready=false){
  const session=await this.live.session(p,row.session_id);await this.live.current(p,session);await this.actor(p,row);
  if(row.invalidated_at||row.withdrawn_at||['cancelled','withdrawn'].includes(row.status)||row.session_hash!==session.snapshot_hash||liveSpeechHash(planSpeechInput(row))!==row.input_hash)throw new AppError('LIVE_SPEECH_PLAN_UNAVAILABLE',row.invalidation_reason??'系统播音方案已取消、撤回或来源变化，请核对当前方案。',409);
  const input=(await this.db.query<{snapshot:string;input_hash:string}>('SELECT snapshot,input_hash FROM _dg_native_live_speech_plan_inputs WHERE plan_id=$1',[row.id])).rows[0],cues=this.live.snapshot(session).definition.cues.filter(c=>c.kind!=='video').map(c=>({cueId:c.id,text:c.text,durationMs:c.durationMs}));
  if(!input||input.input_hash!==row.input_hash||liveSpeechHash(JSON.parse(input.snapshot))!==row.input_hash||canonical(JSON.parse(input.snapshot))!==canonical(planSpeechInput(row))||canonical(cues)!==canonical(JSON.parse(row.cues)))throw new AppError('LIVE_SPEECH_PLAN_SOURCE','播音固定声音、讲稿或原场次不符。',409);
  if(ready)await this.result(row);return session;
 }
 async result(plan:NativeLiveSpeechPlanRow){
  if(plan.status!=='ready'||!plan.result_hash)throw new AppError('LIVE_SPEECH_PLAN_NOT_READY','系统播音方案尚未完整生成，请等待或处理失败任务。',409);
  const receipt=(await this.db.query<{result:string;result_hash:string}>('SELECT result,result_hash FROM _dg_native_live_speech_plan_outputs WHERE plan_id=$1',[plan.id])).rows[0],rows=(await this.db.query<NativeLiveSpeechJobRow>("SELECT * FROM live_speech_jobs WHERE plan_id=$1 AND source::jsonb->>'kind'='cue' ORDER BY id",[plan.id])).rows.map(nativeLiveSpeechJobRow),clips=[];
  if(rows.length!==JSON.parse(plan.cues).length)throw new AppError('LIVE_SPEECH_PLAN_NOT_READY','节目语音数量与原方案不符。',409);
  for(const row of rows){if(row.withdrawn_at||row.invalidated_at)throw new AppError('LIVE_SPEECH_JOB_UNAVAILABLE','原节目语音用途已变化。',409);const value=await this.receipt(row);clips.push({id:row.id,inputHash:row.input_hash,wav:value.wav.format,pcm:value.pcm.format});}
  const value={inputHash:plan.input_hash,clips};if(!receipt||receipt.result_hash!==plan.result_hash||liveSpeechHash(JSON.parse(receipt.result))!==plan.result_hash||canonical(JSON.parse(receipt.result))!==canonical(value))throw new AppError('LIVE_SPEECH_PLAN_RESULT','节目实际语音与不可覆盖方案回执不符。',409);return rows;
 }
 async current(p:Principal,row:NativeLiveSpeechJobRow,complete=false){
  const plan=await this.plan(p,row.plan_id),source=liveSpeechSource.parse(JSON.parse(row.source)),session=await this.planCurrent(p,plan,complete&&source.kind!=='cue');await this.actor(p,row);
  const input=(await this.db.query<{snapshot:string;input_hash:string}>('SELECT snapshot,input_hash FROM _dg_native_live_speech_job_inputs WHERE job_id=$1',[row.id])).rows[0];
  if(row.invalidated_at||row.withdrawn_at||row.session_id!==plan.session_id||row.workspace_id!==plan.workspace_id||!input||input.input_hash!==row.input_hash||liveSpeechHash(JSON.parse(input.snapshot))!==row.input_hash||canonical(JSON.parse(input.snapshot))!==canonical(jobSpeechInput(row,plan)))throw new AppError('LIVE_SPEECH_SOURCE_CHANGED',row.invalidation_reason??'系统播音任务原输入或用途已变化。',409);
  if(source.kind==='cue'){const cue=this.live.snapshot(session).definition.cues.find(c=>c.id===source.cueId);if(!cue||cue.kind==='video'||cue.text!==source.text||cue.durationMs!==source.durationMs)throw new AppError('LIVE_SPEECH_SOURCE_CHANGED','固定节目文字或时长不符。',409);}
  if(source.kind==='answer'){
   const q=(await this.db.query<{session_id:string;answer:string|null;citations:string;answer_kind:string}>('SELECT session_id,answer,citations,answer_kind FROM live_audience_events WHERE id=$1',[source.questionId])).rows[0];
   if(!q||q.session_id!==session.id||q.answer!==source.text||canonical(JSON.parse(q.citations))!==canonical(source.citations))throw new AppError('LIVE_SPEECH_SOURCE_CHANGED','原答复或引用已经变化。',409);
   if(['knowledge','local_model'].includes(q.answer_kind)&&!(await this.db.query<{valid:boolean}>('SELECT '+(q.answer_kind==='local_model'?'dg_native_live_model_answer_valid':'dg_native_live_knowledge_answer_valid')+'($1) AS valid',[source.questionId])).rows[0].valid)throw new AppError('LIVE_SPEECH_SOURCE_CHANGED','原公开知识已变化或撤回，不能使用旧语音。',409);
  }
  if(complete)await this.receipt(row);return{plan,session,source};
 }
 async receipt(row:NativeLiveSpeechJobRow){
  const raw=(await this.db.query<{receipt:string;receipt_hash:string}>('SELECT receipt,receipt_hash FROM _dg_native_live_speech_outputs WHERE job_id=$1',[row.id])).rows[0];
  if(row.status!=='succeeded'||!raw||liveSpeechHash(JSON.parse(raw.receipt))!==raw.receipt_hash)throw new AppError('LIVE_SPEECH_NOT_READY','实际语音尚未完成或缺少固定回执。',409);
  const receipt=nativeLiveSpeechReceipt.parse(JSON.parse(raw.receipt));if(receipt.jobId!==row.id||receipt.inputHash!==row.input_hash||row.wav_key!==receipt.wav.object.storage_key||row.pcm_key!==receipt.pcm.object.storage_key||canonical(JSON.parse(row.wav_format??'null'))!==canonical(receipt.wav.format)||canonical(JSON.parse(row.pcm_format??'null'))!==canonical(receipt.pcm.format))throw new AppError('LIVE_SPEECH_RESULT_CHANGED','实际语音结果与不可覆盖回执不符。',409);return receipt;
 }
 files(receipt:NativeLiveSpeechReceipt):NativeMediaArtifact[]{return[{...receipt.wav.object,media_type:'audio/wav'},{...receipt.pcm.object,media_type:'application/octet-stream'}];}
 async selected(p:Principal,sessionId:string,planId:string){const output=(await this.db.query<{snapshot:string;invalidated_at:string|null;withdrawn_at:string|null}>('SELECT snapshot,invalidated_at,withdrawn_at FROM live_outputs WHERE session_id=$1',[sessionId])).rows[0];if(!output||output.invalidated_at||output.withdrawn_at||JSON.parse(output.snapshot).settings.speechPlanId!==planId)throw new AppError('LIVE_SPEECH_NOT_SELECTED','请先为本场连续媒体明确选择已完成的系统播音方案。',409);await this.live.session(p,sessionId);}
 async binding(p:Principal,sessionId:string,planId:string){const plan=await this.plan(p,planId);if(plan.session_id!==sessionId)throw new AppError('LIVE_SPEECH_PLAN_SCOPE','系统播音方案必须属于本场节目。',409);await this.planCurrent(p,plan,true);return nativeLiveSpeechBinding.parse({planId:plan.id,inputHash:plan.input_hash,planHash:plan.result_hash});}
 async used(p:Principal,outputId:string){const rows=(await this.db.query<{id:string}>("SELECT DISTINCT frame::jsonb->'speech'->>'jobId' AS id FROM live_output_spans WHERE output_id=$1 AND frame::jsonb->'speech'->>'jobId' IS NOT NULL",[outputId])).rows,receipts=[];for(const row of rows){const job=await this.job(p,row.id);await this.current(p,job,true);receipts.push(await this.receipt(job));}return receipts;}
 async playback(sessionId:string,activeOnly=false){const row=(await this.db.query<LiveSpeechPlaybackRow>("SELECT * FROM live_speech_playbacks WHERE session_id=$1"+(activeOnly?" AND status='active'":''),[sessionId])).rows[0];return row?nativeLiveSpeechPlaybackRow(row):null;}
 async stop(sessionId:string){await this.db.query("UPDATE live_speech_playbacks SET status='stopped',version=version+1,ended_at=dg_utc_now() WHERE session_id=$1 AND status<>'stopped'",[sessionId]);}
 async retarget(sessionId:string,epoch:number){await this.db.query("UPDATE live_speech_playbacks SET epoch=$2,version=version+1 WHERE session_id=$1 AND status='active'",[sessionId,epoch]);}
}
