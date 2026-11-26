import {createHash} from 'node:crypto';
import type {GovernancePolicyDefinition,GovernanceIssue} from '@digitalguide/contracts';
import {AppError} from './index.js';
export const governanceLabel=(generation:'ai_generated'|'ai_assisted'|'not_ai'|'unknown',prefix:string)=>[prefix,{ai_generated:'AI生成',ai_assisted:'AI辅助制作',not_ai:'制作方声明：非AI',unknown:'来源未核验'}[generation]].filter(Boolean).join(' · ');
export function validateGovernancePolicy(d:GovernancePolicyDefinition){
 const phrases=[...d.blockedPhrases,...d.reviewPhrases].map(p=>p.normalize('NFKC').toLowerCase());
 if(phrases.some(p=>!p.trim())||new Set(phrases).size!==phrases.length)throw new AppError('GOVERNANCE_DUPLICATE_RULE','规则词需唯一，不能只包含空格；不接受正则或执行指令。',422);
 return d;
}
export function scanGovernance(d:GovernancePolicyDefinition,fields:{location:string;text:string}[]):GovernanceIssue[]{
 const result:GovernanceIssue[]=[];
 for(const field of fields){const normalized=field.text.normalize('NFKC').toLowerCase();for(const severity of ['blocked','review'] as const)for(const phrase of severity==='blocked'?d.blockedPhrases:d.reviewPhrases){const p=phrase.normalize('NFKC').toLowerCase(),at=normalized.indexOf(p);if(at<0)continue;const id=createHash('sha256').update(severity+'|'+field.location+'|'+p).digest('hex').slice(0,16);result.push({id,severity,location:field.location,phrase,excerpt:normalized.slice(Math.max(0,at-25),at+p.length+25)});}}
 if(result.length>200)throw new AppError('GOVERNANCE_ISSUE_LIMIT','规则命中超过二百项，请拆分内容并人工核对。',422);return result;
}
