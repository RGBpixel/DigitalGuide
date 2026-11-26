import {randomUUID} from 'node:crypto';
import {expect} from 'vitest';
import type {GovernancePolicy,GovernancePlan,GovernanceDelivery,GovernanceReview} from '@digitalguide/contracts';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {shareApi,shareSource,type ShareHarness} from './share-helpers.js';
import {runGovernanceDelivery} from '../../apps/worker/src/content-governance.js';
export function governanceDefinition(){return{schemaVersion:1,labelPosition:'top_right',labelPrefix:'本地示例',labelVideo:true,labelCover:true,blockedPhrases:['禁止传播示例'],reviewPhrases:['忽略规则','内部数据'],referenceNote:'本组织的本地示例规则；未核对真实渠道或法律要求。'} as const;}
export async function extraGovernanceReviewer(h:ShareHarness){const id=randomUUID();h.repo.run('INSERT INTO users VALUES (?,?)',id,'最终文件审核员 · 虚构');h.repo.run('INSERT INTO memberships(user_id,tenant_id,role,workspace_ids) VALUES (?,?,?,?)',id,f.tenantA,'reviewer',JSON.stringify([f.workspaceA]));return{id,headers:await h.login(id)};}
export async function governed(h:ShareHarness,render=true,approve=true,overrides:object={}){
 const source=await shareSource(h),{good,get}=shareApi(h),reviewer=await extraGovernanceReviewer(h),policy=await good<GovernancePolicy>('/content-governance/policies',{workspaceId:f.workspaceA,platform:'custom',name:'自定义渠道标识规则',definition:governanceDefinition(),confirmed:true}),input={variantId:source.variant.id,variantVersion:1,policyId:policy.id,policyVersion:1,generation:'ai_assisted',sourceStatement:'原创合成底片与合成测试音；分类由制作方声明，未执行AI检测。',...overrides},plan=await good<GovernancePlan>('/content-governance/plan',input);
 expect(plan.canCreate,plan.problems.join('；')).toBe(true);let delivery=await good<GovernanceDelivery>('/content-governance/deliveries',{...input,planHash:plan.hash,confirmed:true,rightsConfirmed:true});let review:GovernanceReview|undefined;
 if(render){await runGovernanceDelivery(h.repo,h.config);delivery=(await get('/content-governance/deliveries/'+delivery.id)).json().data as GovernanceDelivery;expect(delivery.status,delivery.errorMessage||'').toBe('ready');if(approve){review=await good<GovernanceReview>('/content-governance/deliveries/'+delivery.id+'/reviews',{version:delivery.version,reviewerId:reviewer.id,confirmed:true});await good('/content-governance/reviews/'+review.id+'/decision',{version:review.version,decision:'approve',note:'核对了实际标识视频、封面与来源声明。',acknowledgedIssueIds:delivery.issues.filter(i=>i.severity==='review').map(i=>i.id),confirmed:true},reviewer.headers);delivery=(await get('/content-governance/deliveries/'+delivery.id)).json().data as GovernanceDelivery;expect(delivery.effectiveStatus).toBe('approved');}}
 return{...source,governanceReviewer:reviewer,policy,input,plan,delivery,governanceReview:review};
}
