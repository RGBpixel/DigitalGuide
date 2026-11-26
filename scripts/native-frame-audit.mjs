import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const root='docs/evidence/T20/postgres-frame-reviews',preflight=process.argv.includes('--preflight');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(d+'/'+e.name):e.isFile()?[d+'/'+e.name]:[]);
const save=(file,value)=>fs.writeFileSync(root+'/'+file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const start=read(root+'/start.json'),old=read(start.previousManifest);
assert.equal(hash(start.previousManifest),start.previousManifestSHA256);
assert.equal(start.previousManifestSHA256,'a6a8d3a3b314c3c74da965c0feca81f844ac8cfc3afb74c02cc576b7c30c15a7');
const oldAudit=read(start.previousManifest.replace('verification.json','final-audit.json'));
assert.equal(oldAudit.result,'PASS');assert.equal(oldAudit.verificationSHA256,start.previousManifestSHA256);
for(const map of [old.evidenceSHA256,old.referencedHistoricalEvidenceSHA256,start.earlierFinalManifestSHA256,start.oldStates])for(const[file,sha256]of Object.entries(map))assert.equal(hash(file),sha256,file);
for(const[file,sha256]of Object.entries(oldAudit.additionalAuditSourceSHA256??{}))assert.equal(hash(file),sha256,file);

const allowed=new Set(['README.md','PLAN.md','DigitalGuide-平台建设总文档.md','docs/02-architecture.md','docs/03-data-api.md','docs/06-decisions-and-dependencies.md','docs/23-content-workbench.md','docs/58-local-user-guide.md','docs/backlog.json','apps/api/src/postgres-core-app.ts','apps/worker/src/postgres-core.ts','packages/postgres/src/runtime-bootstrap.ts','packages/postgres/src/runtime-database.ts','migrations/postgres/runtime.json','tests/unit/postgres-runtime.test.ts','scripts/build.mjs','scripts/build-docs.mjs']);
const changed=[];for(const[file,sha256]of Object.entries(old.sourceSHA256))if(hash(file)!==sha256){assert.ok(allowed.has(file),'Unexpected previous source modification: '+file);changed.push(file);}
for(const file of ['package.json','pnpm-lock.yaml'])assert.equal(hash(file),old.sourceSHA256[file]);
const b=read('docs/backlog.json'),before=read(root+'/backlog-before.json');
assert.deepEqual([b.requirements.length,b.tasks.length,b.tasks.filter(t=>t.status==='verified').length],[134,38,27]);
for(const key of ['expectedCounts','fullScopePreservation','capabilityGroups','verificationItems','gates'])assert.deepEqual(b[key],before[key]);
for(const table of ['tasks','requirements'])for(const row of b[table]){
 const prior=before[table].find(v=>v.id===row.id);assert.ok(prior);
 for(const key of table==='tasks'?['title','milestone','dependsOn','requirementIds','acceptanceIds','deliverable','externalDependencies','status']:['title','module','priority','origin','milestones','sourceIds','acceptanceIds','localStatus','status','liveStatus'])assert.deepEqual(row[key],prior[key],row.id+' '+key);
 for(const v of prior.evidence??[])assert.ok(row.evidence.includes(v));
}
assert.equal(b.tasks.find(t=>t.id==='T20').status,'in_progress');
for(const id of ['T20','T25'])assert.ok(b.tasks.find(t=>t.id===id).evidence.includes('docs/82-postgres-frame-reviews.md'));
for(const id of ['R-058','R-083','R-021','R-022'])assert.ok(b.requirements.find(t=>t.id===id).evidence.includes('docs/82-postgres-frame-reviews.md'));
const runtime=read('migrations/postgres/runtime.json'),migrations=[...read('migrations/postgres/baseline.json').postgresMigrations,...runtime.migrations],applied=read(root+'/first-applied-035.json');
assert.equal(runtime.version,32);assert.deepEqual(migrations.slice(0,-1),old.nativeRuntime.migrations);
assert.equal(migrations.at(-1).name,'035-native-frame-reviews.sql');assert.equal(migrations.length,35);
for(const m of migrations)assert.equal(hash('migrations/postgres/'+m.name),m.sha256);
assert.equal(hash(applied.file),applied.sha256);assert.equal(applied.sha256,'60f37d846b9ae999d9ae4bb150ce735c573c90e5bdffa716eedffe3a5a8713bf');
assert.equal(applied.appliedSqlFrozen,true);assert.equal(applied.runtimeVersion,32);assert.equal(applied.nextPostgresMigration,'036');
const init=read(root+'/init-init-first.json');assert.deepEqual([init.result,init.migrationsCommitted,init.apiAndWorkerCatalogVerified,init.privateFixtureClosed],['PASS',true,true,true]);
assert.equal(fs.readdirSync('migrations/sqlite').filter(n=>n.endsWith('.sql')).sort().at(-1),'052-practice.sql');

const implementation=['packages/postgres/src/runtime-frame-review-shapes.ts','packages/postgres/src/runtime-frame-reviews.ts','packages/postgres/src/runtime-frame-discussions.ts','packages/postgres/src/runtime-frame-review-worker.ts','packages/media/src/run-owned-frame-review.ts','packages/media/src/frame-review-native-worker.ts','apps/api/src/postgres-frame-review-routes.ts','apps/api/src/postgres-core-app.ts','apps/worker/src/postgres-core.ts','packages/postgres/src/runtime-bootstrap.ts','packages/postgres/src/runtime-database.ts','scripts/build.mjs','migrations/postgres/035-native-frame-reviews.sql','migrations/postgres/runtime.json'];
function command(label,checkImplementation=true){const c=read(root+'/'+label+'-command.json');for(const binding of c.bindings){assert.equal(hash(binding.bound),binding.sha256);assert.equal(c.sourceSHA256[binding.file],binding.sha256);}if(checkImplementation)for(const file of implementation)assert.equal(hash(file),c.sourceSHA256[file],label+' '+file);return c;}
const backend=read(root+'/backend-summary.json'),cases=new Set(),testFiles=new Set(),newCases=new Set();let executions=0;
for(const run of backend.runs){
 const report=read(root+'/'+run.label+'.json'),c=command(run.label);assert.equal(report.success,true);assert.equal(c.exitCode,0);assert.deepEqual(run.bindings,c.bindings);
 for(const test of report.testResults)for(const a of test.assertionResults){
  if(a.status==='skipped'){assert.ok(['expiry-final','authority-final'].includes(run.label));continue;}
  assert.equal(a.status,'passed');const id=test.name+'|'+a.fullName;cases.add(id);testFiles.add(test.name);executions++;
  if(test.name.replaceAll('\\','/').endsWith('/postgres-frame-reviews.test.ts'))newCases.add(id);
 }
}
assert.deepEqual([cases.size,testFiles.size,executions,newCases.size],[174,6,174,38]);
assert.deepEqual([backend.distinctPassed,backend.files,backend.passingExecutions,backend.newFeatureCases],[174,6,174,38]);
assert.deepEqual(backend.runs.map(r=>r.passed),[61,1,1,111]);assert.deepEqual(backend.runs.map(r=>r.skipped),[0,36,37,0]);
assert.equal(read(root+'/native-first.json').numPassedTests,35);assert.equal(command('typecheck-first',false).exitCode,2);
assert.equal(command('typecheck-final',false).exitCode,2);assert.equal(command('lint-final',false).exitCode,1);
for(const label of ['typecheck-closed','lint-closed','build-final','docs-build-closed','docs-check-closed','api-spec-final'])assert.equal(command(label).exitCode,0,label);
for(const label of ['docs-build-closed','docs-check-closed'])assert.equal(command(label).sourceSHA256['docs/82-postgres-frame-reviews.md'],hash('docs/82-postgres-frame-reviews.md'));
const oldResume=command('compiled-resumed').bindings.find(v=>v.file==='scripts/native-frame-resume.ts');assert.ok(oldResume);
assert.equal(fs.readFileSync(oldResume.bound,'utf8').replace('FrameReview,FrameComment,ExternalFrameContext','FrameReview,FrameComment'),fs.readFileSync('scripts/native-frame-resume.ts','utf8'));
for(const label of ['typecheck-closed','lint-closed'])assert.equal(command(label).sourceSHA256['scripts/native-frame-resume.ts'],hash('scripts/native-frame-resume.ts'));

const compiled=read(root+'/compiled-summary.json'),checks=new Set(),owned=new Set(),chrome=new Set(),browserChecks=new Set();let direct=0,checkExecutions=0;
const distFiles=walk('dist');assert.equal(distFiles.length,75);let privateCompiledRoot;
for(const attempt of compiled.attempts){
 const folder=root+'/'+attempt.label,p=read(folder+'/proof.json'),c=command(attempt.label);
 assert.equal(c.exitCode,p.result==='PASS'?0:1);assert.equal(p.result,attempt.result);assert.equal(p.allDirectChildrenClosed,true);
 for(const item of p.cleanup)assert.equal(item.result,'PASS');
 if(privateCompiledRoot)assert.equal(privateCompiledRoot,p.compiledOnlyRoot);else privateCompiledRoot=p.compiledOnlyRoot;
 for(const[file,sha256]of Object.entries(p.entrySHA256)){assert.equal(hash(file),sha256);assert.equal(hash(path.join(p.compiledOnlyRoot,file)),sha256);}
 for(const file of distFiles)assert.equal(hash(path.join(p.compiledOnlyRoot,file)),hash(file),file);
 for(const v of p.checks){assert.equal(v.result,'PASS');checks.add(v.name);checkExecutions++;}direct+=p.children.length;
 for(const file of fs.readdirSync(folder).filter(n=>/^observed-.*\.json$/.test(n)&&!n.endsWith('-roots.json'))){const v=read(folder+'/'+file);if(v.processes)for(const p of v.processes)owned.add(p.pid+':'+p.created);}
 if(fs.existsSync(folder+'/browser/browser.json')){
  const browser=read(folder+'/browser/browser.json');assert.equal(browser.result,'PASS');assert.equal(browser.browserClosed,true);
  assert.deepEqual([browser.apiErrors.length,browser.errors.length,browser.physicalDeviceCalls],[0,0,0]);assert.ok(browser.expectedRevocations.length);
  const cleanup=read(folder+'/browser/browser-cleanup.json');assert.equal(cleanup.result,'PASS');assert.deepEqual(cleanup.alive,[]);
  for(const name of browser.checks)browserChecks.add(name);
  for(const p of read(folder+'/browser/observed-browser-processes.json').processes)chrome.add(p.pid+':'+p.created);
 }
}
assert.deepEqual(compiled.attempts.map(v=>[v.result,v.checks]),[['FAIL',17],['PASS',5]]);
assert.deepEqual([checks.size,checkExecutions,direct,owned.size,chrome.size,browserChecks.size],[22,22,60,57,30,9]);
assert.deepEqual([compiled.distinctChecks,compiled.totalPassedCheckExecutions,compiled.directChildren,compiled.observedProcesses,compiled.browserProcesses,compiled.browserChecks],[22,22,60,57,30,9]);
for(const label of ['frame-create','invitation-create','external-join','member-comment','member-resolve','external-comment','external-feedback','invitation-revoke']){
 const v=read(root+'/compiled-first/'+label+'-precommit.json');
 assert.deepEqual([v.result,v.actualApiSigkill,v.actualAuditBarrierReached,v.sameIdempotencyKeyRecovery,v.clockOrLeaseEdited],['PASS',true,true,true,false]);assert.deepEqual(v.before,v.afterCrash);
}
const worker=read(root+'/compiled-first/proxy-complete-precommit.json'),recovery=read(root+'/compiled-first/original-lease-recovery.json'),expiry=read(root+'/compiled-first/natural-invitation-expiry.json');
assert.deepEqual([worker.result,worker.actualWorkerSigkill,worker.clockOrLeaseEdited],['PASS',true,false]);
assert.equal(worker.stage.receipt.execution.entrySHA256,hash('dist/frame-review.mjs'));
assert.equal(worker.stage.phase,'native_frame_complete_staged');assert.equal(worker.stage.attempts,1);
assert.deepEqual([recovery.result,recovery.recoveredAttempts,recovery.receiptCount,recovery.clockOrLeaseEdited],['PASS',2,1,false]);
assert.equal(recovery.reviewId,worker.stage.reviewId);assert.equal(recovery.originalLeaseUntil,worker.stage.leaseUntil);
assert.deepEqual([expiry.result,expiry.oldSignedCookieDenied,expiry.clockEdited],['PASS',true,false]);assert.ok(expiry.checkedAt>=expiry.originalExpiresAt);
const continued=read(root+'/compiled-resumed/continued-instance.json');
assert.deepEqual([continued.result,continued.sameOriginalPrivateRoot,continued.sameCompiledPrograms,continued.originalEightApiKillsAndOneWorkerKillReused,continued.original45secondLeaseAnd65secondExpiryReused,continued.newLeaseOrClockEditing],['PASS',true,true,true,true,false]);
const killed=read(root+'/compiled-resumed/actual-owned-render-kill.json');
assert.deepEqual([killed.result,killed.standaloneSyntheticOwnershipProbe,killed.actualFfmpegObserved,killed.allObservedProcessesClosed,killed.noCompletedReceipt],['PASS',true,true,true,true]);
const tree=read(root+'/compiled-resumed/observed-live-ffmpeg-proxy.json'),treeCleanup=read(root+'/compiled-resumed/live-proxy-tree-cleanup.json');assert.ok(tree.processes.some(p=>p.name==='ffmpeg.exe'));assert.equal(treeCleanup.result,'PASS');assert.deepEqual(treeCleanup.alive,[]);
const scan=read(root+'/compiled-resumed/secret-scan.json');assert.deepEqual([scan.result,scan.files,scan.scannedPrivateValues,scan.credentialValuesArchived],['PASS',33,18,false]);

const inventory=read(root+'/compiled-diffs/inventory.json');assert.equal(inventory.result,'PASS');
assert.deepEqual(inventory.changed.map(v=>v.file).sort(),['dist/api.mjs','dist/postgres-runtime.mjs','dist/worker.mjs']);
assert.equal(inventory.unchanged.length,71);assert.equal(inventory.unchangedFrontend,50);
assert.deepEqual(inventory.added,[{file:'dist/frame-review.mjs',sha256:hash('dist/frame-review.mjs')}]);
for(const v of inventory.changed){assert.equal(hash(v.file),v.currentSHA256);assert.equal(hash(v.diff),v.diffSHA256);assert.equal(old.compiledSHA256[v.file],v.previousSHA256);}
for(const file of inventory.unchanged)assert.equal(hash(file),old.compiledSHA256[file]);
const media=read(root+'/media-integrity.json'),visual=read(root+'/visual-review.json');assert.equal(media.result,'PASS');assert.equal(media.proxies.length,2);
for(const v of media.proxies){assert.equal(hash(v.file),v.sha256);assert.deepEqual([v.width,v.height,v.frames,v.fps,v.frame.zeroBasedFrame,v.frame.timeMs],[1920,1080,24,24,12,500]);assert.equal(hash(v.frame.file),v.frame.sha256);assert.equal(hash(v.audio.pcmFile),v.audio.sha256);assert.ok(v.audio.rms>500);assert.equal(v.audio.syntheticTone,true);}
assert.equal(hash(media.alphaOriginal.file),media.alphaOriginal.sha256);assert.equal(hash(media.alphaOriginal.frameFile),media.alphaOriginal.frameSHA256);
assert.deepEqual([media.alphaOriginal.width,media.alphaOriginal.height,media.alphaOriginal.frames,media.alphaOriginal.partialAlphaPixels],[3840,2160,24,587618]);assert.ok(media.alphaOriginal.transparentPixels>10000);
assert.equal(visual.result,'PASS');assert.equal(visual.files.length,3);for(const v of visual.files){assert.equal(v.result,'PASS');assert.equal(hash(v.file),v.sha256);}

const backup=read(root+'/runtime/backup-before.json'),baseline=read(root+'/runtime/before.json'),preserved=read(root+'/runtime/preservation-final.json');
assert.equal(hash(backup.file),backup.sha256);for(const k of backup.keys)assert.ok(fs.readFileSync(path.join('storage',k.name)).equals(fs.readFileSync(k.privateBackupPath)));
for(const[file,sha256]of Object.entries(backup.compiled))assert.equal(hash(path.join(path.dirname(backup.file),'dist-before',file.slice(5))),sha256);
assert.deepEqual([preserved.originalTables,preserved.originalRows,preserved.originalBusinessRows,preserved.missingOrChangedOriginalBusinessRows,preserved.originalBaselineReplaced],[301,3318,3310,0,false]);
const db=new DatabaseSync('storage/digitalguide.sqlite',{readOnly:true});let expired=0;
try{
 for(const table of baseline.tables){
  const rows=db.prepare('SELECT '+table.columns.map(c=>'"'+c+'"').join(',')+' FROM "'+table.name+'"').all(),counts=new Map();
  for(const row of rows){const h=createHash('sha256').update(JSON.stringify(row)).digest('hex');counts.set(h,(counts.get(h)??0)+1);}
  for(const h of table.hashes){const n=counts.get(h)??0;if(n)counts.set(h,n-1);else{assert.equal(table.name,'auth_sessions');assert.ok(baseline.authSessionExpiry.find(v=>v.rowHash===h)?.expiresAt<=new Date().toISOString());expired++;}}
 }
 assert.equal(expired,preserved.removedObservedExpiredAuthenticationRows);assert.equal(expired,0);
 assert.equal(db.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').get().name,'052-practice.sql');
}finally{db.close();}
const streamed=async file=>{const h=createHash('sha256');let bytes=0;for await(const b of fs.createReadStream(file)){h.update(b);bytes+=b.length;}return{sha256:h.digest('hex'),bytes};};
assert.equal(start.models.length,63);for(const model of start.models){const v=await streamed(model.file);assert.equal(v.sha256,model.sha256,model.file);assert.equal(v.bytes,model.bytes);}
const pg=start.postgresRuntime,map=read(pg.fileMap);assert.equal(hash(pg.fileMap),pg.fileMapSHA256);assert.equal(map.files.length,1594);
for(const v of map.files){const file=path.join(pg.root,v.file);assert.equal(hash(file),v.sha256);assert.equal(fs.statSync(file).size,v.bytes);}assert.equal((await streamed(pg.archive)).sha256,pg.archiveSHA256);
for(const file of ['runtime/operating-current.json','runtime/operating-final.json','runtime/final-pg-closure.json'])assert.equal(read(root+'/'+file).result,'PASS');
const closure=read(root+'/runtime/final-pg-closure.json');assert.equal(closure.privateClusters.length,9);assert.deepEqual(closure.ownedProcesses,[]);assert.deepEqual(closure.listeners,[]);
const operating=read(root+'/runtime/operating-final.json');assert.equal(operating.processes.length,4);for(const p of operating.expectedOriginalProcesses){const v=operating.processes.find(v=>v.pid===p.pid);assert.equal(v?.created,p.created);}
assert.equal(read(root+'/goal-state-before-final.json').status,'active');
for(const url of ['http://127.0.0.1:4301/api/v1/readiness','http://127.0.0.1:5174'])assert.equal((await fetch(url)).status,200);
assert.ok(fs.readFileSync('README.md','utf8').split('## 阅读入口')[1].startsWith('\n\n当前交付[T20/R-058、T25/R-083原生逐帧审阅与限时邀请]'));
assert.ok(fs.readFileSync('DigitalGuide-平台建设总文档.md','utf8').includes('PostgreSQL 逐帧审阅、画面批注与限时邀请'));
let rehashed=0,manifest;
if(!preflight){
 manifest=read(root+'/verification.json');assert.equal(manifest.goalStatus,'active');assert.equal(manifest.wholePlatformCompleted,false);assert.equal(manifest.nativeRuntime.manifestVersion,32);
 for(const map of [manifest.sourceSHA256,manifest.compiledSHA256,manifest.evidenceSHA256,manifest.referencedHistoricalEvidenceSHA256,manifest.earlierFinalManifestSHA256])for(const[file,sha256]of Object.entries(map)){assert.equal(hash(file),sha256,file);rehashed++;}
 assert.equal(Object.keys(manifest.compiledSHA256).length,75);
}
const result={result:'PASS',phase:preflight?'preflight_without_final_manifest':'independent_final_manifest_audit',checkedAt:new Date().toISOString(),...(manifest?{verification:root+'/verification.json',verificationSHA256:hash(root+'/verification.json'),rehashedEntries:rehashed,sourceEntries:Object.keys(manifest.sourceSHA256).length,evidenceEntries:Object.keys(manifest.evidenceSHA256).length,compiledEntries:75,earlierFinals:Object.keys(start.earlierFinalManifestSHA256).length}:{}),reviewedPreviousSourceChanges:changed,distinctBackendChecks:174,newFeatureCases:38,compiledDistinctChecks:22,compiledPassingCheckExecutions:22,actualPrecommitApiKills:8,actualPrecommitWorkerKills:1,original45secondLeaseAnd65secondExpiryReused:true,standaloneActualFfmpegOwnershipKillVerified:true,browserChecks:9,directChildrenClosed:60,observedProcessesClosed:57,browserProcessesClosed:30,modelsIndependentlyRehashed:63,postgresRuntimeFilesIndependentlyRehashed:1594,privateClustersClosed:9,mainOriginalRows:3318,mainBusinessRows:3310,removedObservedExpiredAuthenticationRows:expired,mainOriginalProcesses:4,main:'33223',frozenPostgresMigrations:'001-035',runtimeVersion:32,nextPostgresMigration:'036',defaultDatabase:'sqlite',typeOnlyResumeImportRemovalVerified:true,realCloneRealtimeVoiceprintOrG2Accepted:false,wholePlatformCompleted:false,goalStatus:'active'};
save(preflight?'audit-preflight.json':'final-audit.json',result);console.log(JSON.stringify(result));
