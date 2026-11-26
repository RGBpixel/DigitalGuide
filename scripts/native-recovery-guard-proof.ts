import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NativeContentProofRuntime,proofBounded,proofHash} from './postgres-content-proof-runtime.js';
import {financialSnapshot} from './native-financial-proof-runtime.js';
import {recoveryLockPath,recoveryPolicyFile} from '../packages/recovery/src/guard.js';

const label=process.argv[2];assert.match(label,/^[a-z][a-z0-9-]+$/);
const c=await NativeContentProofRuntime.create('docs/evidence/T20/postgres-recovery-guard/'+label),lock=recoveryLockPath(c.nativeDir),marker=path.join(c.nativeDir,recoveryPolicyFile);
async function refused(code:string,prefix:string){
 for(const[role,config]of [['api',c.apiPath],['worker',c.workerPath]]){
  const cli=await c.cli(prefix+'-direct-'+role,['check','--config-file',config,'--role',role]);assert.equal(cli.code,1);assert.ok(cli.stderr.includes(code));
  const process=c.start(prefix+'-host-'+role,globalThis.process.execPath,['dist/'+role+'.mjs'],c.env(config));
  assert.equal((await proofBounded(process.closed,20000,'Quarantined compiled process did not exit')).code,1);assert.ok(process.stderr().includes(code));
 }
 const response=await c.http('/api/v1/me');assert.equal(response.status,503);assert.equal(response.body.error?.code,code);
 assert.ok(!JSON.stringify(response.body).includes(c.nativeDir));
}
try{
 await c.prepare({contentModels:false});
 const walk=(d:string):string[]=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
 const compiled=Object.fromEntries(walk(path.join(c.compiledRoot,'dist')).map(f=>[path.relative(c.compiledRoot,f).replaceAll('\\','/'),proofHash(f)]));assert.equal(Object.keys(compiled).length,78);c.save('compiled-file-sha256.json',compiled);
 const before=await financialSnapshot(c);assert.equal(before.tables.length,492);c.save('before-maintenance.json',before);
 const configs=Object.fromEntries(['api.json','worker.json','.dg-native-postgres.json'].map(n=>[n,proofHash(path.join(c.nativeDir,n))]));
 fs.mkdirSync(lock);
 await refused('PG_RUNTIME_MAINTENANCE','maintenance');
 assert.deepEqual(await financialSnapshot(c),before);
 c.add('compiled_cli_api_worker_and_already_open_http_refuse_maintenance_with_492_tables_and_both_keys_unchanged');
 fs.rmdirSync(lock);
 fs.writeFileSync(marker,JSON.stringify({version:1,complete:true,activation:'isolated-validation-only',backupId:randomUUID(),archiveSHA256:'c'.repeat(64)}),{flag:'wx'});
 await refused('PG_RUNTIME_RECOVERY_ISOLATED','quarantine');
 assert.deepEqual(await financialSnapshot(c),before);
 c.add('compiled_cli_api_worker_and_already_open_http_refuse_valid_recovery_quarantine_without_business_changes');
 fs.writeFileSync(marker,'{');
 const invalid=await c.cli('damaged-recovery-marker',['check','--config-file',c.apiPath,'--role','api']);assert.equal(invalid.code,1);assert.ok(invalid.stderr.includes('PG_RUNTIME_RECOVERY_ISOLATED'));
 assert.deepEqual(await financialSnapshot(c),before);
 c.add('damaged_recovery_marker_keeps_compiled_native_tools_closed');
 // This is fault injection in a fresh ordinary fixture, not activation of restored data.
 fs.unlinkSync(marker);
 await c.observe();
 for(const name of ['api-a','api-b']){const process=c.running.find(p=>p.label===name);assert.ok(process);await c.stop(process);}
 const restart=await financialSnapshot(c);c.save('before-api-postgres-restart.json',restart);await c.cluster.stop();await c.cluster.start();
 await c.api('api-a-after-restart');await c.api('api-b-after-restart',c.apiB);await c.get('/me');
 assert.deepEqual(await financialSnapshot(c),restart);c.save('after-api-postgres-restart.json',await financialSnapshot(c));
 assert.deepEqual(Object.fromEntries(Object.keys(configs).map(n=>[n,proofHash(path.join(c.nativeDir,n))])),configs);
 for(const[file,sha]of Object.entries(compiled))assert.equal(proofHash(path.join(c.compiledRoot,file)),sha);
 c.save('guard-summary.json',{result:'PASS',compiledChecks:5,guiChecks:0,tables:492,keys:2,compiledFiles:78,configurationHashes:configs,fixtureOnlyFaultInjection:true,restoredDataActivated:false,nativeBackupImplemented:false,postBackupDeletionReconciled:false,productionActivation:false,realExternalActions:false,mainRestarted:false});
 c.add('same_fresh_fixture_api_and_postgres_restart_preserves_492_tables_two_keys_configs_original_cookie_and_78_compiled_files');
 await c.observe('observed-after-restart');await c.finish();console.log(JSON.stringify({result:'PASS_NATIVE_RECOVERY_GUARD_COMPILED',checks:c.checks.length,tables:492,compiledFiles:78,goal:'active'}));
}catch(error){
 // Retain a failed fixture's quarantine/maintenance marker; finish only closes owned processes.
 await c.finish(error);
}
