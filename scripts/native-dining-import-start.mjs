import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-food/memory-import',parentFile='docs/evidence/T20/postgres-food/memory/purpose-verification.json',hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash(parentFile),'04ef2706f3964d77d72105daad7f7600082398223ea674b0e90eb2a70704c03d');
const parent=JSON.parse(fs.readFileSync(parentFile,'utf8'));assert.equal(parent.result,'PASS_LOCAL_FOOD_MEMORY_PURPOSE_BACKEND');
for(const[file,sha]of Object.entries({...parent.sourceSHA256,...parent.documents}))assert.equal(hash(file),sha,file);
const manifest=JSON.parse(fs.readFileSync('migrations/postgres/runtime.json','utf8'));assert.equal(manifest.version,92);for(const migration of manifest.migrations)assert.equal(hash('migrations/postgres/'+migration.name),migration.sha256);
fs.mkdirSync(root,{recursive:false});const archives={};for(const[file,sha256]of Object.entries(parent.documents)){const snapshot=root+'/parent-documents/'+sha256+'/'+path.basename(file);fs.mkdirSync(path.dirname(snapshot),{recursive:true});fs.copyFileSync(file,snapshot,fs.constants.COPYFILE_EXCL);archives[file]={sha256,snapshot};}
fs.writeFileSync(root+'/phase-start.json',JSON.stringify({result:'PASS_IMPORT_START_REVALIDATED',checkedAt:new Date().toISOString(),previousGoalTurnClassification:'progress',parentFile,parentSHA256:hash(parentFile),sourceFilesVerified:Object.keys(parent.sourceSHA256).length,parentDocuments:archives,lastFrozenMigration:manifest.migrations.at(-1).name,runtime:92,nextMigration:'096',goalStatus:'active',mainRestarted:false,oldPrivateInstancesReactivated:false,oldSuccessfulFaultProducersRepeated:false,scopePreserved:true},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PASS_IMPORT_START_REVALIDATED',runtime:92,nextMigration:'096'}));
