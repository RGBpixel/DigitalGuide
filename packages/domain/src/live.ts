import type {LiveDefinition,LiveCue} from '@digitalguide/contracts';
import {AppError} from './index.js';

export function validateLiveDefinition(d:LiveDefinition){
 for(const items of [d.cues,d.destinations,d.products])if(new Set(items.map(i=>i.id)).size!==items.length)throw new AppError('LIVE_DUPLICATE_ID','节目、目标或商品编号重复，请重新核对。',409);
 if(d.mode==='prerecorded'&&d.cues.some(c=>c.kind==='realtime'))throw new AppError('LIVE_MODE_CONFLICT','预制模式不能包含实时片段，请选择混合模式。',409);
 if(d.mode==='realtime'&&d.cues.some(c=>c.kind==='video'))throw new AppError('LIVE_MODE_CONFLICT','实时模式不能把预制视频作为实时画面，请选择混合模式。',409);
 if(d.mode!=='prerecorded'&&!d.sceneAppId)throw new AppError('LIVE_SCENE_REQUIRED','实时或混合节目需绑定公开的直播场景应用。',409);
}
export interface LiveClock{
 clockAt:number|null;elapsedMs:number;cueIndex:number;offsetMs:number;surface:'program'|'backup'|'manual'|'answer';paused:boolean;muted:boolean;manual:boolean;interactionsPaused:boolean;epoch:number;answerId:string|null;answerRemainingMs:number;answerText:string;manualText:string;segmentStartMs:number;segmentSourceInMs:number;stopped:boolean;
}
export interface LiveSegment{seq:number;startMs:number;durationMs:number;cueId:string;kind:'video'|'card';sourceInMs:number;frozen:boolean;muted:boolean;text:string;label:string;backgroundColor:string;answerId:string|null}
export function newLiveClock():LiveClock{return{clockAt:null,elapsedMs:0,cueIndex:0,offsetMs:0,surface:'program',paused:false,muted:false,manual:false,interactionsPaused:false,epoch:1,answerId:null,answerRemainingMs:0,answerText:'',manualText:'',segmentStartMs:0,segmentSourceInMs:0,stopped:false};}
export function surfaceText(d:LiveDefinition,s:LiveClock){const cue=d.cues[s.cueIndex];return s.surface==='backup'?d.backup.text:s.surface==='manual'?s.manualText:s.surface==='answer'?s.answerText:cue.kind==='video'?'':cue.text;}
export function closeLiveSegment(d:LiveDefinition,s:LiveClock,seq:number):LiveSegment|null{
 const durationMs=s.elapsedMs-s.segmentStartMs;if(durationMs<=0)return null;const cue=d.cues[s.cueIndex],video=s.surface==='program'&&cue.kind==='video';
 const out:LiveSegment={seq,startMs:s.segmentStartMs,durationMs,cueId:cue.id,kind:video?'video':'card',sourceInMs:s.segmentSourceInMs,frozen:video&&s.paused,muted:s.muted,text:surfaceText(d,s),label:s.surface==='program'?(cue.kind==='video'?'预制节目 · 本地模拟直播':cue.kind==='realtime'?'模拟数字人输出 · 非真实实时渲染':'备用画面 · 本地模拟直播'):s.surface==='answer'?'模拟问答插播':s.surface==='manual'?'人工文字接管':'备用画面',backgroundColor:d.backup.color,answerId:s.answerId};s.segmentStartMs=s.elapsedMs;s.segmentSourceInMs=cue.kind==='video'?cue.sourceInMs+s.offsetMs:0;return out;
}
export function openLiveSegment(d:LiveDefinition,s:LiveClock){const cue=d.cues[s.cueIndex];s.segmentStartMs=s.elapsedMs;s.segmentSourceInMs=cue.kind==='video'?cue.sourceInMs+s.offsetMs:0;}
export const liveTimelineMaximum=600;
export const liveTimelineTerminalReason='本场已达到600段时间轴容量并停止。归档以已保存片段为准，请新建场次继续；未记录的尾段不会补造。';
// Only the uncommitted open interval is discarded when an older full ledger is sealed.
export function sealFullLiveTimeline(s:LiveClock){const pending=Math.max(0,s.elapsedMs-s.segmentStartMs);if(s.surface==='program'&&!s.paused)s.offsetMs=Math.max(0,s.offsetMs-pending);s.elapsedMs=s.segmentStartMs;s.stopped=true;s.clockAt=null;}
export function advanceLiveClock(d:LiveDefinition,input:LiveClock,now:number,nextSeq:number){
 const s=structuredClone(input),segments:LiveSegment[]=[],answered:string[]=[];
 if(nextSeq>=liveTimelineMaximum){if(s.clockAt!==null)sealFullLiveTimeline(s);else s.stopped=true;return{state:s,segments,answered};}
 if(s.clockAt===null||s.stopped)return{state:s,segments,answered};
 let delta=Math.min(Math.max(0,now-s.clockAt),Math.max(0,d.maxDurationMs-s.elapsedMs));s.clockAt=Math.max(now,s.clockAt);
 const close=()=>{const segment=closeLiveSegment(d,s,nextSeq+segments.length);if(segment)segments.push(segment);if(nextSeq+segments.length>=liveTimelineMaximum){s.stopped=true;s.clockAt=null;}};
 while(delta>0&&!s.stopped){
  const cue=d.cues[s.cueIndex];let span=delta;
  if(s.surface==='answer')span=Math.min(span,s.answerRemainingMs);else if(s.surface==='program'&&!s.paused)span=Math.min(span,cue.durationMs-s.offsetMs);
  if(span<=0)throw new AppError('LIVE_CLOCK_INVALID','节目时钟无法继续，请人工停止后核对节目单。',409);
  s.elapsedMs+=span;delta-=span;
  if(s.surface==='answer'){
   s.answerRemainingMs-=span;if(s.answerRemainingMs===0){close();if(s.answerId)answered.push(s.answerId);s.answerId=null;s.answerText='';s.surface='program';s.epoch++;if(!s.stopped)openLiveSegment(d,s);}
  }else if(s.surface==='program'&&!s.paused){
   s.offsetMs+=span;if(s.offsetMs>=cue.durationMs){close();if(s.stopped)break;if(s.cueIndex+1<d.cues.length)s.cueIndex++;else if(d.loop)s.cueIndex=0;else{s.stopped=true;s.clockAt=null;break;}s.offsetMs=0;s.epoch++;openLiveSegment(d,s);}
  }
 }
 if(s.elapsedMs>=d.maxDurationMs&&!s.stopped){close();s.stopped=true;s.clockAt=null;}
 return{state:s,segments,answered};
}
export function cueById(d:LiveDefinition,id:string):LiveCue{const c=d.cues.find(c=>c.id===id);if(!c)throw new AppError('LIVE_CUE_NOT_FOUND','节目片段不在本场固定节目单中。',404);return c;}
