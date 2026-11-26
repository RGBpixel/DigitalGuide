import type {CourseDefinition,LearningState} from '@digitalguide/contracts';
import {newLearningState,learningGrade,learningProgress} from './courses.js';
import {encodeCourseSuspend,decodeCourseSuspend} from './course-suspend.js';

export type ScormStandard='1.2'|'2004_4';
export type ScormApi=Record<string,(...args:string[])=>unknown>;
export interface ScormWindow {parent?:ScormWindow;opener?:ScormWindow|null;API?:ScormApi;API_1484_11?:ScormApi}
export class ScormError extends Error{constructor(public code:string,message:string){super(message);}}
const functions12=['LMSInitialize','LMSFinish','LMSGetValue','LMSSetValue','LMSCommit','LMSGetLastError','LMSGetErrorString','LMSGetDiagnostic'],functions2004=['Initialize','Terminate','GetValue','SetValue','Commit','GetLastError','GetErrorString','GetDiagnostic'];
export function findScormApi(start:ScormWindow,standard:ScormStandard):ScormApi|null{
 const queue=[start],seen=new Set<ScormWindow>(),names=standard==='1.2'?functions12:functions2004;let visits=0;
 while(queue.length&&visits++<32){const w=queue.shift()!;if(seen.has(w))continue;seen.add(w);try{const api=standard==='1.2'?w.API:w.API_1484_11;if(api&&names.every(n=>typeof api[n]==='function'))return api;}catch{/* Cross-origin hosts must explicitly expose a permitted API; no fallback to platform HTTP. */}
  try{if(w.parent&&w.parent!==w)queue.push(w.parent);}catch{/* Continue with a permitted opener if present. */}try{if(w.opener)queue.push(w.opener);}catch{/* No access to a foreign opener. */}
 }return null;
}
export function scormTime(ms:number,standard:ScormStandard){const centiseconds=Math.max(0,Math.floor(ms/10));if(standard==='2004_4')return'PT'+(centiseconds/100).toFixed(2)+'S';const seconds=Math.floor(centiseconds/100),hours=Math.floor(seconds/3600);return hours.toString().padStart(4,'0')+':'+Math.floor(seconds%3600/60).toString().padStart(2,'0')+':'+(seconds%60).toString().padStart(2,'0')+'.'+(centiseconds%100).toString().padStart(2,'0');}
export class ScormRuntime{
 initialized=false;terminated=false;readOnly=false;mode='normal';startedAt=0;warnings:string[]=[];interactionBase=0;interactionsSupported=true;private initialSuspend='';
 constructor(public api:ScormApi,public standard:ScormStandard,public clock=()=>Date.now()){}
 method(name:string){return this.standard==='1.2'?({Initialize:'LMSInitialize',Terminate:'LMSFinish',GetValue:'LMSGetValue',SetValue:'LMSSetValue',Commit:'LMSCommit',GetLastError:'LMSGetLastError',GetErrorString:'LMSGetErrorString',GetDiagnostic:'LMSGetDiagnostic'} as Record<string,string>)[name]:name;}
 call(name:string,...args:string[]):unknown{try{const fn=this.api[this.method(name)];if(typeof fn!=='function')throw new Error();return fn.apply(this.api,args);}catch{throw new ScormError('SCORM_CALL_FAILED','LMS运行接口调用失败（'+name+'），未确认保存，请返回LMS检查连接后重试。');}}
 last(){return String(this.call('GetLastError'));}
 check(name:string,value:unknown){const error=this.last();if(String(value)!=='true'||error!=='0')throw new ScormError('SCORM_'+error,'LMS未确认'+name+'（错误码'+error+'）。可能已有部分字段写入，请重试保存并核对LMS记录。');}
 get(key:string,optional=false):string|null{const value=String(this.call('GetValue',key)??''),code=this.last();if(code==='0')return value;if(optional&&code==='401')return null;throw new ScormError('SCORM_'+code,'LMS无法读取'+key+'（错误码'+code+'），未覆盖原断点。');}
 set(key:string,value:string,optional=false){const result=this.call('SetValue',key,value),code=this.last();if(String(result)==='true'&&code==='0')return true;if(optional&&code==='401')return false;throw new ScormError('SCORM_'+code,'LMS未接受'+key+'（错误码'+code+'），未确认保存，请重试并核对学习记录。');}
 initialize(){if(this.initialized||this.terminated)throw new ScormError('SCORM_STATE','本次LMS会话已经初始化或结束，请重新从LMS打开。');this.check('初始化',this.call('Initialize',''));this.initialized=true;this.startedAt=this.clock();const mode=this.get(this.standard==='1.2'?'cmi.core.lesson_mode':'cmi.mode');if(!mode||!['normal','review','browse'].includes(mode))throw new ScormError('SCORM_MODE','LMS未返回明确学习模式，已停止写入；请从正常学习入口重新打开。');this.mode=mode;this.readOnly=mode!=='normal';this.initialSuspend=this.get('cmi.suspend_data')!;return{mode:this.mode,readOnly:this.readOnly,suspendData:this.initialSuspend};}
 restore(d:CourseDefinition,releaseHash:string,durations:Record<string,number>){if(!this.initialized)throw new ScormError('SCORM_STATE','请先初始化LMS。');const value=this.initialSuspend;if(value){const match=/^DGS1\.(\d+)\.(DG1\.[A-Za-z0-9+/=]+)$/.exec(value);if(!match||Number(match[1])>10000)throw new ScormError('SCORM_SUSPEND_INVALID','LMS已有断点属于其他内容或格式，不能自动覆盖；请让课程管理员安排新的学习尝试。');this.interactionBase=Number(match[1]);return decodeCourseSuspend(d,match[2],releaseHash,durations);}
  if(!this.readOnly){const count=this.get('cmi.interactions._count',this.standard==='1.2');if(count===null){this.interactionsSupported=false;this.warnInteractions();}else if(!/^\d+$/.test(count)||Number(count)>10000)throw new ScormError('SCORM_INTERACTIONS','LMS逐题记录计数无效，未开始写入。');else this.interactionBase=Number(count);}return newLearningState(d);
 }
 private warnInteractions(){const warning='当前LMS未支持逐题记录，仍会尝试保存课程总成绩与断点；请在LMS中核对。';if(!this.warnings.includes(warning))this.warnings.push(warning);}
 checkpoint(d:CourseDefinition,s:LearningState,releaseHash:string){
  if(!this.initialized||this.terminated)throw new ScormError('SCORM_STATE','LMS会话尚未初始化或已结束，不能声称进度已保存。');if(this.readOnly)return{saved:false,readOnly:true,warnings:this.warnings};
  const suspend='DGS1.'+this.interactionBase+'.'+encodeCourseSuspend(d,s,releaseHash);if(suspend.length>4096)throw new ScormError('SCORM_SUSPEND_LIMIT','完整断点超过SCORM 1.2容量，未截断或覆盖。');
  if(this.interactionsSupported)for(let i=0;i<s.responses.length;i++){
   const r=s.responses[i],n=d.nodes.find(n=>n.id===r.nodeId)!;if(n.kind!=='quiz'&&n.kind!=='simulation')throw new ScormError('SCORM_RESPONSE','题目与发布版不符。');const prefix='cmi.interactions.'+(this.interactionBase+i)+'.',is12=this.standard==='1.2',selected=n.kind==='quiz'?n.options.map((o,i)=>r.optionIds.includes(o.id)?(is12?String.fromCharCode(97+i):'option_'+i):'').filter(Boolean).join(is12?',':'[,]'):n.task.kind+':'+(r.correct?'match':'miss'),fields:[string,string][]=[['id','dg_'+n.id],['type',n.kind==='quiz'?'choice':'other'],[is12?'student_response':'learner_response',selected],['weighting',String(n.points)],['result',r.correct?'correct':is12?'wrong':'incorrect']];
   let supported=true;for(const [key,value]of fields){if(!this.set(prefix+key,value,is12)){supported=false;break;}}if(!supported){this.interactionsSupported=false;this.warnInteractions();break;}
  }
  const g=learningGrade(d,s),is12=this.standard==='1.2',score=is12?'cmi.core.score.':'cmi.score.';
  for(const [key,value]of [['min','0'],['max','100']])if(!this.set(score+key,value,is12)){const warning='当前LMS未支持可选成绩边界字段，课程仍按0至100分保存总成绩。';if(!this.warnings.includes(warning))this.warnings.push(warning);}this.set(score+'raw',String(g.percent));
  if(is12)this.set('cmi.core.lesson_status',s.completed?(g.possible?(g.passed?'passed':'failed'):'completed'):'incomplete');else{this.set('cmi.score.scaled',String(g.percent/100));this.set('cmi.completion_status',s.completed?'completed':'incomplete');this.set('cmi.success_status',s.completed&&g.possible?(g.passed?'passed':'failed'):'unknown');this.set('cmi.progress_measure',String(learningProgress(d,s)/100));}
  this.set(is12?'cmi.core.lesson_location':'cmi.location',s.currentNodeId);this.set(is12?'cmi.core.session_time':'cmi.session_time',scormTime(this.clock()-this.startedAt,this.standard));this.set(is12?'cmi.core.exit':'cmi.exit',s.completed?'':'suspend');
  // The previous suspend data is left intact if another data-model field is rejected.
  this.set('cmi.suspend_data',suspend);this.check('保存',this.call('Commit',''));return{saved:true,readOnly:false,warnings:this.warnings};
 }
 finish(d:CourseDefinition,s:LearningState,releaseHash:string){this.checkpoint(d,s,releaseHash);this.check('结束会话',this.call('Terminate',''));this.terminated=true;return true;}
}
