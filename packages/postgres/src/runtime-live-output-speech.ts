import {AppError} from '../../domain/src/index.js';
import {liveSpeechPCM,liveSpeechSource} from '../../contracts/src/index.js';
import type {LiveClock} from '../../domain/src/live.js';
import type {LiveOutputFrameDescription} from '../../domain/src/live-output.js';
import type {NativeLiveOutputs} from './runtime-live-outputs.js';
import type {NativeLiveSessionRow} from './runtime-live-shapes.js';
import type {NativeOutputRow,NativeOutputGeneration} from './runtime-live-output-state.js';
import type {NativeLiveSpeechJobRow} from './runtime-live-speech-sources.js';

export function alignNativeSpokenAnswer(state:LiveClock,globalFrame:number,frame:LiveOutputFrameDescription){if(frame.speech?.kind==='answer'&&state.surface==='answer'&&!state.paused){const remaining=frame.speech.totalFrames-Math.floor(frame.speech.offsetSamples/2000);state.answerRemainingMs=Math.round((globalFrame+remaining)*1000/24)-Math.round(globalFrame*1000/24);}}
export function nativeSpeechFrameKey(frame:LiveOutputFrameDescription){return{...frame,sourceMs:0,...(frame.speech?{speech:{...frame.speech,offsetSamples:0}}:{})};}
interface Span{frame:string;first_frame:string|number;last_frame:string|number;cutoff?:string|number}

