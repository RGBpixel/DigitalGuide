import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-restaurant-session';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const previous='docs/evidence/T20/postgres-restaurant/catalog-progress-status.json';
assert.equal(hash(previous),'c952bea9646d27944ebaa42aaef8405128a6c23bcaaeb9f6ab6333b54eddf57e');
const status=read(previous),auditFile='docs/evidence/T20/postgres-restaurant/catalog-progress-read-only-audit.json',audit=read(auditFile);
assert.equal(audit.result,'PASS');
for(const[file,sha]of Object.entries(status.sourceSHA256)){assert.equal(hash(file),sha,file);assert.equal(hash(status.sourceSnapshots[file]),sha,file+' historical snapshot');}
for(const[file,sha]of Object.entries(status.compiledSHA256))assert.equal(hash(file),sha,file);
for(const item of status.nativeRuntime.frozen)assert.equal(hash('migrations/postgres/'+item.migration),item.migrationSHA256);
const backlog=read('docs/backlog.json');assert.equal(backlog.tasks.filter(t=>t.status==='verified').length,27);assert.equal(backlog.tasks.find(t=>t.id==='T20').status,'in_progress');
fs.mkdirSync(root,{recursive:true});
for(const file of ['PLAN.md','docs/backlog.json'])fs.writeFileSync(path.join(root,path.basename(file)+'.before'),fs.readFileSync(file),{flag:'wx'});
const report={result:'PASS_START_REVALIDATED',checkedAt:new Date().toISOString(),previousGoalTurnClassification:'no_progress_status_only',previousManifest:previous,previousManifestSHA256:hash(previous),previousAudit:auditFile,previousAuditSHA256:hash(auditFile),currentSourcesVerified:Object.keys(status.sourceSHA256).length,currentCompiledVerified:Object.keys(status.compiledSHA256).length,sourceSHA256:status.sourceSHA256,originalNativeMigration:'086',originalRuntimeVersion:83,nextMigration:'087',mainWorkbenchRestarted:false,privateHistoricalInstancesReactivated:false,successfulFaultProducersRepeated:false,wholeScopePreserved:true,goalStatus:'active',nextWork:['scoped restaurant terminals and anonymous guest sessions','fixed restaurant sources, current scoped duties and irrevocable opener epochs','guest lifecycle and next-person credential revocation','reservation, queue and atomic seating, then preferences, orders, kitchen and checkout']};
fs.writeFileSync(root+'/phase-start.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:report.result,sources:report.currentSourcesVerified,compiled:report.currentCompiledVerified,previousGoalTurn:report.previousGoalTurnClassification}));
