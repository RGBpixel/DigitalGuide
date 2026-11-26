import type {LiveDefinition,LivePresentation} from '@digitalguide/contracts';
export interface LiveOutputPuppetFrame{characterId:string;characterVersion:number;renderer:'digitalguide-puppet-rms-v1'}
import {advanceLiveClock,liveTimelineMaximum,type LiveClock} from './live.js';
export interface LiveOutputSpeechFrame{jobId:string;inputHash:string;kind:'cue'|'answer'|'manual';offsetSamples:number;totalFrames:number;playbackVersion:number|null}
export interface ProgrammeOutputGuest{connectionId:string;grantId:string;consentHash:string;controlVersion:number;publicName:string;camera:boolean;microphone:boolean;recordingAllowed:boolean;expiresAt:string;audioMuted:boolean;videoHidden:boolean}
export interface LiveOutputFrameDescription{guests?:ProgrammeOutputGuest[];cueId:string;kind:'video'|'card';sourceMs:number;text:string;label:string;backgroundColor:string;answerId:string|null;muted:boolean;frozen:boolean;buffering:boolean;sessionVersion:number;epoch:number;presentationVersion:number;presentation:LivePresentation;surface?:'program'|'backup'|'manual'|'answer';speech?:LiveOutputSpeechFrame;puppet?:LiveOutputPuppetFrame}
export function advanceProducedFrame(definition:LiveDefinition,current:LiveClock,frameIndex:number,sourceReady:boolean,matchingInstruction:boolean,nextSeq:number,freezeSpokenAnswer=false){
 const delta=Math.round((frameIndex+1)*1000/24)-Math.round(frameIndex*1000/24),copy=structuredClone(current),paused=copy.paused;
 if(copy.stopped||nextSeq>=liveTimelineMaximum){copy.stopped=true;copy.clockAt=null;return{state:copy,segments:[],answered:[]};}
 if(!matchingInstruction||freezeSpokenAnswer&&copy.surface==='answer'&&copy.paused){copy.elapsedMs=Math.min(definition.maxDurationMs,copy.elapsedMs+delta);if(copy.elapsedMs>=definition.maxDurationMs){copy.stopped=true;copy.clockAt=null;}return{state:copy,segments:[],answered:[]};}
 const waiting=copy.surface==='program'&&definition.cues[copy.cueIndex].kind==='video'&&!sourceReady;
 if(waiting)copy.paused=true;copy.clockAt=0;const result=advanceLiveClock(definition,copy,delta,nextSeq);result.state.clockAt=null;if(waiting)result.state.paused=paused;return result;
}
