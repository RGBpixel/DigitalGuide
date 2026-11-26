import { AppError } from './index.js';
import type { CharacterMotionPlan,MotionEvent } from '@digitalguide/contracts';
export function validateMotionEvents(events:MotionEvent[],durationMs:number){
 const ids=new Set<string>();for(const event of events){if(ids.has(event.id))throw new AppError('MOTION_EVENT_DUPLICATE','动作编号重复，请删除重复条目。',409);ids.add(event.id);if(event.startMs+event.durationMs>durationMs)throw new AppError('MOTION_EVENT_RANGE','动作超出当前片段，请调整起点或时长。',409);}
 for(const channel of ['gesture','expression']){const sorted=events.filter(e=>e.channel===channel).sort((a,b)=>a.startMs-b.startMs);for(let i=1;i<sorted.length;i++)if(sorted[i].startMs<sorted[i-1].startMs+sorted[i-1].durationMs)throw new AppError('MOTION_CHANNEL_OVERLAP','同一通道的动作不能重叠；手势与表情可以同时发生。',409);}
}
export interface PuppetPose {leftArm:number;rightArm:number;leftElbow:number;rightElbow:number;headNod:number;headTurn:number;smile:number;focus:number;surprise:number;mouth:number}
export function puppetPoseAt(events:MotionEvent[],timeMs:number,speechLevel=0):PuppetPose{
 const pose:PuppetPose={leftArm:0,rightArm:0,leftElbow:0,rightElbow:0,headNod:0,headTurn:0,smile:0,focus:0,surprise:0,mouth:Math.max(0,Math.min(1,Number.isFinite(speechLevel)?speechLevel:0))};
 for(const event of events){if(timeMs<event.startMs||timeMs>=event.startMs+event.durationMs)continue;const progress=(timeMs-event.startMs)/event.durationMs,weight=Math.sin(progress*Math.PI)*event.intensity;
  if(event.channel==='expression'){if(event.action==='smile')pose.smile=weight;if(event.action==='focused')pose.focus=weight;if(event.action==='surprised')pose.surprise=weight;continue;}
  if(event.action==='wave'){pose.rightArm=1.8*weight;pose.rightElbow=(.6-.3*Math.sin(progress*Math.PI*6))*weight;}
  if(event.action==='explain'){pose.leftArm=-.8*weight;pose.rightArm=.8*weight;pose.leftElbow=-.8*weight;pose.rightElbow=.8*weight;}
  if(event.action==='point_left'){pose.leftArm=-1.55*weight;pose.leftElbow=-.1*weight;}
  if(event.action==='point_right'){pose.rightArm=1.55*weight;pose.rightElbow=.1*weight;}
  if(event.action==='nod')pose.headNod=Math.sin(progress*Math.PI*2)*.13*weight;
  if(event.action==='shake')pose.headTurn=Math.sin(progress*Math.PI*3)*.15*weight;
 }
 return pose;
}
export function motionPlanContent(plan:CharacterMotionPlan){return {projectVersion:plan.projectVersion,characterId:plan.characterId,characterVersion:plan.characterVersion,name:plan.name,segmentId:plan.segmentId,startMs:plan.startMs,durationMs:plan.durationMs,voiceAssetId:plan.voiceAssetId,voiceVersion:plan.voiceVersion,events:plan.events,backgroundColor:plan.backgroundColor};}
