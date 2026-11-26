import type {WritingConstraintFinding} from '@digitalguide/contracts';
import type {WritingReviewUnit} from './writing-review.js';

interface Clause {text:string;start:number;end:number}
interface DayScope {days:number[];category:'daily'|'weekdays'|'weekends'|'list'}
interface Calendar {opening:Clause;scope:DayScope;closed:{clause:Clause;days:number[]}[];effective:number[];hours:number[]|null;alternative:string;subject:string|null;partial:boolean}
const all=[1,2,3,4,5,6,7];
const same=(a:number[],b:number[])=>a.join(',')===b.join(',');
const sorted=(days:number[])=>[...new Set(days)].sort((a,b)=>a-b);
const opening=/(?:开放|营业|开馆|\bopens?\b|\bopening\b)/i;
const closed=/(?:闭馆|休馆|不开放|不营业|暂停开放|停止营业|\bclosed\b|\bnot open\b|\bdoes not open\b)/i;
const subject=(text:string)=>[...text.matchAll(/展厅|餐厅|咖啡厅|博物馆|办公室|\bgallery\b|\brestaurant\b|\bcaf[eé]\b|\bmuseum\b|\boffice\b/gi)].map(m=>m[0].toLowerCase());

function clauses(text:string):Clause[]{
  const result:Clause[]=[],separator=/[。；;.!?！？\n，,]|\s+and\s+(?=(?:is\s+)?closed\b)/gi;let start=0;
  const add=(end:number)=>{const raw=text.slice(start,end),value=raw.trim();if(value){const offset=raw.indexOf(value);result.push({text:value,start:start+offset,end:start+offset+value.length});}};
  for(const match of text.matchAll(separator)){add(match.index);start=match.index+match[0].length;}add(text.length);return result;
}

function days(text:string):DayScope|null{
  if(/工作日|\bweekdays?\b/i.test(text)&&/周末|\bweekends?\b/i.test(text)){
    const union=/工作日\s*(?:和|与|及|以及|、)\s*周末|周末\s*(?:和|与|及|以及|、)\s*工作日|\bweekdays?\s+(?:and|or|as well as)\s+(?:(?:at|on)\s+)?weekends?\b|\bweekends?\s+(?:and|or|as well as)\s+(?:on\s+)?weekdays?\b/i;
    return union.test(text)?{days:all,category:'daily'}:null;
  }
  if(/每天|每日|天天|\bdaily\b|\bevery day\b/i.test(text))return{days:all,category:'daily'};
  if(/工作日|\bweekdays?\b/i.test(text))return{days:[1,2,3,4,5],category:'weekdays'};
  if(/周末|\bweekends?\b/i.test(text))return{days:[6,7],category:'weekends'};
  const values:number[]=[],cn='一二三四五六日天',names=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  for(const match of text.matchAll(/(?:周|星期|礼拜)([一二三四五六日天])\s*(?:(?:至|到|—|–|-)\s*(?:周|星期|礼拜)?([一二三四五六日天]))?/g)){
    const first=Math.min(7,cn.indexOf(match[1])+1),last=match[2]?Math.min(7,cn.indexOf(match[2])+1):first;
    if(last<first)return null;for(let day=first;day<=last;day++)values.push(day);
  }
  const en=new RegExp('\\b('+names.join('|')+')(?:\\s+(?:through|to)\\s+('+names.join('|')+'))?\\b','gi');
  for(const match of text.matchAll(en)){const first=names.indexOf(match[1].toLowerCase())+1,last=match[2]?names.indexOf(match[2].toLowerCase())+1:first;if(last<first)return null;for(let day=first;day<=last;day++)values.push(day);}
  return values.length?{days:sorted(values),category:'list'}:null;
}

function hours(text:string):number[]|null{
  const matches=[...text.matchAll(/(\d{1,2})[:：](\d{2})\s*(?:—|–|-|~|～|至|到|\bto\b|\bthrough\b)\s*(\d{1,2})[:：](\d{2})/gi)];
  if(matches.length!==1)return null;const match=matches[0],parts=match.slice(1).map(Number);
  if(parts[0]>23||parts[2]>23||parts[1]>59||parts[3]>59)return null;return[parts[0]*60+parts[1],parts[2]*60+parts[3]];
}
const timeOnly=(text:string)=>!days(text)&&Boolean(hours(text))&&/^(?:开放|营业)?(?:时间|时段)(?:是|为|[:：])|^(?:the\s+)?(?:(?:opening|business)\s+)?(?:hours?|time)\s*(?:is|are|:)/i.test(text);

