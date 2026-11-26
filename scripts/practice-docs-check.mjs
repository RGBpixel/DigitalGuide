import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T30/practice',read=f=>JSON.parse(fs.readFileSync(f,'utf8')),b=read('docs/backlog.json'),c=read(root+'/criteria.json'),t=b.tasks.find(t=>t.id==='T30');
assert.equal(t.status,'verified');assert.equal(t.verificationScope,'G1_local_task');
assert.deepEqual(c.task,{id:t.id,deliverable:t.deliverable,requirementIds:t.requirementIds,acceptanceIds:t.acceptanceIds,dependsOn:t.dependsOn});
assert.deepEqual(fs.readFileSync('docs/04-roadmap-acceptance.md','utf8').split('\n').filter(l=>/^\| AC-(42|54) \|/.test(l)),c.acceptance);
assert.deepEqual([b.requirements.length,b.tasks.length,b.expectedCounts.acceptanceCases,b.capabilityGroups.length],[134,38,65,26]);assert.equal(b.tasks.filter(t=>t.status==='verified').length,26);assert.equal(b.tasks.find(t=>t.id==='T16').status,'pending');assert.equal(b.tasks.find(t=>t.id==='T21').status,'pending');
for(const id of ['R-088','R-125']){const r=b.requirements.find(r=>r.id===id);assert.equal(r.localStatus,'verified');assert.equal(r.status,'in_progress');assert.ok(r.evidence.includes('docs/57-role-practice.md'));}
assert.equal(b.requirements.find(r=>r.id==='R-088').liveStatus,'planned');
for(const id of ['R-111','R-112','R-123'])assert.equal(b.requirements.find(r=>r.id===id).localStatus,'in_progress');
for(const f of ['README.md','PLAN.md']){const text=fs.readFileSync(f,'utf8');assert.ok(text.includes('主48214/schema052'),f);assert.ok(text.includes('26项'),f);assert.ok(text.includes('T16'),f);}
assert.ok(fs.readFileSync('DigitalGuide-平台建设总文档.md','utf8').includes('# 角色练习与调研访谈'));
const result={result:'PASS',checkedAt:new Date().toISOString(),counts:{requirements:134,tasks:38,acceptance:65,capabilityGroups:26},verifiedLocalTasks:26,unchangedT30DeliverableDependenciesAndAcceptance:true,unrelatedSharedRequirementStatusesUnchanged:true,wholeG1Completed:false,wholeG2Completed:false,goalComplete:false};console.log(JSON.stringify(result));
