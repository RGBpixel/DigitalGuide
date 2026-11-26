import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writingConstraintFindings,effectiveWritingChecks} from '../packages/domain/src/writing-constraints.js';
import {writingReviewPrompt,parseWritingReview,type WritingReviewUnit} from '../packages/domain/src/writing-review.js';
import type {WritingReviewCheck,WritingConstraintFinding} from '@digitalguide/contracts';
const folder='docs/evidence/T24/writing-calendar',output=process.argv[2]||folder+'/rules-final-replay.json',hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const probe=JSON.parse(fs.readFileSync(folder+'/model-calendar-first/probe.json','utf8')) as {sourceSHA256:Record<string,string>;cases:{id:string;text:string;source:string;supported:boolean;expectedRule:boolean;check:WritingReviewCheck;guardFindings:WritingConstraintFinding[];call:string}[]};
for(const file of ['packages/domain/src/writing-review.ts','packages/domain/src/writing-constraints.ts'])assert.equal(hash(file),probe.sourceSHA256[file]);
let rulesMatched=0,combinedMatched=0,modelsMatched=0;
for(const row of probe.cases){
  const units:WritingReviewUnit[]=[{checkId:'v0s0',kind:'section',content:{text:row.text},supports:[{sourceId:'s0c0',quote:row.source}]}],call=JSON.parse(fs.readFileSync(row.call,'utf8')) as {prompt:string;raw:string};
  assert.equal(writingReviewPrompt(units,'paragraph-support-v2').prompt,call.prompt);assert.deepEqual(parseWritingReview(call.raw,units),[row.check]);
  const observed=writingConstraintFindings(units,'explicit-constraints-v2');assert.deepEqual(observed,row.guardFindings);
  if(Boolean(observed.length)===row.expectedRule)rulesMatched++;
  if((row.check.verdict==='supported')===row.supported)modelsMatched++;
  if((effectiveWritingChecks([row.check],observed)[0].verdict==='supported')===row.supported)combinedMatched++;
}
assert.equal(probe.cases.length,20);assert.equal(rulesMatched,20);assert.equal(modelsMatched,17);assert.equal(combinedMatched,18);
fs.writeFileSync(output,JSON.stringify({result:'PASS_RULE_REPLAY_AND_UNCHANGED_ACTUAL_PROMPTS',checkedAt:new Date().toISOString(),cases:20,rulesMatched,actualModelMatched:modelsMatched,combinedMatched,actualModelMatrixResult:'FAIL',modelOpinionsOrExpectedLabelsRewritten:false,postHocRulesOnly:true,freshNativeInference:false,allFinalFindingsEqualOriginalFindings:true,allCurrentReviewPromptsEqualActuallyExecutedPrompts:true,calendarSourceChangedAfterModelRun:true,change:'Continuous source spans for multiple closures, explicit weekday/weekend unions and adjacent explicit opening-time clauses; earlier executions retained and additional regressions separately verified.',modelRunSourceSHA256:probe.sourceSHA256,finalCalendarSourceSHA256:hash('packages/domain/src/writing-calendar.ts'),generalFactualQualityVerified:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PASS_RULE_REPLAY_AND_UNCHANGED_ACTUAL_PROMPTS',rulesMatched,actualModelMatched:modelsMatched,combinedMatched}));
