import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/G1/local-exit',read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),criteria=read(root+'/criteria.json'),start=read(root+'/start-source-audit.json');
const output=root+'/review.json';assert.ok(!fs.existsSync(output));assert.equal(criteria.requirements.length,32);assert.equal(criteria.acceptanceCases.length,18);
assert.equal(criteria.acceptanceDefinitionSHA256,hash('docs/04-roadmap-acceptance.md'));
const b=read('docs/backlog.json'),backendFiles=[root+'/current-local-backend.json',root+'/explicit-batch-and-video.json',root+'/closure-second/backend.json'];
const currentCases=new Map(),commands=[];
for(const file of backendFiles){const r=read(file);assert.equal(r.success,true);assert.equal(r.numFailedTests,0);assert.equal(r.numPendingTests,0);for(const t of r.testResults){const name=path.relative(process.cwd(),t.name).replaceAll('\\','/');assert.ok(t.assertionResults.length);assert.ok(t.assertionResults.every(a=>a.status==='passed'));assert.ok(!currentCases.has(name));currentCases.set(name,{file:name,sourceSHA256:hash(name),report:file,assertions:t.assertionResults.map(a=>({title:a.fullName,status:a.status}))});}commands.push({report:file,passed:r.numPassedTests,failed:0,files:r.testResults.length,sha256:hash(file)});}
assert.equal(commands[0].passed,187);assert.equal(commands[0].files,19);assert.equal(commands[1].passed,13);assert.equal(commands[1].files,2);assert.equal(commands[2].passed,1);assert.equal(commands[2].files,1);
assert.ok(currentCases.get('tests/integration/studio-batches.test.ts').assertions.some(a=>a.title.includes('20个工程逐项真实生成')));
assert.ok(currentCases.get('tests/integration/transcriptions.test.ts').assertions.some(a=>a.title.includes('真实中文离线识别完整跨停顿文件')));
const failed=read(root+'/runtime/legacy/runners.json'),resumed=read(root+'/runtime/legacy-resumed/runners.json');
assert.equal(failed.result,'FAIL');assert.equal(failed.groups.at(-1).name,'media-processing');assert.equal(failed.groups.at(-1).exitCode,1);assert.equal(resumed.result,'PASS');
const legacy=[...failed.groups.filter(g=>g.exitCode===0),...resumed.groups];assert.equal(legacy.length,20);assert.equal(new Set(legacy.map(g=>g.name)).size,20);
for(const g of legacy){assert.equal(g.exitCode,0);assert.ok(g.result.startsWith('PASS'));}
const manifestFiles=new Set(b.tasks.filter(t=>criteria.taskIds.includes(t.id)).flatMap(t=>t.evidence.filter(f=>f.endsWith('verification.json'))));manifestFiles.add('docs/evidence/T26/verification.json');
const reports=new Map(),manifestReviews=[];
function localFile(v,manifest){if(typeof v!=='string')return null;const options=[v,path.join(path.dirname(manifest),v)];return options.find(f=>fs.existsSync(f)&&!path.relative(process.cwd(),path.resolve(f)).startsWith('..'))?.replaceAll('\\','/');}
for(const file of manifestFiles){
 const r=read(file);assert.ok(r.result.startsWith('PASS'),file);const pinned=new Map(),references=new Set();
 function scan(v){
  if(typeof v==='string'){if(v.endsWith('e2e-results.json')){const p=localFile(v,file);if(p)references.add(p);}return;}
  if(Array.isArray(v)){v.forEach(scan);return;}if(!v||typeof v!=='object')return;
  if(typeof v.file==='string'&&typeof v.sha256==='string'&&/^[a-f0-9]{64}$/.test(v.sha256)){const p=localFile(v.file,file);if(p)pinned.set(p,v.sha256);}
  for(const[k,value]of Object.entries(v)){const p=localFile(k,file);if(p&&typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))pinned.set(p,value);if(k.endsWith('e2e-results.json')&&p)references.add(p);scan(value);}
 }
 scan(r);const browser=[];
 for(const f of references){const sha=hash(f);if(pinned.has(f))assert.equal(sha,pinned.get(f),f);const e=read(f);if(!e.stats)continue;const passing=e.stats.expected>0&&e.stats.unexpected===0&&e.stats.skipped===0&&e.stats.flaky===0;const item={file:f,sha256:sha,pinnedHashVerified:pinned.has(f),historical:true,passing,stats:e.stats};browser.push(item);if(!reports.has(f))reports.set(f,item);}
 manifestReviews.push({file,sha256:hash(file),result:r.result,historicalBrowserReports:browser});
}
const historyByRequirement={
 'R-072':['T24/content-drafts','T24/content-writing','T24/writing-calendar'],'R-073':['T24/content-sources','T24/content-drafts','T24/transcriptions'],'R-074':['T24/recording'],'R-076':['T24/media-processing','T24/segmentation','T24/gaze','T24/denoising'],'R-078':['T24/tracking'],'R-079':['T24/semantic-clips'],'R-080':['T24/restoration'],'R-127':['T24/assistant','T24/local-editor'],
 'R-081':['T25/templates','T25/ae','T25/ae-source','T25/ae-adoption'],'R-082':['T25/templates'],'R-083':['T25/frame-reviews'],'R-084':['T25/asset-library','T25/file-collections'],'R-085':['T25/shares'],'R-086':['T25/courses'],'R-087':['T25/courses'],'R-089':['T25/courses'],'R-109':['T25/presentations'],'R-110':['T25/presentations','T25/presentation-composition'],'R-121':['T25/governance'],
 'R-093':['T28'],'R-094':['T28','T28/output','T28/puppet'],'R-095':['T28/output'],'R-096':['T28'],'R-097':['T28','T28/answers','T28/webrtc','T28/guest-programme'],'R-098':['T28/answers'],'R-099':['T28/output','T28/speech'],'R-100':['T28/output','T28/guest-programme'],'R-111':['T26','T28'],'R-112':['T26','T28'],'R-123':['T26','T28'],'R-125':['T26','T28'],'R-128':['T26','T28/webrtc','T28/guest-programme']
};
const rows=criteria.requirements.map(c=>{
 const currentTests=[...c.currentTests,...(['R-100','R-121'].includes(c.id)?['tests/integration/live-to-publishing.test.ts']:[])];const tests=currentTests.map(f=>{assert.ok(currentCases.has(f),f);return currentCases.get(f);});
 const originalSamples=c.legacyGroups.map(name=>{const g=legacy.find(g=>g.name===name);assert.ok(g,name);return g;});
 const history=historyByRequirement[c.id].map(p=>{const f='docs/evidence/'+p+'/verification.json',m=manifestReviews.find(m=>m.file===f);assert.ok(m,f);return{file:f,sha256:m.sha256,result:m.result};});
 return{...c,verdict:'SATISFIED_G1_TASK_LOCAL_SCOPE',currentTests:tests,originalSamples,historicalImplementationEvidence:history,fullRequirementCompleted:false,realQualityOrExternalConditionsCompleted:false};
});
const denoise=read('docs/evidence/T24/denoising/verification.json'),writing=read('docs/evidence/T24/content-writing/verification.json');
assert.equal(denoise.quality.result,'FAIL_FINITE_SYNTHETIC_MATRIX');assert.equal(denoise.quality.matched,5);assert.equal(denoise.quality.total,6);assert.equal(writing.quality.unresolvedSemanticQualityFailures,true);assert.equal(writing.quality.generalFactualQualityVerified,false);
const tasks=criteria.taskIds.map(id=>{const t=b.tasks.find(t=>t.id===id);const rc=rows.filter(r=>r.taskId===id);assert.deepEqual(rc.map(r=>r.id).sort(),[...t.requirementIds].sort());assert.equal(t.deliverable,criteria.taskDeliverables.find(v=>v.id===id).deliverable);assert.ok(t.dependsOn.every(id=>b.tasks.find(t=>t.id===id).status==='verified'));return{id,verdict:'G1_LOCAL_TASK_EXIT_SATISFIED',acceptanceIds:t.acceptanceIds,requirementIds:t.requirementIds,realCapabilitiesRemainUnverified:true};});
assert.equal(b.tasks.find(t=>t.id==='T30').status,'pending');assert.equal(b.tasks.find(t=>t.id==='T16').status,'pending');
fs.writeFileSync(output,JSON.stringify({result:'PASS_G1_LOCAL_TASK_EXIT_AUDIT',checkedAt:new Date().toISOString(),criteriaFile:root+'/criteria.json',criteriaSHA256:hash(root+'/criteria.json'),priorManifest:start.previousManifest,priorSourcesUnchangedAtStart:start.previousSourceFilesChecked,backend:{passed:201,files:22,reports:commands,fullSuiteRerun:false},legacy:{groups:20,originalFailurePreserved:root+'/runtime/legacy/runners.json',resumedReport:root+'/runtime/legacy-resumed/runners.json',checks:legacy},tasks,requirements:rows,acceptanceCases:criteria.acceptanceCases,historicalManifestReviews:manifestReviews,historicalBrowserReports:[...reports.values()],historicalBrowserChecksNotRerunThisIncrement:true,quality:{denoising:denoise.quality,scriptGeneration:writing.quality,allOriginalFailuresRetained:true,noThresholdsOrScopeWeakened:true},taskLocalExitIsNotFullRequirementVerification:true,sharedRequirementsKeptInProgress:['R-111','R-112','R-123','R-125'],wholeG1Completed:false,wholeG2Completed:false,wholePlatformCompleted:false,stillMissingG1Tasks:['T30','T16'],newSqlRequired:false,physicalDevicesOrRealBusinessActionsExecuted:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PASS_G1_LOCAL_TASK_EXIT_AUDIT',backend:201,files:22,legacyGroups:20,requirements:32,acceptanceCases:18,tasks:3,historicalManifests:manifestReviews.length,historicalBrowserReports:reports.size,wholeG1Completed:false}));
