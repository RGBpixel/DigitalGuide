import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonical} from '@digitalguide/domain';
import type {WritingReviewCheck,WritingConstraintFinding} from '@digitalguide/contracts';
import {contentWritingModel} from '../packages/providers/src/content-writing-model.js';
import {writingInference} from '../packages/providers/src/writing-inference.js';
import {writingReviewPrompt,parseWritingReview,type WritingReviewUnit} from '../packages/domain/src/writing-review.js';
import {writingConstraintFindings,effectiveWritingChecks} from '../packages/domain/src/writing-constraints.js';

interface Case {id:string;source:string;text:string;supported:boolean;expectedRule:boolean}
interface Row extends Case {check:WritingReviewCheck;guardFindings:WritingConstraintFinding[];modelOnlyPass:boolean;ruleMatchesFrozenExpectation:boolean;combinedPass:boolean;call:string}
const root=process.cwd(),evidence='docs/evidence/T24/writing-calendar',folder=path.resolve(process.argv[2]||evidence+'/model-calendar-first'),fixture='packages/test-fixtures/assets/writing-calendar-heldout.json',hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const frozen=JSON.parse(fs.readFileSync(evidence+'/holdout-prepared.json','utf8')) as {sha256:string};assert.equal(hash(fixture),frozen.sha256);
const cases=(JSON.parse(fs.readFileSync(fixture,'utf8')) as {cases:Case[]}).cases;
const profile=await contentWritingModel(root,true),engine=profile.writingEngine;if(engine.policy!=='source-script-reviewed-v3')throw new Error('Calendar v3 engine required');
const sourceSHA256=Object.fromEntries(['packages/domain/src/writing-calendar.ts','packages/domain/src/writing-constraints.ts','packages/domain/src/writing-review.ts'].map(f=>[f,hash(f)]));
fs.mkdirSync(folder,{recursive:true});assert.ok(!fs.existsSync(path.join(folder,'probe.json')));
const checkpoint=path.join(folder,'checkpoint.json'),old=fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint,'utf8')) as {fixtureSHA256:string;engine:typeof engine;sourceSHA256:typeof sourceSHA256;rows:Row[];startedAt:string}:null;
if(old){assert.equal(old.fixtureSHA256,frozen.sha256);assert.equal(canonical(old.engine),canonical(engine));assert.deepEqual(old.sourceSHA256,sourceSHA256);}
const db=new DatabaseSync('storage/digitalguide.sqlite',{readOnly:true});try{assert.equal((db.prepare('SELECT count(*) n FROM native_model_leases').get() as {n:number}).n,0);}finally{db.close();}
const rows:Row[]=old?.rows||[],startedAt=old?.startedAt||new Date().toISOString(),runtime=writingInference(profile,engine,path.join(folder,'private-work-'+Date.now()),new AbortController().signal);
let error:unknown;
try{
  for(let i=rows.length;i<cases.length;i++){
    const item=cases[i],units:WritingReviewUnit[]=[{checkId:'v0s0',kind:'section',content:{text:item.text},supports:[{sourceId:'s0c0',quote:item.source}]}],built=writingReviewPrompt(units,engine.reviewPolicy),value=await runtime.infer('calendar-review',built,units,engine.maximumReviewOutputTokens,0),check=parseWritingReview(value.raw,units)[0],guardFindings=writingConstraintFindings(units,engine.guardPolicy),effective=effectiveWritingChecks([check],guardFindings)[0],call=path.join(folder,'call-'+String(i+1).padStart(2,'0')+'.json');
    fs.writeFileSync(call,JSON.stringify({itemId:item.id,units,prompt:built.prompt,schema:built.schema,raw:value.raw,receipt:value.receipt},null,2)+'\n',{flag:'wx'});
    rows.push({...item,check,guardFindings,modelOnlyPass:(check.verdict==='supported')===item.supported,ruleMatchesFrozenExpectation:Boolean(guardFindings.length)===item.expectedRule,combinedPass:(effective.verdict==='supported')===item.supported,call});
    fs.writeFileSync(checkpoint,JSON.stringify({startedAt,fixtureSHA256:frozen.sha256,engine,sourceSHA256,rows},null,2)+'\n');
    console.log(JSON.stringify({completed:i+1,total:cases.length,id:item.id,model:check.verdict,ruleFindings:guardFindings.length,combinedPass:rows.at(-1)!.combinedPass}));
  }
}catch(e){error=e;}finally{
  await runtime.close();const failures=rows.filter(r=>!r.combinedPass),ruleFailures=rows.filter(r=>!r.ruleMatchesFrozenExpectation),result={result:!error&&rows.length===cases.length&&!failures.length&&!ruleFailures.length?'PASS_SYNTHETIC_CALENDAR_MATRIX_ONLY':'FAIL',startedAt,checkedAt:new Date().toISOString(),fixture,fixtureSHA256:frozen.sha256,sourceSHA256,engine,cases:rows,failures,ruleFailures,modelOnlyFailures:rows.filter(r=>!r.modelOnlyPass),generalFactualQualityVerified:false,independentExternalBlindTest:false,productionWorkerLeaseProof:false,realExternalActions:false,error:error instanceof Error?error.stack:error?String(error):null};
  fs.writeFileSync(path.join(folder,'probe.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({result:result.result,checks:rows.length,combinedFailures:failures.length,ruleFailures:ruleFailures.length,modelOnlyFailures:result.modelOnlyFailures.length}));
  if(result.result==='FAIL')process.exitCode=1;
}
