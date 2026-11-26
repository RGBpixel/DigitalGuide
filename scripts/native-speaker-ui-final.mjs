import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const root='docs/evidence/T20/postgres-speaker-focus';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>['node_modules','.git'].includes(e.name)?[]:e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
const oldFile=root+'/handoff-phase-verification.json',old=read(oldFile),progressFile=root+'/ui-progress-read-only-audit.json',progress=read(progressFile),start=read(root+'/ui-continue-start.json'),status=read(root+'/ui-local-status.json');
assert.equal(hash(progressFile),start.previousAuditSHA256);assert.equal(status.result,'PASS_LOCAL_MOCK_CONTROL_UI');assert.equal(status.gui.distinctFlowCount,22);assert.equal(status.backend.distinctPassingAssertions,138);assert.equal(status.goalStatus,'active');
const historical=new Map();
function retain(file,sha){assert.equal(hash(file),sha,file);if(historical.has(file))assert.equal(historical.get(file),sha);historical.set(file,sha);}
for(const map of [old.referencedHistoricalEvidenceSHA256,old.evidenceSHA256,old.retained076CompiledSHA256,old.retained077CompiledSHA256,old.retained078CompiledSHA256,old.retainedInitial081CompiledSHA256,old.oldStates])for(const[file,sha]of Object.entries(map))retain(file,sha);
for(const[file,sha]of Object.entries(old.sourceSHA256))retain(old.sourceSnapshots[file],sha);
for(const[file,sha]of Object.entries(old.compiledSHA256))retain(path.join(old.compiled.compiledRoot,file),sha);
for(const[file,sha]of Object.entries(progress.sourceSHA256))retain(progress.sourceSnapshots[file],sha);
retain(oldFile,hash(oldFile));retain(progressFile,hash(progressFile));
for(const[file,sha]of Object.entries(status.evidenceSHA256))retain(file,sha);

