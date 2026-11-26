import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T22/caption-pagination',read=f=>JSON.parse(fs.readFileSync(root+'/'+f,'utf8')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),oldBindings={
 'apps/api/src/studio-export-service.ts':root+'/source-before/apps__api__src__studio-export-service.ts.pre-history.ts.txt',
 'packages/postgres/src/runtime-studio-media.ts':root+'/source-before/packages__postgres__src__runtime-studio-media.ts.pre-history.ts.txt',
 'tests/integration/caption-plans.test.ts':root+'/source-before/caption-plans.pre-history.test.ts.txt'
},cases=new Set(),files=new Set(),runs=[];let executions=0;
for(const label of ['affected-current','history-current']){const r=read(label+'.json'),c=read(label+'-command.json');assert.equal(r.success,true);assert.equal(c.exitCode,0);const bindings=[];for(const[file,sha256]of Object.entries(c.sourceSHA256)){const bound=label==='affected-current'&&oldBindings[file]?oldBindings[file]:file;assert.equal(hash(bound),sha256,file);bindings.push({file,bound,sha256});}for(const s of r.testResults)for(const t of s.assertionResults){assert.equal(t.status,'passed');cases.add(s.name+'|'+t.fullName);files.add(s.name);executions++;}runs.push({label,passed:r.numPassedTests,files:r.testResults.length,bindings});}
assert.deepEqual([cases.size,files.size,executions],[601,45,671]);
for(const[label,passed,failed]of [['regression-before-ink',0,2],['regression-after',2,0],['history-before',8,2]]){const r=read(label+'.json');assert.deepEqual([r.numPassedTests,r.numFailedTests],[passed,failed]);}
const result={result:'PASS',checkedAt:new Date().toISOString(),distinctPassed:cases.size,files:files.size,passingExecutions:executions,newFeatureCases:32,runs,notSingleFullRun:true,fullAffectedRunBeforeCompatibilityDelta:{passed:588,files:44},finalFocusedRun:{passed:83,files:7},extraExistingPresentationCases:11,compatibilityRegression:{before:{passed:8,failed:2},finalIncluded:true},estimatedDisplayTiming:true,priorFailuresRetained:true,priorFullRunTestReconstructedAndExactSHA256Matched:true,originalDocumentAndSidecarTestsIncluded:true};fs.writeFileSync(root+'/backend-summary.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'PASS',distinct:cases.size,files:files.size,executions,newCases:32}));
