import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import type {ContentDraft} from '@digitalguide/contracts';
import * as native from '../../packages/providers/src/run-content-writing.js';
import {writingCalendarContractResult} from '../../packages/test-fixtures/src/writing-review.js';
import {runContentWritingJob} from '../../apps/worker/src/content-writing.js';
import {harness} from './helpers.js';
import {writingFixture,expectNoNativeClaim} from './content-writing-helpers.js';

let h:Awaited<ReturnType<typeof harness>>;
beforeEach(async()=>{h=await harness();});afterEach(async()=>{vi.restoreAllMocks();await h.close();});
const contract=()=>vi.spyOn(native,'runContentWriting').mockImplementation(async input=>writingCalendarContractResult(input.request,input.engine));

it('v3独立日期发现和片段修订持久化，明确采用后保留来源与固定引擎身份',async()=>{
  const p=await writingFixture(h,'source-script-reviewed-v3');contract();const job=await p.create();await runContentWritingJob(h.repo,h.config);
  const ready=await p.job(job.id);expect(ready.status,ready.errorMessage||'').toBe('succeeded');
  expect(ready.evidence!.engine.policy).toBe('source-script-reviewed-v3');
  expect(ready.evidence!.review!.passes[0].guardFindings[0].rule).toBe('availability-calendar');
  expect(ready.evidence!.review!.passes[0].checks[0].verdict).toBe('supported');
  expect(h.repo.all('SELECT * FROM studio_content_writing_adoptions')).toEqual([]);
  const draft=await p.api.good<ContentDraft>('/studio/content/writing/jobs/'+job.id+'/adopt',{version:ready.version,variantIndex:0,name:'核对后的日期安排',confirmed:true});
  expect(draft.payload!.sections[0].text).toContain('每天09:00');
  expect(draft.payload!.sourceRefs[0].id).toBe(p.source.id);
  expect((await p.job(job.id)).evidence).toEqual(ready.evidence);expectNoNativeClaim(h);
},30000);

it('伪造日期发现或省略修订被拒绝，确认模型分歧不能绕过硬性日期规则',async()=>{
  const p=await writingFixture(h,'source-script-reviewed-v3'),spy=contract(),job=await p.create();
  spy.mockImplementationOnce(async input=>{const value=writingCalendarContractResult(input.request,input.engine),review=value.evidence.review!;value.result=structuredClone(review.initialResult);review.passes=[review.passes[0]];review.passes[0].guardFindings=[];delete review.repair;delete review.patch;review.outcome='model-supported';Object.assign(value.evidence,{promptSHA256:review.generation.promptSHA256,rawOutputSHA256:review.generation.rawOutputSHA256,promptTokens:review.generation.promptTokens});return value;});
  await runContentWritingJob(h.repo,h.config);const failed=await p.job(job.id);
  expect(failed.status).toBe('failed');expect(failed.result).toBeNull();expect(failed.unresolvedReviewHash).toBeUndefined();
  expect((await p.api.post('/studio/content/writing/jobs/'+job.id+'/adopt',{version:failed.version,variantIndex:0,name:'不可绕过的日期错误',confirmed:true,acknowledgeUnresolvedReview:true,reviewSHA256:'0'.repeat(64)})).statusCode).toBe(409);
  await p.api.good('/studio/content/writing/jobs/'+job.id+'/control',{version:failed.version,action:'retry',confirmed:true});await runContentWritingJob(h.repo,h.config);
  const retried=await p.job(job.id);expect(retried.status).toBe('succeeded');expect(retried.attempts).toBe(2);expect(retried.evidence!.engine.policy).toBe('source-script-reviewed-v3');expectNoNativeClaim(h);
},30000);

it('取消时原租约保留至执行关闭，迟到v3结果不能提交，重试后撤回仍隐藏原稿和新核对',async()=>{
  const p=await writingFixture(h,'source-script-reviewed-v3'),spy=contract(),job=await p.create();let entered=false,release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);spy.mockImplementationOnce(async input=>{entered=true;await gate;return writingCalendarContractResult(input.request,input.engine);});
  const running=runContentWritingJob(h.repo,h.config);await vi.waitFor(()=>expect(entered).toBe(true));
  await p.api.good('/studio/content/writing/jobs/'+job.id+'/control',{version:job.version,action:'cancel',confirmed:true});expect(h.repo.all('SELECT * FROM native_model_leases')).toHaveLength(1);release();await running;
  const cancelled=await p.job(job.id);expect(cancelled.status).toBe('cancelled');expect(cancelled.result).toBeNull();
  await p.api.good('/studio/content/writing/jobs/'+job.id+'/control',{version:cancelled.version,action:'retry',confirmed:true});await runContentWritingJob(h.repo,h.config);
  expect((await p.job(job.id)).status).toBe('succeeded');await p.api.good('/studio/content/sources/'+p.source.id+'/withdraw',{version:1,confirmed:true});
  const hidden=await p.job(job.id);expect(hidden.request).toBeNull();expect(hidden.result).toBeNull();expect(hidden.evidence).toBeNull();expectNoNativeClaim(h);
},30000);
