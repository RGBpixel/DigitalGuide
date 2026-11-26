// Contract fixtures never claim to have run model inference.
import type {ContentWritingRequest,ContentWritingEngine,ContentWritingResult,ContentWritingNativeResult,WritingInferenceReceipt,WritingReviewEvidence} from '@digitalguide/contracts';
import {contentWritingHash} from '../../domain/src/content-writing-model.js';
import {contentWritingHashText,contentWritingReviewedPrompt,writingReviewUnits,writingReviewBatches,writingReviewPrompt,writingRepairPrompt,writingRepairChecks} from '../../domain/src/writing-review.js';
import {writingConstraintFindings} from '../../domain/src/writing-constraints.js';
import {writingContractResult} from './content-writing.js';
const receipt=(prompt:string,input:unknown,maximumOutputTokens:number):WritingInferenceReceipt=>({inputSHA256:contentWritingHash(input),promptSHA256:contentWritingHashText(prompt),rawOutputSHA256:'2'.repeat(64),promptTokens:100,maximumOutputTokens,elapsedMs:1});
export function writingReviewedContractResult(request:ContentWritingRequest,engine:ContentWritingEngine,repair=false):ContentWritingNativeResult{
 if(engine.policy==='source-script-variants-v1')throw new Error('Contract fixture requires reviewed policy');const base=writingContractResult(request,engine),sources=request.sources.slice(0,6),initialResult=structuredClone(base.result);if(repair)initialResult.variants[0].sections[0].text=initialResult.variants[0].sections[0].text.replace('预约确认后','预约后');
 const pass=(result:ContentWritingResult,initial=false)=>{const units=writingReviewUnits(result,sources);return{resultSHA256:contentWritingHash(result),guardFindings:writingConstraintFindings(units,engine.guardPolicy),checks:units.map(u=>({checkId:u.checkId,inputSHA256:contentWritingHash(u),evidenceNote:initial&&u.checkId==='v0s0'?'契约夹具：缺少预约确认条件':'契约夹具：非实际模型核对',verdict:initial&&u.checkId==='v0s0'?'unsupported' as const:'supported' as const,issues:initial&&u.checkId==='v0s0'?['condition_missing' as const]:[]})),calls:writingReviewBatches(units,engine.reviewBatchCharacters,engine.reviewBatchSize).map(batch=>({...receipt(writingReviewPrompt(batch,engine.reviewPolicy).prompt,batch,engine.maximumReviewOutputTokens),checkIds:batch.map(u=>u.checkId)}))};};
 const review:WritingReviewEvidence={policy:engine.reviewPolicy,outcome:'model-supported',initialResult,generation:receipt(contentWritingReviewedPrompt(request,sources,engine.guardPolicy).prompt,{request,sources},engine.model.maximumOutputTokens),passes:[pass(initialResult,repair)]};if(repair){const checks=writingRepairChecks(review.passes[0]);review.repair=receipt(writingRepairPrompt(request,initialResult,sources,checks,engine.guardPolicy).prompt,{request,result:initialResult,sources,checks},engine.model.maximumOutputTokens);review.patch={sectionPatches:[{checkId:'v0s0',edits:[{oldText:'预约后',newText:'预约确认后'}],additionalCitations:[]}],headingPatches:[]};review.passes.push(pass(base.result));}const last=review.repair||review.generation;return{...base,evidence:{...base.evidence,promptSHA256:last.promptSHA256,rawOutputSHA256:last.rawOutputSHA256,promptTokens:last.promptTokens,review}};
}

export function writingCalendarContractResult(request:ContentWritingRequest,engine:ContentWritingEngine):ContentWritingNativeResult{
 if(engine.policy!=='source-script-reviewed-v3')throw new Error('Calendar contract fixture requires v3');
 const native=writingReviewedContractResult(request,engine),sources=request.sources.slice(0,6),review=native.evidence.review!,initialResult=structuredClone(native.result);
 initialResult.variants[0].sections[0].text=initialResult.variants[0].sections[0].text.replace('每天','工作日');
 const pass=(result:ContentWritingResult)=>{const units=writingReviewUnits(result,sources);return{resultSHA256:contentWritingHash(result),guardFindings:writingConstraintFindings(units,engine.guardPolicy),checks:units.map(u=>({checkId:u.checkId,inputSHA256:contentWritingHash(u),verdict:'supported' as const,issues:[],evidenceNote:'契约夹具：模拟模型漏检日期范围，非实际推理'})),calls:writingReviewBatches(units,engine.reviewBatchCharacters,engine.reviewBatchSize).map(batch=>({...receipt(writingReviewPrompt(batch,engine.reviewPolicy).prompt,batch,engine.maximumReviewOutputTokens),checkIds:batch.map(u=>u.checkId)}))};};
 review.initialResult=initialResult;review.passes=[pass(initialResult)];
 const checks=writingRepairChecks(review.passes[0]);
 review.patch={sectionPatches:[{checkId:'v0s0',edits:[{oldText:'工作日',newText:'每天'}],additionalCitations:[]}],headingPatches:[]};
 review.repair=receipt(writingRepairPrompt(request,initialResult,sources,checks,engine.guardPolicy).prompt,{request,result:initialResult,sources,checks},engine.model.maximumOutputTokens);
 review.passes.push(pass(native.result));
 Object.assign(native.evidence,{promptSHA256:review.repair.promptSHA256,rawOutputSHA256:review.repair.rawOutputSHA256,promptTokens:review.repair.promptTokens});
 return native;
}
