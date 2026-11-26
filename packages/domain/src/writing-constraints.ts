import type {WritingConstraintFinding,WritingReviewCheck,WritingGuardPolicy} from '@digitalguide/contracts';
import type {WritingReviewUnit} from './writing-review.js';
import {writingCalendarFindings} from './writing-calendar.js';

// Deliberately narrow, visible safeguards. They do not implement general entailment.
export function writingConstraintFindings(units:WritingReviewUnit[],policy:WritingGuardPolicy='explicit-constraints-v1'):WritingConstraintFinding[]{
 const findings:WritingConstraintFinding[]=[];
 for(const unit of units){const content='text' in unit.content?unit.content.text:unit.content.title+' '+unit.content.angle;
  const clauses=(text:string)=>text.split(/[。；;！？!?\n，,]/).map(t=>t.trim()).filter(Boolean);
  const add=(rule:WritingConstraintFinding['rule'],issue:WritingConstraintFinding['issue'],sourceId:string,quote:string,reason:string,expressions:Pick<WritingConstraintFinding,'requiredExpression'|'requiredAction'|'forbiddenExpression'|'unsupportedFragment'|'sourceAlternative'>={})=>{if(!findings.some(f=>f.checkId===unit.checkId&&f.rule===rule))findings.push({checkId:unit.checkId,rule,issue,sourceId,quote,reason,...expressions});};
  const universal=/(?:任何|所有|全部|一切|一律)(?:的)?(?:交易|业务|服务|人员|人|来宾|顾客)|\b(?:all|any|every) (?:services?|transactions?|visitors?|customers?|people)\b/i;
  const whole=/任何|所有|全部|一切|一律|\b(?:all|any|every)\b/i;
  if(universal.test(content)&&!unit.supports.some(s=>whole.test(s.quote))){const limited=unit.supports.find(s=>/仅|只|不[^。；;]{0,50}(?:、|或|和)|\bonly\b|\bnot\b[^.;]{0,60}\b(?:and|or)\b/i.test(s.quote));if(limited)add('universal-scope','scope_changed',limited.sourceId,limited.quote,'正文使用全部或任何等范围，引用仅限定部分对象或列举禁办事项。',{forbiddenExpression:universal.exec(content)![0],unsupportedFragment:clauses(content).find(c=>universal.test(c)),sourceAlternative:clauses(limited.quote).find(c=>/仅|只|不[^。；;]{0,50}(?:、|或|和)|\bonly\b|\bnot\b/i.test(c))});}
  if(unit.kind!=='section')continue;
  const pattern=() => /(确认|审核通过|审批通过|核验通过|验证通过|批准|授权|到账|完成培训)(?:之|以)?后(?:才)?(?:可|能|会|方可)(?:以)?(参加|参与|听取|聆听|领取|取回|使用|启用|进入|入场|办理|下单|退款|获取|开通)/g;
  const actionClass=(action:string)=>['参加','参与','听取','聆听'].includes(action)?'参加':['领取','取回'].includes(action)?'领取':['进入','入场'].includes(action)?'进入':action;
  const sourceConditions=unit.supports.flatMap(support=>Array.from(support.quote.matchAll(pattern()),match=>({support,predicate:match[1],action:match[2]})));
  for(const {support,predicate,action}of sourceConditions){const sentences=content.split(/[。；;！？!?\n]/),aliases=actionClass(action)==='参加'?['参加','参与','听取','聆听']:actionClass(action)==='领取'?['领取','取回']:actionClass(action)==='进入'?['进入','入场']:[action];if(sentences.some(s=>aliases.some(a=>s.includes(a))&&/(?:可|能|会|就|即|后)/.test(s)&&!s.includes(predicate)))add('explicit-prerequisite','condition_missing',support.sourceId,support.quote,'正文提及可'+action+'，但遗漏引用中“'+predicate+'后”的明确前提。',{requiredExpression:predicate,requiredAction:action,unsupportedFragment:clauses(content).find(c=>aliases.some(a=>c.includes(a))&&!c.includes(predicate)),sourceAlternative:clauses(support.quote).find(c=>c.includes(predicate)&&c.includes(action))});}
  for(const match of content.matchAll(pattern())){const predicate=match[1],action=match[2],conditions=sourceConditions.filter(c=>c.predicate===predicate);if(conditions.length&&!conditions.some(c=>actionClass(c.action)===actionClass(action))){const source=conditions[0];add('conditional-action','scope_changed',source.support.sourceId,source.support.quote,'来源的“'+predicate+'后”对应'+source.action+'，不能扩展为'+action+'的资格或限制。',{requiredExpression:predicate,requiredAction:source.action,forbiddenExpression:match[0],unsupportedFragment:clauses(content).find(c=>c.includes(match[0])),sourceAlternative:clauses(source.support.quote).find(c=>c.includes(predicate)&&c.includes(source.action))});}}
 }
 return policy==='explicit-constraints-v2'?[...findings,...writingCalendarFindings(units)]:findings;
}
export function effectiveWritingChecks(checks:WritingReviewCheck[],findings:WritingConstraintFinding[]):WritingReviewCheck[]{return checks.map(check=>{const rules=findings.filter(f=>f.checkId===check.checkId);return rules.length?{...check,verdict:'unsupported' as const,issues:[...new Set([...check.issues,...rules.map(r=>r.issue)])],evidenceNote:Array.from('规则检查：'+rules.map(r=>r.reason).join('；')).slice(0,80).join('')}:check;});}