const qualityLabels=['ui-completed-type','ui-completed-lint','ui-audio-state-build','ui-completed-docs-build','ui-completed-docs-check','ui-completed-api-spec'];
for(const label of qualityLabels)assert.equal(read(root+'/'+label+'-command.json').result,'PASS');
const main=read(root+'/runtime/preservation-ui-complete.json'),operating=read(root+'/runtime/operating-ui-complete.json'),closure=read(root+'/runtime/ui-complete-pg-closure.json');
for(const r of [main,operating,closure])assert.equal(r.result,'PASS');
const currentProof=read(root+'/ui-audio-state-current/proof.json');assert.equal(currentProof.result,'PASS');assert.equal(currentProof.allDirectChildrenClosed,true);
const compiledSHA256=Object.fromEntries(walk('dist').map(file=>[file,hash(file)])),uiBundles={};
for(const name of fs.readdirSync(currentProof.root).filter(name=>name==='compiled-only-root'||name.startsWith('compiled-only-root-ui-'))){const dir=path.join(currentProof.root,name);if(!fs.statSync(dir).isDirectory())continue;const files=walk(path.join(dir,'dist'));assert.equal(files.length,76);assert.equal(fs.existsSync(path.join(dir,'packages')),false);uiBundles[dir]=Object.fromEntries(files.map(file=>[file,hash(file)]));for(const[file,sha]of Object.entries(uiBundles[dir]))retain(file,sha);}
assert.equal(Object.keys(uiBundles).length,6);
for(const[file,sha]of Object.entries(compiledSHA256))assert.equal(hash(path.join(currentProof.compiledOnlyRoot,file)),sha,file);
const evidenceSHA256={};
for(const file of walk(root).filter(file=>{const rel=file.slice(root.length+1);return !rel.startsWith('sources/')&&(rel.startsWith('ui-')||/^runtime\/(?:preservation-ui-complete|operating-ui-complete|ui-complete-pg-closure|owned-ui-complete)/.test(rel));})){
 const bytes=fs.readFileSync(file);evidenceSHA256[file]=hash(file);
 if(/\.(json|log)$/.test(file))assert.equal(/(?:RG1|HT1|SF1)\.[a-z0-9-]{36}\.[A-Za-z0-9_-]{30,}/i.test(bytes.toString('utf8')),false,'Credential-shaped capability in public evidence: '+file);
 if(file.endsWith('-command.json'))for(const binding of read(file).bindings??[])retain(binding.bound,binding.sha256);
}
const registry=read('migrations/postgres/runtime.json');assert.equal(registry.version,78);assert.equal(registry.migrations.at(-1).name,'081-native-speaker-handoff-preparation-quota.sql');
for(const migration of registry.migrations){const file='migrations/postgres/'+migration.name;assert.equal(hash(file),old.sourceSHA256[file]);}
const b=read('docs/backlog.json'),before=read(root+'/ui-continue-backlog.json.before');for(const field of ['tasks','requirements'])assert.deepEqual(b[field].map(t=>[t.id,t.status,t.localStatus,t.liveStatus]),before[field].map(t=>[t.id,t.status,t.localStatus,t.liveStatus]));
assert.equal(b.requirements.length,134);assert.equal(b.tasks.length,38);assert.equal(b.tasks.filter(t=>t.status==='verified').length,27);assert.match(fs.readFileSync('packages/postgres/src/native-speaker-ui-state.ts','utf8'),/nativeSpeakerUiVerified\s*:\s*boolean\s*=\s*true/);
const sourceFiles=[...['apps','packages','tests','migrations','scripts'].flatMap(walk).filter(file=>/\.(tsx?|mjs|ps1|sql|json)$/.test(file)),...walk('docs').filter(file=>!file.includes('/evidence/')&&/\.(md|json)$/.test(file)),...fs.readdirSync('.').filter(file=>file.endsWith('.md')&&fs.statSync(file).isFile()),'.env.example','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json'],sourceSHA256={},sourceSnapshots={};
for(const file of new Set(sourceFiles.filter(file=>fs.existsSync(file)))){const sha=hash(file),bound=root+'/sources/'+sha+'/'+path.basename(file);fs.mkdirSync(path.dirname(bound),{recursive:true});if(!fs.existsSync(bound))fs.copyFileSync(file,bound,fs.constants.COPYFILE_EXCL);assert.equal(hash(bound),sha);sourceSHA256[file]=sha;sourceSnapshots[file]=bound;}
const result={result:'PASS',createdAt:new Date().toISOString(),thisGoalTurnClassification:'progress',task:'T20',taskStatus:'in_progress',relatedTasks:['T37','T38'],relatedRequirements:['R-058','R-129','R-130','R-131','R-132','R-133','R-134'],requirements:134,tasks:38,acceptanceCases:65,capabilityGroups:26,totalLocallyVerifiedTasks:27,nativeRuntime:{through:registry.migrations.at(-1).name,version:78,next:'082',sqlite:'052-practice.sql',nextSqlite:'053'},backend:status.backend,gui:status.gui,compiled:{compiledRoot:currentProof.compiledOnlyRoot,samePrivateRoot:currentProof.root,currentFiles:76,currentProof:root+'/ui-audio-state-current/proof.json',uiBundlesRetained:6,allUiBundles:uiBundles,currentChecks:currentProof.checks,passedGuiRuns:6,oldSuccessfulFaultsRetained:5,successfulFaultsRepeated:0},main,operating,closure,quality:{labels:qualityLabels,sourceSnapshots:Object.keys(sourceSnapshots).length,publicCapabilityScan:'PASS'},scope:{nativeSpeakerFocusFeatureAdvertised:true,fullLocalMockGuiCompleted:true,realAcousticRecognitionVerified:false,realExternalBusinessActions:false},failuresRetained:['Initial quality/textarea locator interruptions and duplicate React keys','Reference withdrawal reason mapping, fixed in separate frontend bundle','Premature delayed-response observation, subsequently synchronized','Immediate text send after fallback with stale version, fixed with pending-state coordination','Related first run 103 passed/1 unconfigured audio-hint failure; final 34+1 checks passed'],sourceSHA256,sourceSnapshots,compiledSHA256,retained076CompiledSHA256:old.retained076CompiledSHA256,retained077CompiledSHA256:old.retained077CompiledSHA256,retained078CompiledSHA256:old.retained078CompiledSHA256,retainedInitial081CompiledSHA256:old.retainedInitial081CompiledSHA256,evidenceSHA256,referencedHistoricalEvidenceSHA256:Object.fromEntries(historical),previousManifest:oldFile,previousManifestSHA256:hash(oldFile),previousProgressAudit:progressFile,previousProgressAuditSHA256:hash(progressFile),models:old.models,postgresRuntime:old.postgresRuntime,oldStates:old.oldStates,remainingFullPlatform:old.remainingFullPlatform,nextIndependentWork:'Native restricted visual questions and reception business actions; then remaining full platform migration and real integrations.',wholeIncrement101Completed:false,wholeT20Completed:false,wholeG2Completed:false,wholePlatformCompleted:false,goalStatus:'active',goalComplete:false,realExternalBusinessActions:false};
fs.writeFileSync(root+'/ui-phase-verification.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'PASS',backend:138,gui:22,compiledFiles:76,retainedUiBundles:6,historicalFiles:historical.size,nativeUiEnabled:true,realRecognition:false,goal:'active'}));