// This parses a single explicit recurring opening calendar, not arbitrary temporal entailment.
// Holiday rules, date-specific schedules, multiple venues/windows and unclear subjects stay manual.
function calendar(text:string):Calendar|null{
  if(/节假|法定|调休|临时|除外|除.{0,20}以外|\bholidays?\b|\bexcept\b|\btemporar/i.test(text))return null;
  const parts=clauses(text),openings=parts.filter((c,i)=>opening.test(c.text)&&!closed.test(c.text)&&!timeOnly(c.text)&&Boolean(days(c.text)||hours(c.text)||i>0&&days(parts[i-1].text)&&!opening.test(parts[i-1].text)&&!closed.test(parts[i-1].text))),closures=parts.filter(c=>closed.test(c.text));
  if(openings.length!==1)return null;const index=parts.indexOf(openings[0]),following=parts[index+1],current=following&&timeOnly(following.text)?{text:text.slice(openings[0].start,following.end),start:openings[0].start,end:following.end}:openings[0],preceding=parts[index-1];
  let scope=days(current.text),span=current;
  if(!scope&&preceding&&days(preceding.text)&&!opening.test(preceding.text)&&!closed.test(preceding.text)){
    scope=days(preceding.text);span={text:text.slice(preceding.start,current.end),start:preceding.start,end:current.end};
  }
  if(!scope)return null;
  const subjects=new Set([span,...closures].flatMap(c=>subject(c.text)));if(subjects.size>1)return null;
  const exceptions=closures.map(clause=>({clause,days:days(clause.text)?.days}));if(exceptions.some(c=>!c.days))return null;
  const excluded=exceptions.flatMap(c=>c.days!),relevant=[span,...closures],start=Math.min(...relevant.map(c=>c.start)),end=Math.max(...relevant.map(c=>c.end));
  return{opening:span,scope,closed:exceptions as Calendar['closed'],effective:scope.days.filter(day=>!excluded.includes(day)),hours:hours(span.text),alternative:text.slice(start,end),subject:[...subjects][0]||null,partial:/例如|比如|譬如|举例|\bfor example\b|\bsuch as\b|\bincluding\b/i.test(text)};
}

export function writingCalendarFindings(units:WritingReviewUnit[]):WritingConstraintFinding[]{
  const findings:WritingConstraintFinding[]=[];
  for(const unit of units){
    if(unit.kind!=='section'||!('text' in unit.content))continue;
    const current=calendar(unit.content.text);if(!current)continue;
    const sources=unit.supports.map(s=>({support:s,calendar:calendar(s.quote)})).filter((s):s is {support:typeof s.support;calendar:Calendar}=>Boolean(s.calendar));
    if(!sources.length)continue;
    const signatures=new Set(sources.map(s=>JSON.stringify([s.calendar.effective,s.calendar.hours,s.calendar.subject])));if(signatures.size!==1)continue;
    const {support,calendar:source}=sources[0];if(source.subject&&current.subject&&source.subject!==current.subject)continue;
    const add=(rule:WritingConstraintFinding['rule'],fragment:string,alternative:string,reason:string,numberChanged=false)=>findings.push({checkId:unit.checkId,rule,issue:numberChanged?'number_changed':'scope_changed',sourceId:support.sourceId,quote:support.quote,reason,unsupportedFragment:fragment,...alternative?{sourceAlternative:alternative}:{}});
    const wrongClosures=current.closed.filter(c=>c.days.some(day=>source.effective.includes(day)));
    for(const exception of wrongClosures){const replacement=source.closed.length?support.quote.slice(Math.min(...source.closed.map(c=>c.clause.start)),Math.max(...source.closed.map(c=>c.clause.end))):'';add('availability-exception',exception.clause.text,replacement,'正文的闭馆日期与本段引用明确的开放安排不符，需恢复原例外。');}
    const correctedClosed=wrongClosures.length?source.closed.flatMap(c=>c.days):current.closed.flatMap(c=>c.days);
    const effective=current.scope.days.filter(day=>!correctedClosed.includes(day)),extra=effective.some(day=>!source.effective.includes(day)),missing=source.effective.some(day=>!effective.includes(day));
    const namedNarrowing=['daily','weekdays','weekends'].includes(current.scope.category),exclusive=/仅|只在|只限|\bonly\b/i.test(current.opening.text);
    const scopeChanged=extra||missing&&!current.partial&&(namedNarrowing||exclusive);
    const hoursChanged=Boolean(current.hours&&source.hours&&!same(current.hours,source.hours));
    if(scopeChanged||hoursChanged){
      const needsException=!current.closed.length&&source.closed.length>0,alternative=needsException?source.alternative:source.opening.text;
      add(hoursChanged?'availability-hours':'availability-calendar',current.opening.text,alternative,hoursChanged?'正文的营业时间区间与本段引用不同，起止顺序也必须保持。':'正文概括的开放日期扩大或缩小了本段引用的安排，不能把每天与工作日互换。',hoursChanged);
    }
  }
  return findings;
}
