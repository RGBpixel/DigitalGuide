import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root='docs/evidence/T20/postgres-dining',mode=process.argv[2];
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const expected={requirements:134,tasks:38,acceptanceCases:65,capabilityGroups:26};
const tests=['dining-business-current','dining-business-session-regression','dining-business-migration-unit'];
const checks=[...tests,'dining-business-types','dining-business-lint','dining-business-build','dining-business-api-spec'];
function pass(label){const file=root+'/'+label+'-command.json',r=read(file);assert.equal(r.result,'PASS',label);assert.equal(r.exitCode,0,label);return{label,file,sha256:sha(file),startedAt:r.startedAt,finishedAt:r.finishedAt};}
function counts(){const b=read('docs/backlog.json');assert.deepEqual(b.expectedCounts,expected);assert.equal(b.tasks.filter(t=>t.status==='verified').length,27);const before=read(root+'/backlog.json.before');for(const key of ['requirements','tasks'])assert.deepEqual(b[key].map(t=>[t.id,t.status,t.localStatus,t.liveStatus]),before[key].map(t=>[t.id,t.status,t.localStatus,t.liveStatus]));return b;}
function frozenMigrations(){
 const m=read('migrations/postgres/runtime.json');assert.equal(m.version,90);assert.equal(m.migrations.at(-1).name,'093-native-dining-operation-variable.sql');
 return ['migration-frozen.json','clock-frozen.json','claim-frozen.json','operation-frozen.json'].map(leaf=>{const file=root+'/'+leaf,r=read(file);assert.equal(sha('migrations/postgres/'+r.migration),r.sha256);assert.equal(m.migrations.find(e=>e.name===r.migration)?.sha256,r.sha256);return{file,sha256:sha(file),migration:r.migration,migrationSHA256:r.sha256,root:r.root,firstKnownCommittedAt:r.firstKnownCommittedAt};});
}
if(mode==='results'){
 counts();const commands=checks.map(pass),assertions=new Set();
 const reports=tests.map(label=>{const file=root+'/'+label+'.json',r=read(file);assert.equal(r.success,true);assert.equal(r.numFailedTests,0);assert.equal(r.numPendingTests,0);for(const result of r.testResults)for(const a of result.assertionResults){assert.equal(a.status,'passed');assertions.add(result.name+'\0'+a.fullName);}return{file,sha256:sha(file),passed:r.numPassedTests};});assert.equal(assertions.size,66);
 const failures=fs.readdirSync(root).filter(f=>f.endsWith('-command.json')).flatMap(leaf=>{const file=root+'/'+leaf,r=read(file);return r.result==='FAIL'?[{file,sha256:sha(file),exitCode:r.exitCode}]:[];});assert.ok(failures.length>=5);
 const start=read(root+'/phase-start.json');assert.equal(sha(start.previousManifest),start.previousManifestSHA256);assert.equal(sha(start.previousAudit),start.previousAuditSHA256);
 const result={result:'PASS_LOCAL_DINING_BACKEND_STAGE_WITH_RETAINED_FAILURES',checkedAt:new Date().toISOString(),previousManifest:start.previousManifest,previousManifestSHA256:start.previousManifestSHA256,previousAudit:start.previousAudit,previousAuditSHA256:start.previousAuditSHA256,commands,reports,distinctPassingAssertions:66,passingTestFiles:3,retainedRawFailures:failures,frozenMigrations:frozenMigrations(),runtimeVersion:90,nextMigration:'094',nativeRestaurantSeatingUiEnabled:false,nativeGuestDiningUiEnabled:false,compiledRuntimeValidated:false,currentPhaseGuiFlows:0,currentPhaseRestartValidation:false,naturalDeadlineWorkerValidation:false,postLockExpiredAuthorityValidation:false,mainRestarted:false,mainCutOver:false,oldSuccessfulFaultProducersRepeated:false,realBusinessOperations:false,scopeCounts:expected,locallyVerifiedTasks:27,taskCountFraction:27/38,taskFractionIsCommercialReadiness:false,goalStatus:'active',goalComplete:false};
 write(root+'/backend-results.json',result);console.log(JSON.stringify({result:result.result,assertions:66,files:3,failuresRetained:failures.length}));
}else if(mode==='docs'){
 const result=read(root+'/backend-results.json');assert.equal(result.result,'PASS_LOCAL_DINING_BACKEND_STAGE_WITH_RETAINED_FAILURES');
 const b=counts(),task=b.tasks.find(t=>t.id==='T20');assert.ok(!task.progressNote.startsWith('2026-11-25 增量105'));
 write(root+'/backlog-before-backend-docs.json',b);
 const note='2026-11-25 增量105原生餐厅后端检查点：预约/改期/签到、现场排队、原30秒固定桌台方案、原子预留/实际入座/释放、店员结束与本人单组私有码恢复已实现。独立选择版本防止换组后旧方案复活；会话结束保留业务事实，凭证转移只限本组、轮换旧访问权并保留原预留时钟。17项业务、18项终端与31项迁移检查，共66个不同断言/3文件分阶段通过，当前类型/lint/构建/OpenAPI通过。原始失败均保留；091修正实际墙钟，092变量限定失败由093无冲突局部变量追加修正，090—093首次提交冻结/runtime90/下一094。完整界面、编译HTTP/worker原期限、等锁后授权过期与API/PG重启验证继续，原生seating/dining界面仍false。主33223不重启切库，134/38/65/26与27项本地verified保持；完整偏好推荐、订单后厨、账单与真实克隆/识别/渠道及全部平台/G2目标继续active。';
 task.progressNote=note+'\n此前104检查点：'+task.progressNote;
 for(const file of ['docs/105-postgres-dining.md',root+'/backend-results.json',...result.commands.map(r=>r.file),...result.reports.map(r=>r.file),...result.frozenMigrations.map(r=>r.file)]){assert.ok(fs.existsSync(file),file);if(!task.evidence.includes(file))task.evidence.push(file);}
 b.updatedAt='2026-11-25';fs.writeFileSync('docs/backlog.json',JSON.stringify(b,null,2)+'\n');
 let build=fs.readFileSync('scripts/build-docs.mjs','utf8');const before="'docs/104-postgres-restaurant-sessions.md', 'docs/04-roadmap-acceptance.md'";assert.equal(build.split(before).length,2);build=build.replace(before,"'docs/104-postgres-restaurant-sessions.md', 'docs/105-postgres-dining.md', 'docs/04-roadmap-acceptance.md'");fs.writeFileSync('scripts/build-docs.mjs',build);
 console.log(JSON.stringify({result:'UPDATED_BACKEND_DOCUMENTATION',countsUnchanged:true,T20:'in_progress'}));
}else if(mode==='final'){
 const result=read(root+'/backend-results.json');assert.equal(result.distinctPassingAssertions,66);counts();frozenMigrations();
 const documentChecks=['dining-backend-docs-build','dining-backend-docs-check'].map(pass),latest=read(documentChecks[1].file),records=new Map();
 const retain=(file,value)=>{if(records.has(file))assert.equal(records.get(file),value,file);records.set(file,value);};
 function historical(v){
  for(const key of ['referencedHistoricalEvidenceSHA256','evidenceSHA256','retained076CompiledSHA256','retained077CompiledSHA256','retained078CompiledSHA256','retainedInitial081CompiledSHA256','oldStates','privateStatesSHA256','privateStateSHA256'])for(const[file,value]of Object.entries(v[key]??{}))retain(file,value);
  for(const[file,value]of Object.entries(v.sourceSHA256??{}))retain(v.sourceSnapshots[file],value);
  for(const[file,value]of Object.entries(v.compiledSHA256??{}))retain(path.join(v.compiled.compiledRoot,file),value);
  for(const[dir,files]of Object.entries(v.compiled.retainedBundles??{}))for(const[file,value]of Object.entries(files))retain(path.join(dir,file),value);
  for(const files of Object.values(v.compiled.allUiBundles??{}))for(const[file,value]of Object.entries(files))retain(file,value);
 }
 assert.equal(sha(result.previousManifest),result.previousManifestSHA256);assert.equal(sha(result.previousAudit),result.previousAuditSHA256);
 const session=read(result.previousManifest),catalog=read(session.previousManifest),vision=read(catalog.previousManifest),speaker=read(vision.previousManifest);
 for(const v of [session,catalog,vision])assert.equal(sha(v.previousManifest),v.previousManifestSHA256);assert.equal(sha(session.previousTerminalManifest),session.previousTerminalManifestSHA256);
 for(const v of [session,read(session.previousTerminalManifest),catalog,vision,speaker])historical(v);
 for(const r of [...result.commands,...result.reports,...result.retainedRawFailures,...result.frozenMigrations,...documentChecks])retain(r.file,r.sha256);
 for(const b of latest.bindings){retain(b.file,b.sha256);retain(b.snapshot,b.sha256);}
 for(const[file,value]of records)assert.equal(sha(file),value,file);
 const streamSha=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
 for(const model of vision.models){assert.equal(fs.statSync(model.file).size,model.bytes);assert.equal(await streamSha(model.file),model.sha256);}
 const pg=vision.postgresRuntime;assert.equal(sha(pg.fileMap),pg.fileMapSHA256);assert.equal(await streamSha(pg.archive),pg.archiveSHA256);const pinned=read(pg.fileMap);for(const entry of pinned.files)assert.equal(await streamSha(path.join(pg.root,entry.file??entry.path)),entry.sha256);
 const preservationFile='docs/evidence/T20/postgres-speaker-focus/runtime/preservation-native-dining-backend.json',preservation=read(preservationFile);assert.equal(preservation.result,'PASS');assert.equal(preservation.originalTables,301);assert.equal(preservation.originalRows,3318);assert.equal(preservation.originalBusinessRows,3310);assert.equal(preservation.missingOrChangedOriginalBusinessRows,0);assert.equal(preservation.bothOriginalKeysExact,true);
 const proofs=Object.keys(session.evidenceSHA256).filter(f=>/\/proof\.json$/.test(f)).map(read),ports=new Set(proofs.flatMap(p=>Object.values(p.ports??{})));
 for(const item of result.frozenMigrations){const closure=read(path.join(item.root,'native-runtime-closure.json'));assert.equal(closure.result,'PASS');ports.add(closure.port);}
 const script="$taskRoot=$env:DG_DINING_AUDIT_ROOT.Replace('\\','/');$taskPorts=@($env:DG_DINING_AUDIT_PORTS|ConvertFrom-Json);$taskIds=@(13424,37428,4392,31996);@{main=@(Get-CimInstance Win32_Process|Where-Object {$taskIds -contains [int]$_.ProcessId}|ForEach-Object {@{pid=[int]$_.ProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o')}});owned=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -in @('postgres.exe','pg_ctl.exe','node.exe','powershell.exe','chrome.exe','ffmpeg.exe','ffprobe.exe','llama-server.exe') -and $_.CommandLine -and $_.CommandLine.Replace('\\','/').IndexOf($taskRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0}|Select-Object ProcessId,Name);listeners=@(Get-NetTCPConnection -State Listen|Where-Object {$taskPorts -contains [int]$_.LocalPort}|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 5 -Compress";
 const observed=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',env:{...process.env,DG_DINING_AUDIT_ROOT:path.resolve('storage/postgres-native-tests'),DG_DINING_AUDIT_PORTS:JSON.stringify([...ports])}}));
 assert.deepEqual(observed.owned,[]);assert.deepEqual(observed.listeners,[]);assert.equal(observed.main.length,4);for(const expected of speaker.operating.expectedOriginalProcesses)assert.equal(observed.main.find(p=>p.pid===expected.pid)?.created,expected.created);
 for(const url of ['http://127.0.0.1:4301/api/v1/readiness','http://127.0.0.1:5174'])assert.equal((await fetch(url)).status,200);
 const documentFiles=['README.md','PLAN.md','docs/105-postgres-dining.md','docs/backlog.json','DigitalGuide-平台建设总文档.md'];
 const checkpoint={...result,result:'PASS_LOCAL_BACKEND_PROGRESS_WITH_RETAINED_FAILURES',checkedAt:new Date().toISOString(),backendResultsFile:root+'/backend-results.json',backendResultsSHA256:sha(root+'/backend-results.json'),documentChecks,documentSHA256:Object.fromEntries(documentFiles.filter(f=>fs.existsSync(f)).map(f=>[f,sha(f)])),sourceSHA256:Object.fromEntries(latest.bindings.map(b=>[b.file,b.sha256])),sourceSnapshots:Object.fromEntries(latest.bindings.map(b=>[b.file,b.snapshot])),evidenceSHA256:Object.fromEntries(records),filesRehashed:records.size,modelsStreamHashed:vision.models.length,postgresFilesStreamHashed:pinned.files.length,oldPrivateStateAndCompiledPreserved:true,oldSpeakerUiBundles:Object.keys(speaker.compiled.allUiBundles).length,oldVisionBundles:Object.keys(vision.compiled.retainedBundles).length,oldCatalogCompiledFiles:Object.keys(catalog.compiledSHA256).length,oldSessionCompiledFiles:Object.keys(session.compiledSHA256).length,preservationFile,preservationSHA256:sha(preservationFile),mainOriginalTables:301,mainOriginalRows:3318,mainOriginalBusinessRows:3310,mainOriginalProcesses:observed.main,ownedPrivateProcesses:0,privateListeners:0};
 write(root+'/backend-progress-status.json',checkpoint);console.log(JSON.stringify({result:checkpoint.result,assertions:66,filesRehashed:records.size,currentSourceSnapshots:latest.bindings.length,models:vision.models.length,postgresFiles:pinned.files.length,mainProcesses:4,ownedPrivateProcesses:0,goal:'active',runtime:90,next:'094'}));
}else throw new Error('Expected results, docs or final mode');
