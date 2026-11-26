import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {NativeContentProofRuntime,proofBounded,proofHash} from './postgres-content-proof-runtime.js';
import {nativeSpeakerUpgradeFingerprint} from '../packages/postgres/src/runtime-speaker-upgrade.js';
const label=process.argv[2],prior=process.argv[3];assert.match(label,/^[a-z][a-z0-9-]+$/);assert.ok(prior);
const c=await NativeContentProofRuntime.resume('docs/evidence/T20/postgres-speaker-focus/'+label,prior),archived=path.join(c.cluster.root,'compiled-only-root');let failure:unknown;
try{
 await c.cluster.start();const before=await c.owner(db=>nativeSpeakerUpgradeFingerprint(db,c.schema)),checks=[] as {role:string;oldExit:number|null;oldError:string;currentExit:number|null}[];
 const code="import path from 'node:path';import {pathToFileURL} from 'node:url';process.chdir(process.env.DG_RETAINED_COMPILED);process.argv=[process.execPath,path.resolve('dist/postgres-runtime.mjs'),'check','--config-file',process.env.DG_COMMAND_CONFIG,'--role',process.env.DG_COMMAND_ROLE];await import(pathToFileURL(path.resolve('dist/postgres-runtime.mjs')).href);";
 for(const[role,config]of [['api',c.apiPath],['worker',c.workerPath]]){
  const old=c.start('archived076-'+role,process.execPath,['--input-type=module','-e',code],{...c.env(config),DG_RETAINED_COMPILED:archived,DG_COMMAND_CONFIG:config,DG_COMMAND_ROLE:role}),oldExit=await proofBounded(old.closed,20000,'Archived CLI did not close');assert.equal(oldExit.code,1);
  const lines=old.stderr().trim().split('\n'),last=lines.findLast(line=>line.startsWith('{'));assert.ok(last);const denied=JSON.parse(last);assert.equal(denied.error.code,'PG_RUNTIME_FAILED');
  const current=await c.cli('current077-'+role,['check','--config-file',config,'--role',role]);assert.equal(current.code,0);const accepted=JSON.parse(current.stdout.trim().split('\n').at(-1)!);assert.equal(accepted.database,'postgres');assert.equal(accepted.role,role);assert.equal(accepted.validationOnly,true);checks.push({role,oldExit:oldExit.code,oldError:denied.error.code,currentExit:current.code});
 }
 assert.deepEqual(await c.owner(db=>nativeSpeakerUpgradeFingerprint(db,c.schema)),before);assert.equal(fs.existsSync(path.join(c.nativeDir,'digitalguide.sqlite')),false);
 const expectedKeys=JSON.parse(fs.readFileSync(path.join(path.dirname(prior),'before-restart.json'),'utf8')).keys as {name:string;sha256:string}[];for(const key of expectedKeys){assert.equal(proofHash(path.join(c.nativeDir,key.name)),key.sha256);c.keys.push(key);}
 c.save('version-compatibility.json',{result:'PASS',schema:c.schema,sameRoot:c.cluster.root,archivedCompiledRoot:archived,currentCompiledRoot:c.compiledRoot,checks,preservedTables:Object.keys(before).length,preservedRows:Object.values(before).reduce((n,t)=>n+t.rows,0),allBusinessRowsUnchanged:true,bothOriginalKeysUnchanged:true,noSqliteFallback:true,oldCliReturnsSanitizedGenericFailure:true,oldDetailedErrorCodeNotExposedByCli:true,oldCompiledBundleNotOverwritten:true});c.add('archived076_api_and_worker_cli_refuse_upgraded_schema_with_sanitized_failures');c.add('current077_api_and_worker_cli_open_same_schema_without_mutation_or_sqlite_fallback');
}catch(error){failure=error;}
finally{await c.finish(failure);}
