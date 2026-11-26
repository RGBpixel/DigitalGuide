import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import type {DistributionVariant,GovernancePolicy,GovernancePlan,GovernanceDelivery,GovernanceReview} from '@digitalguide/contracts';
import {fixtureIds as f} from '../packages/test-fixtures/src/seed.js';
import type {ShareFixtureApi} from './share-fixture.js';

// Respect the current channel rule when a share sample is created after governance
// samples in the same workspace. Do not disable, replace or weaken that rule.
export async function approveShareFixtureGovernance(api:ShareFixtureApi,variant:DistributionVariant){
 const policies=await api.get<GovernancePolicy[]>('/content-governance/policies?workspaceId='+f.workspaceA),policy=policies.find(p=>p.platform===variant.platform&&p.enabled);if(!policy)return null;
 const input={variantId:variant.id,variantVersion:variant.version,policyId:policy.id,policyVersion:policy.version,generation:'ai_assisted',sourceStatement:'原创合成图形及测试音，仅用于本地端到端验证；没有真人克隆或真实发布。'},plan=await api.post<GovernancePlan>('share-governance-plan','/content-governance/plan',input);assert.equal(plan.canCreate,true,plan.problems.join('；'));
 let delivery=await api.post<GovernanceDelivery>('share-governance-render','/content-governance/deliveries',{...input,planHash:plan.hash,confirmed:true,rightsConfirmed:true});const end=Date.now()+120000;
 while(delivery.status!=='ready'&&Date.now()<end){assert.ok(!['failed','cancelled','withdrawn'].includes(delivery.status),delivery.errorMessage||delivery.status);await delay(200);delivery=await api.get<GovernanceDelivery>('/content-governance/deliveries/'+delivery.id);}assert.equal(delivery.status,'ready');
 const review=await api.post<GovernanceReview>('share-governance-review','/content-governance/deliveries/'+delivery.id+'/reviews',{version:delivery.version,reviewerId:f.reviewerA,confirmed:true});await api.reviewerPost('share-governance-decision','/content-governance/reviews/'+review.id+'/decision',{version:review.version,decision:'approve',note:'已核对本地原创合成样例的实际标识、固定来源及当前渠道提示。无外部发布。',acknowledgedIssueIds:delivery.issues.filter(i=>i.severity==='review').map(i=>i.id),confirmed:true});delivery=await api.get<GovernanceDelivery>('/content-governance/deliveries/'+delivery.id);assert.equal(delivery.effectiveStatus,'approved');return delivery;
}
