import type {CourseDefinition,CourseNode,LearningAction,LearningState,LearningResponse,LearningGrade} from '@digitalguide/contracts';

export class CourseRuleError extends Error {constructor(public code:string,message:string){super(message);}}
function fail(code:string,message:string):never{throw new CourseRuleError(code,message);}
export function courseEdges(n:CourseNode):string[]{return n.kind==='lesson'?[n.next]:n.kind==='choice'?n.options.map(o=>o.next):n.kind==='quiz'||n.kind==='simulation'?[n.correctNext,n.incorrectNext]:[];}
export function validateCourse(d:CourseDefinition){
 const byId=new Map(d.nodes.map(n=>[n.id,n]));if(byId.size!==d.nodes.length||!byId.has(d.startNodeId))fail('COURSE_GRAPH_INVALID','节点编号重复或起点不存在。');
 for(const n of d.nodes){
  if(courseEdges(n).some(t=>!byId.has(t)))fail('COURSE_GRAPH_INVALID','“'+n.title+'”的下一步不存在。');
  if(n.kind==='choice'||n.kind==='quiz'){if(new Set(n.options.map(o=>o.id)).size!==n.options.length)fail('COURSE_GRAPH_INVALID','“'+n.title+'”的选项编号重复。');}
  if(n.kind==='quiz'&&(new Set(n.correctOptionIds).size!==n.correctOptionIds.length||n.correctOptionIds.some(id=>!n.options.some(o=>o.id===id))||(!n.multiple&&n.correctOptionIds.length!==1)))fail('COURSE_ANSWER_INVALID','请核对“'+n.title+'”的标准答案。');
  if(n.kind==='simulation'&&n.task.kind==='hotspot'&&(n.task.x+n.task.width>1||n.task.y+n.task.height>1))fail('COURSE_HOTSPOT_INVALID','操作区域必须完整位于截图内。');
 }
 const visited=new Set<string>(),active=new Set<string>(),minGrade=new Map<string,number>();
 function walk(id:string):number{if(active.has(id))return fail('COURSE_GRAPH_CYCLE','课程分支不能循环，请通过新学习尝试进行重学。');if(visited.has(id))return minGrade.get(id)!;active.add(id);const n=byId.get(id)!,edges=courseEdges(n),count=(n.kind==='quiz'||n.kind==='simulation'?1:0)+(edges.length?Math.min(...edges.map(walk)):0);active.delete(id);visited.add(id);minGrade.set(id,count);return count;}
 const minimum=walk(d.startNodeId);if(visited.size!==d.nodes.length)fail('COURSE_GRAPH_UNREACHABLE','存在无法从起点到达的节点，请接入分支或移除。');if(d.nodes.some(n=>n.kind==='quiz'||n.kind==='simulation')&&!minimum)fail('COURSE_UNGRADED_PATH','含测验的课程每条完成路径都需至少一个计分节点，避免跳过测验直接通过。');
 return d;
}
export function newLearningState(d:CourseDefinition):LearningState{validateCourse(d);return{schemaVersion:1,currentNodeId:d.startNodeId,path:[d.startNodeId],responses:[],watched:[],completed:false,playback:{epoch:0,playing:false,lastAtMs:0,positionMs:0,ranges:[]}};}
export function learningGrade(d:CourseDefinition,s:LearningState):LearningGrade{const earned=s.responses.reduce((t,r)=>t+r.earned,0),possible=s.responses.reduce((t,r)=>t+r.possible,0),percent=possible?Math.round(earned/possible*10000)/100:s.completed?100:0;return{earned,possible,percent,passed:s.completed?percent>=d.passingPercent:null};}
export function learningProgress(d:CourseDefinition,s:LearningState){if(s.completed)return 100;const memo=new Map<string,number>(),depth=(id:string):number=>{if(memo.has(id))return memo.get(id)!;const edges=courseEdges(d.nodes.find(n=>n.id===id)!),n=1+(edges.length?Math.max(...edges.map(depth)):0);memo.set(id,n);return n;};return Math.min(99,Math.floor((s.path.length-1)/(s.path.length-1+depth(s.currentNodeId))*100));}
export function watchedMs(s:LearningState){return s.playback.ranges.reduce((t,[a,b])=>t+b-a,0);}
function mergeRanges(ranges:[number,number][],range:[number,number]){const sorted=[...ranges,range].sort((a,b)=>a[0]-b[0]),out:[number,number][]=[];for(const r of sorted){const last=out.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else out.push([...r]);}if(out.length>64)fail('LEARNING_WATCH_RANGES','跳转片段过多，请连续播放连接已有片段后再继续。');return out;}
export function applyLearningAction(d:CourseDefinition,old:LearningState,action:LearningAction,durations:Record<string,number>,at=Date.now()):LearningState{
 const s=structuredClone(old),n=d.nodes.find(n=>n.id===s.currentNodeId)!;if(!n)fail('LEARNING_STATE_INVALID','学习断点与发布版本不符，请联系管理员。');if(s.completed)fail('LEARNING_COMPLETED','本次学习已经提交；需要重学时请建立新的尝试。');
 const enter=(id:string)=>{s.currentNodeId=id;s.path.push(id);s.playback={epoch:s.playback.epoch+1,playing:false,lastAtMs:0,positionMs:0,ranges:[]};};
 if(action.kind==='claim'){s.playback.epoch++;s.playback.playing=false;s.playback.lastAtMs=at;return s;}
 if(action.kind==='play'||action.kind==='progress'||action.kind==='pause'||action.kind==='seek'){
  if(n.kind!=='lesson'||!n.media)fail('LEARNING_MEDIA_REQUIRED','当前步骤没有视频。');if(action.epoch!==s.playback.epoch)fail('LEARNING_PLAYER_CHANGED','播放器已在其他窗口重新接管，请刷新当前断点。');const duration=durations[n.id];if(!duration||action.positionMs>duration)fail('LEARNING_POSITION_INVALID','播放位置超过已校验视频时长。');
  const p=s.playback,elapsed=Math.max(0,at-p.lastAtMs),delta=action.positionMs-p.positionMs;
  if(action.kind!=='seek'&&p.playing&&elapsed<=10000&&delta>0&&delta<=elapsed*2+25){const credit=Math.min(delta,elapsed*2);if(credit>0)p.ranges=mergeRanges(p.ranges,[action.positionMs-credit,action.positionMs]);}
  p.positionMs=action.positionMs;p.lastAtMs=at;p.playing=action.kind==='play'||(action.kind==='progress'&&p.playing);return s;
 }
 const response=s.responses.find(r=>r.nodeId===n.id);
 if(action.kind==='continue'){
  if(n.kind==='lesson'){const duration=durations[n.id]||0;if(n.media&&watchedMs(s)+1<duration*n.minimumWatchPercent/100)fail('LEARNING_WATCH_REQUIRED','请先观看本页要求的比例；跳转不会计入已观看。');if(n.media)s.watched.push({nodeId:n.id,watchedMs:Math.floor(watchedMs(s))});enter(n.next);}
  else if(n.kind==='quiz'||n.kind==='simulation'){if(!response)fail('LEARNING_ANSWER_REQUIRED','请先提交本题或完成操作练习。');enter(response.correct?n.correctNext:n.incorrectNext);}
  else fail('LEARNING_ACTION_INVALID','当前步骤不能直接继续。');return s;
 }
 if(action.kind==='choose'){if(n.kind!=='choice')fail('LEARNING_ACTION_INVALID','当前步骤不是分支选择。');const option=n.options.find(o=>o.id===action.optionId);if(!option)fail('LEARNING_OPTION_INVALID','所选分支不存在。');enter(option.next);return s;}
 if(action.kind==='finish'){if(n.kind!=='end')fail('LEARNING_ACTION_INVALID','请完成课程路径后再提交结果。');s.completed=true;s.playback.playing=false;return s;}
 if(response)fail('LEARNING_ALREADY_ANSWERED','本题已提交，历史答案和成绩不会被覆盖；请继续或完成后重学。');let result:LearningResponse;
 if(action.kind==='answer'){
  if(n.kind!=='quiz')fail('LEARNING_ACTION_INVALID','当前步骤不是测验。');const options=[...new Set(action.optionIds)].sort();if(options.length!==action.optionIds.length||(!n.multiple&&options.length!==1)||options.some(id=>!n.options.some(o=>o.id===id)))fail('LEARNING_OPTION_INVALID','请核对本题选项。');const correct=options.join(',')===[...n.correctOptionIds].sort().join(',');result={nodeId:n.id,kind:'quiz',optionIds:options,correct,earned:correct?n.points:0,possible:n.points};
 }else if(action.kind==='simulate'){
  if(n.kind!=='simulation')fail('LEARNING_ACTION_INVALID','当前步骤不是软件操作练习。');if(n.task.kind==='hotspot'&&(!action.point||action.text!==undefined)||n.task.kind==='text'&&(action.text===undefined||action.point))fail('LEARNING_INPUT_INVALID','请按当前练习提交一个点击或文字输入。');const t=n.task,correct=t.kind==='hotspot'?!!action.point&&action.point.x>=t.x&&action.point.x<=t.x+t.width&&action.point.y>=t.y&&action.point.y<=t.y+t.height:t.caseSensitive?action.text!.trim()===t.expected.trim():action.text!.trim().toLowerCase()===t.expected.trim().toLowerCase();result={nodeId:n.id,kind:'simulation',optionIds:[],correct,earned:correct?n.points:0,possible:n.points};
 }else return fail('LEARNING_ACTION_INVALID','当前操作不适用于此步骤。');
 s.responses.push(result);return s;
}
export function learningFeedback(n:CourseNode,s:LearningState){const r=s.responses.find(r=>r.nodeId===n.id);return r&&(n.kind==='quiz'||n.kind==='simulation')?{response:r,text:r.correct?n.correctFeedback:n.incorrectFeedback}:null;}
