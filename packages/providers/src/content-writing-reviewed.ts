import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {AppError} from '@digitalguide/domain';
import {contentWritingNativeResult,writingRepairResult,type ContentWritingResult,type ContentWritingSource,type ReviewedWritingEngine,type WritingReviewEvidence} from '@digitalguide/contracts';
import {contentWritingHash,contentWritingQuery,parseContentWriting,validateContentWritingResult} from '../../domain/src/content-writing-model.js';
import {contentWritingReviewedPrompt,writingReviewUnits,writingReviewBatches,writingReviewPrompt,parseWritingReview,writingRepairPrompt,parseWritingJson,applyWritingRepair,validateWritingReview,writingRepairChecks,writingReviewOutcome} from '../../domain/src/writing-review.js';
import {writingConstraintFindings} from '../../domain/src/writing-constraints.js';
import {rankSemanticTexts} from '../../media/src/semantic-retrieval.js';
import {requireContentWritingModel} from './content-writing-model.js';
import {writingInference,type WritingInference,type WritingInferenceObservation} from './writing-inference.js';
import type {ContentWritingRunInput} from './content-writing-native-v1.js';
export async function runWritingReviewPass(runtime:WritingInference,result:ContentWritingResult,sources:ContentWritingSource[],engine:ReviewedWritingEngine,progress:(fraction:number)=>void=()=>{}){
 const batches=writingReviewBatches(writingReviewUnits(result,sources),engine.reviewBatchCharacters,engine.reviewBatchSize),checks:WritingReviewEvidence['passes'][number]['checks']=[],calls:WritingReviewEvidence['passes'][number]['calls']=[];
 for(let i=0;i<batches.length;i++){const batch=batches[i],value=await runtime.infer('review',writingReviewPrompt(batch,engine.reviewPolicy),batch,engine.maximumReviewOutputTokens,0);checks.push(...parseWritingReview(value.raw,batch));calls.push({...value.receipt,checkIds:batch.map(u=>u.checkId)});progress((i+1)/batches.length);}return{resultSHA256:contentWritingHash(result),checks,guardFindings:writingConstraintFindings(writingReviewUnits(result,sources),engine.guardPolicy),calls};
}
export async function runContentWritingReviewed(input:ContentWritingRunInput,signal:AbortSignal,onProgress:(fraction:number)=>void,observe?:(value:WritingInferenceObservation)=>void){
 if(input.engine.policy==='source-script-variants-v1')throw new AppError('CONTENT_WRITING_REVIEW_POLICY','来源核对要求固定的新版写作策略。',409);
 const engine=input.engine,started=performance.now(),profile=await requireContentWritingModel(input.root,engine,true),runtime=writingInference(profile,engine,input.directory,signal,observe);
 try{const ranked=await rankSemanticTexts(input.root,engine.retrieval,contentWritingQuery(input.request),input.request.sources.map(s=>s.text),signal,p=>onProgress(p*.15)),selected=input.request.sources.map((s,i)=>({s,score:ranked.scores[i],i})).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,engine.maximumSources).map(v=>v.s);onProgress(.2);
 const generation=await runtime.infer('generate',contentWritingReviewedPrompt(input.request,selected,engine.guardPolicy),{request:input.request,sources:selected},engine.model.maximumOutputTokens,.6),initialResult=parseContentWriting(generation.raw,input.request,selected);onProgress(.5);
 const review:WritingReviewEvidence={policy:engine.reviewPolicy,outcome:'needs-human-review',initialResult,generation:generation.receipt,passes:[await runWritingReviewPass(runtime,initialResult,selected,engine,p=>onProgress(.5+p*.18))]};let result=initialResult,last=generation.receipt;
 if(review.passes[0].guardFindings.length){onProgress(.7);const checks=writingRepairChecks(review.passes[0]),repair=await runtime.infer('repair',writingRepairPrompt(input.request,initialResult,selected,checks,engine.guardPolicy),{request:input.request,result:initialResult,sources:selected,checks},engine.model.maximumOutputTokens,.2);review.repair=repair.receipt;review.patch=writingRepairResult.parse(parseWritingJson(repair.raw));last=repair.receipt;result=validateContentWritingResult(applyWritingRepair(initialResult,review.patch,checks,engine.guardPolicy),input.request,selected);onProgress(.82);review.passes.push(await runWritingReviewPass(runtime,result,selected,engine,p=>onProgress(.82+p*.15)));}
 review.outcome=writingReviewOutcome(review.passes.at(-1)!.checks);if(review.passes.at(-1)!.guardFindings.length)throw new AppError('CONTENT_WRITING_UNSUPPORTED','局部修订后仍有明确的条件或范围规则未满足，未生成可采用候选；请核对资料后重试或人工起稿。',409);
 await requireContentWritingModel(input.root,engine,true);signal.throwIfAborted();const native=contentWritingNativeResult.parse({result,evidence:{engine,inputSHA256:contentWritingHash(input.request),promptSHA256:last.promptSHA256,rawOutputSHA256:last.rawOutputSHA256,promptTokens:last.promptTokens,elapsedMs:performance.now()-started,retrievedSourceIds:selected.map(s=>s.id),retrievalInferences:ranked.inferences,compiledWorkerEntry:path.resolve(process.argv[1]||'')===path.join(input.root,'dist/content-writing.mjs'),offlineCpu:true,review}});validateWritingReview(native,input.request,selected);onProgress(1);return native;
 }finally{await runtime.close();}
}
