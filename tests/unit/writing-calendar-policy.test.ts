import {it,expect} from 'vitest';
import {contentWritingEngine,contentWritingNativeResult} from '@digitalguide/contracts';
import {contentWritingModel} from '../../packages/providers/src/content-writing-model.js';
import {writingRequest} from '../../packages/test-fixtures/src/content-writing.js';
import {writingCalendarContractResult,writingReviewedContractResult} from '../../packages/test-fixtures/src/writing-review.js';
import {applyWritingRepair,validateWritingReview} from '../../packages/domain/src/writing-review.js';
import {contentWritingHash} from '../../packages/domain/src/content-writing-model.js';

const engine=(await contentWritingModel(process.cwd())).writingEngine;
it('新任务固定v3日期规则与核对提示，旧v2仍可按原策略创建且不可混搭元数据',async()=>{
  expect(engine.policy).toBe('source-script-reviewed-v3');
  const old=(await contentWritingModel(process.cwd(),false,'source-script-reviewed-v2')).writingEngine;
  expect(old.policy==='source-script-reviewed-v2'&&old.guardPolicy).toBe('explicit-constraints-v1');
  expect(contentWritingEngine.safeParse({...engine,guardPolicy:'explicit-constraints-v1'}).success).toBe(false);
  expect(contentWritingEngine.safeParse({...old,reviewPolicy:'paragraph-support-v2'}).success).toBe(false);
});

it('模型漏检与日期规则发现分开，v3只修订命中片段且服务端可重放全部回执',()=>{
  const request=writingRequest(),native=writingCalendarContractResult(request,engine),review=native.evidence.review!;
  expect(contentWritingNativeResult.parse(native)).toEqual(native);
  expect(review.passes[0].checks[0].verdict).toBe('supported');
  expect(review.passes[0].guardFindings[0].rule).toBe('availability-calendar');
  expect(review.passes[1].guardFindings).toEqual([]);
  expect(()=>validateWritingReview(native,request,request.sources)).not.toThrow();
  expect(native.result.variants[1]).toEqual(review.initialResult.variants[1]);
  expect(native.result.variants[0].sections[0].citations).toEqual(review.initialResult.variants[0].sections[0].citations);
});

it('把旧v2回执换成v3引擎身份不能伪造新策略执行',async()=>{
  const request=writingRequest(),old=(await contentWritingModel(process.cwd(),false,'source-script-reviewed-v2')).writingEngine,native=writingReviewedContractResult(request,old);
  native.evidence.engine=engine;
  expect(()=>validateWritingReview(native,request,request.sources)).toThrow(/回执/);
});

it('删除规则发现、伪造最终日期或移除实际修订回执均不能绕过服务端检查',()=>{
  const request=writingRequest();
  for(const mutate of [
    (n:ReturnType<typeof writingCalendarContractResult>)=>{n.evidence.review!.passes[0].guardFindings=[];},
    (n:ReturnType<typeof writingCalendarContractResult>)=>{n.result.variants[0].sections[0].text=n.evidence.review!.initialResult.variants[0].sections[0].text;},
    (n:ReturnType<typeof writingCalendarContractResult>)=>{delete n.evidence.review!.repair;},
  ]){const native=writingCalendarContractResult(request,engine);mutate(native);expect(()=>validateWritingReview(native,request,request.sources)).toThrow();}
});

it('颠倒起止时间的片段只有明确数字问题才允许纠正，其他文字及引用保持',()=>{
  const quote='展厅每天09:00—17:00开放，周三闭馆。',text='展厅每天17:00到09:00开放，周三闭馆。',initial={variants:[{title:'开放安排',angle:'开放安排',sections:[{text,citations:[{sourceId:'s0c0',quote}]}]}]},checks=[{checkId:'v0s0',inputSHA256:contentWritingHash(text),verdict:'unsupported' as const,issues:['number_changed' as const],evidenceNote:'契约：起止时间颠倒'}],patch={sectionPatches:[{checkId:'v0s0',edits:[{oldText:'17:00到09:00',newText:'09:00到17:00'}],additionalCitations:[]}],headingPatches:[]};
  const fixed=applyWritingRepair(initial,patch,checks,'explicit-constraints-v2');
  expect(fixed.variants[0].sections[0]).toEqual({text:'展厅每天09:00到17:00开放，周三闭馆。',citations:initial.variants[0].sections[0].citations});
  expect(()=>applyWritingRepair(initial,patch,[{...checks[0],issues:['scope_changed']}],'explicit-constraints-v2')).toThrow(/数字/);
});