export class NativeLiveOutputSpeech{
 constructor(readonly service:NativeLiveOutputs){}
 get db(){return this.service.db;}
 async packet(output:NativeOutputRow,session:NativeLiveSessionRow,state:LiveClock){
  const planId=this.service.outputSnapshot(output).settings.speechPlanId;if(!planId)return null;
  const active=await this.service.speech.playback(session.id,true);let job:NativeLiveSpeechJobRow|undefined,offsetSamples=0,playbackVersion:number|null=null;
  if(active&&active.epoch===state.epoch&&(active.kind==='manual'&&state.surface==='manual'&&state.manual||active.kind==='answer'&&state.surface==='answer')){job=(await this.db.query<NativeLiveSpeechJobRow>('SELECT * FROM live_speech_jobs WHERE id=$1',[active.job_id])).rows[0];offsetSamples=active.position_frames*2000;playbackVersion=active.version;}
  else if(state.surface==='program'){const cue=this.service.snapshot(session).definition.cues[state.cueIndex];if(cue.kind!=='video'){job=(await this.db.query<NativeLiveSpeechJobRow>("SELECT * FROM live_speech_jobs WHERE plan_id=$1 AND source::jsonb->>'kind'='cue' AND source::jsonb->>'cueId'=$2",[planId,cue.id])).rows[0];if(!job)throw new AppError('LIVE_SPEECH_CUE_MISSING','固定节目语音缺失，不能继续以静音冒充播音。',409);offsetSamples=Math.round(state.offsetMs*24/1000)*2000;}}
  if(!job)return null;if(job.plan_id!==planId||job.session_id!==session.id||job.status!=='succeeded'||job.withdrawn_at||job.invalidated_at||!job.pcm_key||!job.pcm_format)throw new AppError('LIVE_SPEECH_AUDIO_UNAVAILABLE','当前节目语音未完成或用途已撤回，不能继续输出。',409);
  const source=liveSpeechSource.parse(JSON.parse(job.source)),pcm=liveSpeechPCM.parse(JSON.parse(job.pcm_format));if(source.kind==='answer'&&source.questionId!==state.answerId)throw new AppError('LIVE_SPEECH_PLAY_STALE','当前答复和语音任务不一致。',409);
  return{speech:{jobId:job.id,inputHash:job.input_hash,kind:source.kind,offsetSamples,totalFrames:pcm.frames,playbackVersion},speechMedia:{jobId:job.id,file:this.service.team.media.files.file(job.pcm_key),size:pcm.size,sha256:pcm.sha256}};
 }
 async matches(sessionId:string,frame:LiveOutputFrameDescription){if(!frame.speech||frame.speech.kind==='cue')return true;const active=await this.service.speech.playback(sessionId,true);return!!active&&active.job_id===frame.speech.jobId&&active.version===frame.speech.playbackVersion&&active.epoch===frame.epoch&&active.position_frames*2000===frame.speech.offsetSamples;}
 async advance(sessionId:string,frame:LiveOutputFrameDescription,matching:boolean,ready:boolean){if(!matching||!ready||frame.frozen||!frame.speech||frame.speech.kind==='cue')return;const active=await this.service.speech.playback(sessionId,true);if(!active||!await this.matches(sessionId,frame))return;const position=active.position_frames+1,complete=position>=frame.speech.totalFrames;await this.db.query("UPDATE live_speech_playbacks SET position_frames=$1,status=$2,ended_at=CASE WHEN $3 THEN dg_utc_now() ELSE NULL END WHERE session_id=$4 AND version=$5 AND status='active'",[position,complete?'completed':'active',complete,sessionId,active.version]);}
 async recover(output:NativeOutputRow,session:NativeLiveSessionRow,state:LiveClock){
  if(!this.service.outputSnapshot(output).settings.speechPlanId)return false;
  const generation=(await this.db.query<NativeOutputGeneration>('SELECT * FROM live_output_generations WHERE output_id=$1 AND published_frames>0 ORDER BY number DESC LIMIT 1',[output.id])).rows[0],cutoff=generation?Number(generation.start_frame)+Number(generation.published_frames):0,last=generation?(await this.db.query<Span>('SELECT frame,first_frame,last_frame FROM live_output_spans WHERE generation_id=$1 AND first_frame<$2 ORDER BY first_frame DESC LIMIT 1',[generation.id,cutoff])).rows[0]:null,published=last?JSON.parse(last.frame) as LiveOutputFrameDescription:null;
  const candidate=await this.service.speech.playback(session.id),playback=candidate&&['active','completed'].includes(candidate.status)?candidate:null;
  if(playback){
   const job=(await this.db.query<NativeLiveSpeechJobRow>('SELECT * FROM live_speech_jobs WHERE id=$1',[playback.job_id])).rows[0];if(!job||job.status!=='succeeded'||job.withdrawn_at||job.invalidated_at||!job.pcm_format){await this.service.speech.stop(session.id);return false;}const source=liveSpeechSource.parse(JSON.parse(job.source)),total=JSON.parse(job.pcm_format).frames as number;
   const span=(await this.db.query<Span>("SELECT s.frame,s.first_frame,s.last_frame,g.start_frame+g.published_frames AS cutoff FROM live_output_spans s JOIN live_output_generations g ON g.id=s.generation_id WHERE s.output_id=$1 AND g.published_frames>0 AND s.first_frame<g.start_frame+g.published_frames AND s.frame::jsonb->'speech'->>'jobId'=$2 ORDER BY g.number DESC,s.first_frame DESC LIMIT 1",[output.id,job.id])).rows[0],frame=span?JSON.parse(span.frame) as LiveOutputFrameDescription:null,position=Math.min(total,frame?.speech?Math.floor(frame.speech.offsetSamples/2000)+(frame.frozen?0:Math.max(0,Math.min(Number(span!.last_frame),Number(span!.cutoff)-1)-Number(span!.first_frame)+1)):0);
   if(position<total&&source.kind!=='cue'&&(playback.kind==='manual'&&state.manual&&state.surface==='manual'||playback.kind==='answer'&&(state.surface==='answer'&&state.answerId===(source.kind==='answer'?source.questionId:null)||playback.status==='completed'&&state.surface==='program'))){
    await this.db.query("UPDATE live_speech_playbacks SET position_frames=$1,status='active',ended_at=NULL WHERE session_id=$2",[position,session.id]);state.cueIndex=playback.program_cue_index;state.offsetMs=playback.program_offset_ms;
    if(source.kind==='answer'){state.surface='answer';state.answerId=source.questionId;state.answerText=source.text;state.answerRemainingMs=Math.ceil((total-position)*1000/24);await this.db.query("UPDATE live_audience_events SET status='playing',version=version+1 WHERE id=$1 AND status='answered'",[source.questionId]);}return true;
   }
   if(position>=total){await this.db.query("UPDATE live_speech_playbacks SET position_frames=$1,status='completed',ended_at=dg_utc_now() WHERE session_id=$2",[total,session.id]);if(source.kind==='answer'&&(state.surface==='answer'||playback.status==='completed'&&state.surface==='program'&&published?.sessionVersion===session.version&&published.speech?.jobId===job.id)){state.cueIndex=playback.program_cue_index;state.offsetMs=playback.program_offset_ms;state.surface='program';state.answerId=null;state.answerText='';state.answerRemainingMs=0;await this.db.query("UPDATE live_audience_events SET status='answered',version=version+1 WHERE id=$1 AND status='playing'",[source.questionId]);}return false;}
  }
  const definition=this.service.snapshot(session).definition;
  if(state.surface==='program'&&(!published||published.surface!=='program'||published.sessionVersion!==session.version)){
   const first=(await this.db.query<{frame:string}>("SELECT s.frame FROM live_output_spans s JOIN live_output_generations g ON g.id=s.generation_id WHERE s.output_id=$1 AND s.session_version=$2 AND s.frame::jsonb->>'surface'='program' AND s.first_frame>=g.start_frame+g.published_frames ORDER BY g.number,s.first_frame LIMIT 1",[output.id,session.version])).rows[0];
   if(first){const frame=JSON.parse(first.frame) as LiveOutputFrameDescription,index=definition.cues.findIndex(c=>c.id===frame.cueId);if(index>=0){const cue=definition.cues[index];state.cueIndex=index;state.offsetMs=frame.speech?Math.round(frame.speech.offsetSamples/48):Math.max(0,Math.round(frame.sourceMs-(cue.kind==='video'?cue.sourceInMs:0)));}}
  }
  if(state.surface==='program'&&published?.surface==='program'&&published.sessionVersion===session.version&&last){const index=definition.cues.findIndex(c=>c.id===published.cueId);if(index>=0){const frames=Math.max(0,Math.min(Number(last.last_frame),cutoff-1)-Number(last.first_frame)+1),cue=definition.cues[index];state.cueIndex=index;state.offsetMs=published.speech?Math.round((published.speech.offsetSamples/2000+(published.frozen?0:frames))*1000/24):Math.max(0,Math.round(published.sourceMs-(cue.kind==='video'?cue.sourceInMs:0)+(published.frozen?0:frames*1000/24)));if(state.offsetMs>=cue.durationMs){if(index+1<definition.cues.length){state.cueIndex++;state.offsetMs=0;}else if(definition.loop){state.cueIndex=0;state.offsetMs=0;}else state.offsetMs=cue.durationMs-1;}}}
  return false;
 }
}
