import {practiceDefinition,practiceFeedback,type PracticeDefinition,type PracticeQuestion,type PracticeFeedback} from '@digitalguide/contracts';
import {AppError} from './index.js';
const normalized=(s:string)=>s.normalize('NFKC').toLowerCase();
export function validatePractice(value:unknown):PracticeDefinition{
 const d=practiceDefinition.parse(value),byId=new Map(d.questions.map(q=>[q.id,q]));
 if(byId.size!==d.questions.length||!byId.has(d.startQuestionId))throw new AppError('PRACTICE_GRAPH','问题编号必须唯一，起始问题必须存在。',409);
 for(const q of d.questions){
  if(new Set(q.criteria.map(c=>c.id)).size!==q.criteria.length)throw new AppError('PRACTICE_CRITERIA','同一问题的标准编号不能重复。',409);
  if(d.mode==='research'&&(q.criteria.length||q.nextOnMet!==q.nextOnMiss))throw new AppError('PRACTICE_RESEARCH_RULE','调研访谈不设对错、分数或命中分支，请清空标准并使用相同的后续问题。',409);
  if(d.mode==='practice'&&!q.criteria.length)throw new AppError('PRACTICE_CRITERIA','练习问题至少需要一条明确标准；无评分访谈请选择调研模式。',409);
  for(const c of q.criteria)if(c.cues.some(v=>!/[\p{L}\p{N}]/u.test(v))||new Set(c.cues.map(normalized)).size!==c.cues.length)throw new AppError('PRACTICE_CUES','匹配字样须包含文字或数字，规范化后不能重复。',409);
  for(const next of[q.nextOnMet,q.nextOnMiss])if(next!==null&&!byId.has(next))throw new AppError('PRACTICE_GRAPH','后续问题不存在，请修复流程。',409);
 }
 const visiting=new Set<string>(),visited=new Set<string>();function visit(id:string){if(visiting.has(id))throw new AppError('PRACTICE_GRAPH','问题流程不能循环，请使用有限的跟进问题。',409);if(visited.has(id))return;visiting.add(id);const q=byId.get(id)!;for(const next of new Set([q.nextOnMet,q.nextOnMiss]))if(next)visit(next);visiting.delete(id);visited.add(id);}visit(d.startQuestionId);
 if(visited.size!==d.questions.length)throw new AppError('PRACTICE_GRAPH','存在无法到达的问题，请连接或移除该问题。',409);return d;
}
function literalIndex(body:string){
 const segmenter=new Intl.Segmenter('und',{granularity:'grapheme'}),spans:{start:number;end:number}[]=[];let text='';
 for(const item of segmenter.segment(body)){const part=normalized(item.segment);text+=part;for(let i=0;i<part.length;i++)spans.push({start:item.index,end:item.index+item.segment.length});}
 return(cue:string)=>{const needle=normalized(cue),at=text.indexOf(needle);if(at<0)return null;const start=spans[at].start,end=spans[at+needle.length-1].end,quote=body.slice(start,end);return{quote,quoteStart:start,quoteEnd:end};};
}
export function assessPractice(d:PracticeDefinition,q:PracticeQuestion,body:string):{feedback:PracticeFeedback;nextQuestionId:string|null}{
 if(d.mode==='research')return{feedback:practiceFeedback.parse({schemaVersion:1,engine:'verbatim-interview-v1',simulated:true,summary:'已记录本题回答，以下为原话摘录；未判断情绪、人格或能力。',earned:0,possible:0,checks:[],verbatimQuote:Array.from(body).slice(0,200).join('')}),nextQuestionId:q.nextOnMet};
 let earned=0,possible=0;const find=literalIndex(body),checks=q.criteria.map(c=>{const hit=c.cues.map(find).find(Boolean)||null;possible+=c.weight;if(hit)earned+=c.weight;return{criterionId:c.id,label:c.label,matched:!!hit,cues:c.cues,basis:c.basis,feedback:hit?c.metFeedback:c.missingFeedback,quote:hit?.quote??null,quoteStart:hit?.quoteStart??null,quoteEnd:hit?.quoteEnd??null};});
 return{feedback:practiceFeedback.parse({schemaVersion:1,engine:'literal-rubric-v1',simulated:true,summary:`模拟字样匹配：${checks.filter(c=>c.matched).length}/${checks.length}条标准命中，不代表含义、真实性或能力评价。`,earned,possible,checks,verbatimQuote:null}),nextQuestionId:checks.every(c=>c.matched)?q.nextOnMet:q.nextOnMiss};
}
