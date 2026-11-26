import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {writingRepairResult,type ContentWritingRequest,type ContentWritingResult} from '@digitalguide/contracts';
import {contentWritingModel} from '../packages/providers/src/content-writing-model.js';
import {writingInference} from '../packages/providers/src/writing-inference.js';
import {runWritingReviewPass} from '../packages/providers/src/content-writing-reviewed.js';
import {writingRepairPrompt,writingRepairChecks,writingReviewOutcome,applyWritingRepair,parseWritingJson} from '../packages/domain/src/writing-review.js';
import {validateContentWritingResult,contentWritingHash} from '../packages/domain/src/content-writing-model.js';

const root=process.cwd(),folder=path.resolve(process.argv[2]||'docs/evidence/T24/writing-calendar/model-repair-first'),priorFile='docs/evidence/T24/writing-review/model-full-human-review/probe.json';
const prior=JSON.parse(fs.readFileSync(priorFile,'utf8')) as {request:ContentWritingRequest;native:{result:ContentWritingResult;evidence:{retrievedSourceIds:string[]}}},request=prior.request,initial=prior.native.result,sources=request.sources.filter(s=>prior.native.evidence.retrievedSourceIds.includes(s.id));
assert.ok(initial.variants[1].sections[0].text.includes('其他工作日'));
const db=new DatabaseSync('storage/digitalguide.sqlite',{readOnly:true});try{assert.equal((db.prepare('SELECT count(*) n FROM native_model_leases').get() as {n:number}).n,0);}finally{db.close();}
fs.mkdirSync(folder,{recursive:true});assert.ok(!fs.existsSync(path.join(folder,'probe.json')));
const profile=await contentWritingModel(root,true),engine=profile.writingEngine;if(engine.policy!=='source-script-reviewed-v3')throw new Error('Calendar v3 required');
let callCount=0;const runtime=writingInference(profile,engine,path.join(folder,'private-work'),new AbortController().signal,call=>fs.writeFileSync(path.join(folder,'call-'+String(++callCount).padStart(2,'0')+'.json'),JSON.stringify(call,null,2)+'\n',{flag:'wx'}));
const startedAt=new Date().toISOString(),checks:string[]=[],state:Record<string,unknown>={};let failure:unknown;
try{
  const first=await runWritingReviewPass(runtime,initial,sources,engine,p=>console.log(JSON.stringify({stage:'first-review',progress:p})));state.first=first;
  assert.equal(first.guardFindings.length,1);assert.equal(first.guardFindings[0].rule,'availability-calendar');assert.equal(first.guardFindings[0].checkId,'v1s0');
  checks.push('current_actual_paragraph_reviews_and_separate_calendar_rule_identify_previous_unadopted_candidate_defect');
  const repairChecks=writingRepairChecks(first),built=writingRepairPrompt(request,initial,sources,repairChecks,engine.guardPolicy),repair=await runtime.infer('repair',built,{request,result:initial,sources,checks:repairChecks},engine.model.maximumOutputTokens,.2);
  const patch=writingRepairResult.parse(parseWritingJson(repair.raw));state.patch=patch;state.repairReceipt=repair.receipt;
  const result=validateContentWritingResult(applyWritingRepair(initial,patch,repairChecks,engine.guardPolicy),request,sources);state.result=result;
  assert.deepEqual(result.variants[0],initial.variants[0]);assert.deepEqual(result.variants[1].sections[1],initial.variants[1].sections[1]);
  assert.equal(result.variants[1].title,initial.variants[1].title);assert.equal(result.variants[1].angle,initial.variants[1].angle);
  assert.ok(!result.variants[1].sections[0].text.includes('工作日'));
  assert.ok(result.variants[1].sections[0].text.includes('周三'));
  assert.deepEqual(result.variants[1].sections[0].citations,initial.variants[1].sections[0].citations);
  checks.push('actual_model_span_patch_removes_workday_narrowing_without_changing_other_candidates_sections_titles_or_original_quotes');
  const last=await runWritingReviewPass(runtime,result,sources,engine,p=>console.log(JSON.stringify({stage:'final-review',progress:p})));state.last=last;state.modelOutcome=writingReviewOutcome(last.checks);assert.deepEqual(last.guardFindings,[]);
  checks.push('all_four_final_paragraphs_actually_rechecked_and_current_calendar_guard_satisfied_with_raw_model_opinions_retained');
}catch(error){failure=error;}finally{
  await runtime.close();const result={result:failure?'FAIL':'PASS_CORRECTED_KNOWN_CALENDAR_DEFECT_ONLY',startedAt,checkedAt:new Date().toISOString(),priorFile,priorResultSHA256:contentWritingHash(initial),request,initial,sources,engine,checks,state,actualCalls:callCount,actualGenerationOfInitialThisRun:false,reusedOriginalActualV2Candidates:true,actualQwenReviewAndPatch:true,manualPatchApplied:false,fullV3GenerationWorkerProof:false,generalFactualQualityVerified:false,productionWorkerLeaseProof:false,realExternalActions:false,error:failure instanceof Error?failure.stack:failure?String(failure):null};
  fs.writeFileSync(path.join(folder,'probe.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:result.result,checks:checks.length,calls:callCount}));if(failure)process.exitCode=1;
}
