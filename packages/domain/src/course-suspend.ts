import type {CourseDefinition,LearningState,LearningResponse} from '@digitalguide/contracts';
import {CourseRuleError,courseEdges,newLearningState} from './courses.js';

// Original compact format, shared by the platform and standalone SCO. No ADL runtime code is copied.
export function encodeCourseSuspend(d:CourseDefinition,s:LearningState,releaseHash:string){
 const bytes:number[]=[],u8=(n:number)=>bytes.push(n),u32=(n:number)=>{if(!Number.isInteger(n)||n<0||n>10800000)throw new CourseRuleError('SUSPEND_RANGE','学习断点超出可保存范围。');bytes.push(n>>>24,(n>>>16)&255,(n>>>8)&255,n&255);},index=(id:string)=>{const i=d.nodes.findIndex(n=>n.id===id);if(i<0)throw new CourseRuleError('SUSPEND_NODE','断点节点不属于课程。');return i;};
 if(!/^[a-f0-9]{64}$/.test(releaseHash)||s.path.length>100||s.responses.length>100||s.watched.length>100||s.playback.ranges.length>64)throw new CourseRuleError('SUSPEND_RANGE','学习断点不能完整保存，请联系管理员。');
 u8(1);for(let i=0;i<64;i+=2)u8(parseInt(releaseHash.slice(i,i+2),16));u8(s.completed?1:0);u8(index(s.currentNodeId));u8(s.path.length);s.path.forEach(id=>u8(index(id)));u8(s.responses.length);
 for(const r of s.responses){const n=d.nodes[index(r.nodeId)];u8(index(r.nodeId));u8(r.correct?1:0);u8(n.kind==='quiz'?n.options.reduce((mask,o,i)=>mask|(r.optionIds.includes(o.id)?1<<i:0),0):0);}
 u8(s.watched.length);for(const w of s.watched){u8(index(w.nodeId));u32(Math.floor(w.watchedMs));}u32(Math.floor(s.playback.positionMs));u8(s.playback.ranges.length);for(const [a,b]of s.playback.ranges){u32(Math.floor(a));u32(Math.floor(b));}
 const value='DG1.'+btoa(String.fromCharCode(...bytes));if(value.length>4096)throw new CourseRuleError('SUSPEND_LIMIT','完整学习断点超过SCORM 1.2容量，未截断或写入。');return value;
}
export function decodeCourseSuspend(d:CourseDefinition,value:string,releaseHash:string,durations:Record<string,number>):LearningState{
 const bad=():never=>{throw new CourseRuleError('SUSPEND_INVALID','LMS断点损坏或属于其他课程版本，不能自动覆盖。');};
 if(!value.startsWith('DG1.')||value.length>4096)return bad();let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(value.slice(4)),c=>c.charCodeAt(0));}catch{return bad();}let offset=0;
 const u8=()=>{if(offset>=bytes.length)return bad();return bytes[offset++];},u32=()=>u8()*16777216+u8()*65536+u8()*256+u8(),node=()=>{const n=d.nodes[u8()];if(!n)return bad();return n;};
 if(u8()!==1)return bad();let hash='';for(let i=0;i<32;i++)hash+=u8().toString(16).padStart(2,'0');if(hash!==releaseHash)return bad();const complete=u8();if(complete>1)return bad();const current=node(),s=newLearningState(d);s.currentNodeId=current.id;s.completed=!!complete;
 const paths=u8();if(paths<1||paths>100)return bad();s.path=Array.from({length:paths},()=>node().id);if(s.path[0]!==d.startNodeId||s.path.at(-1)!==current.id||new Set(s.path).size!==s.path.length)return bad();
 const count=u8();if(count>100)return bad();s.responses=[];
 for(let i=0;i<count;i++){const n=node(),correct=u8(),mask=u8();if(correct>1||(n.kind!=='quiz'&&n.kind!=='simulation')||!s.path.includes(n.id)||s.responses.some(r=>r.nodeId===n.id))return bad();const optionIds=n.kind==='quiz'?n.options.filter((_,i)=>mask&(1<<i)).map(o=>o.id):[];if(n.kind==='quiz'){if(mask>=(1<<n.options.length)||!optionIds.length||(!n.multiple&&optionIds.length!==1))return bad();const actual=[...optionIds].sort().join(',')===[...n.correctOptionIds].sort().join(',');if(actual!==!!correct)return bad();}else if(mask)return bad();const r:LearningResponse={nodeId:n.id,kind:n.kind,correct:!!correct,optionIds,earned:correct?n.points:0,possible:n.points};s.responses.push(r);}
 for(let i=0;i<s.path.length-1;i++){const n=d.nodes.find(n=>n.id===s.path[i])!,r=s.responses.find(r=>r.nodeId===n.id);if(!courseEdges(n).includes(s.path[i+1])||(n.kind==='quiz'||n.kind==='simulation')&&(!r||s.path[i+1]!==(r.correct?n.correctNext:n.incorrectNext)))return bad();}
 const watches=u8();if(watches>100)return bad();s.watched=[];for(let i=0;i<watches;i++){const n=node(),ms=u32();if(n.kind!=='lesson'||!n.media||n.id===current.id||!s.path.includes(n.id)||s.watched.some(w=>w.nodeId===n.id)||!durations[n.id]||ms>durations[n.id]||ms+1<durations[n.id]*n.minimumWatchPercent/100)return bad();s.watched.push({nodeId:n.id,watchedMs:ms});}
 for(const id of s.path.slice(0,-1)){const n=d.nodes.find(n=>n.id===id)!;if(n.kind==='lesson'&&n.media&&!s.watched.some(w=>w.nodeId===id))return bad();}
 s.playback.positionMs=u32();const ranges=u8();if(ranges>64)return bad();for(let i=0;i<ranges;i++){const a=u32(),b=u32();if(a>=b||b>(durations[current.id]||0)||i&&a<=s.playback.ranges[i-1][1])return bad();s.playback.ranges.push([a,b]);}
 if(offset!==bytes.length||s.playback.positionMs>(durations[current.id]||0)||(current.kind!=='lesson'||!current.media)&&(s.playback.positionMs||ranges)||s.completed&&current.kind!=='end')return bad();return s;
}
