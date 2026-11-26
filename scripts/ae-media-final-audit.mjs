import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const folder='docs/evidence/T25/ae-adoption',file=folder+'/verification.json',report=JSON.parse(fs.readFileSync(file,'utf8')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),checks=[];
assert.equal(report.result,'PASS_LOCAL_AE_MEDIA_ADOPTION_WORKFLOW');
for(const[kind,entries]of Object.entries({source:report.sourceSHA256,evidence:report.evidenceSHA256,earlier:report.earlierFinalManifestSHA256}))for(const[f,sha]of Object.entries(entries)){assert.equal(hash(f),sha,f);checks.push({kind,file:f});}
assert.equal(report.wholeTaskOrPlatformCompleted,false);assert.equal(report.taskStatus,'in_progress');assert.equal(report.totalLocallyVerifiedTasks,22);assert.equal(report.scope.requirements,134);assert.equal(report.main.migration,'049-ae-media-adoptions.sql');assert.equal(report.main.baselineReplaced,false);
fs.writeFileSync(folder+'/final-audit.json',JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),manifestSHA256:hash(file),checkedEntries:checks.length,sourceFiles:Object.keys(report.sourceSHA256).length,evidenceFiles:Object.keys(report.evidenceSHA256).length,earlierManifests:Object.keys(report.earlierFinalManifestSHA256).length,wholeTaskOrPlatformCompleted:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'PASS',checkedEntries:checks.length,manifestSHA256:hash(file)}));
