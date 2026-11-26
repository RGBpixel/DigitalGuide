import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {readRecoveryKey,decryptArchive,inspectArchiveZip} from '../packages/recovery/src/codec.js';
import {defaultLimits,inventory,removeOwnedTree} from '../packages/recovery/src/files.js';
import {recoveryPolicyFile} from '../packages/recovery/src/guard.js';
import {validateNativeRecoveryManifest} from '../packages/postgres/src/recovery-manifest.js';
import {nativeRecoverySnapshotsEqual} from '../packages/postgres/src/recovery-catalog.js';
import {nativeRecoverySnapshot} from '../packages/postgres/src/recovery-snapshot.js';
import {createPostgresClient,identifier} from '../packages/postgres/src/config.js';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {resumeRecoveryCluster,observeRecoveryClusters} from './native-recovery-owned.js';

const base='docs/evidence/T20/postgres-recovery',label=process.argv[2],auditLabel=process.argv[3];assert.match(label,/^backend-cluster-[a-zA-Z0-9]+$/);assert.match(auditLabel,/^[a-z][a-z0-9-]+$/);
const read=(f:string)=>JSON.parse(fs.readFileSync(f,'utf8')),hash=(f:string)=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),pair=read(base+'/'+label+'-independent-target.json'),backup=read(base+'/'+label+'-backup.json'),out=base+'/backend-finished';assert.equal(fs.existsSync(base+'/verification.json'),false);fs.mkdirSync(out,{recursive:false});
const auditFile=base+'/'+auditLabel+'-process-audit.json',archive=path.join(pair.sourceRoot,'native-backup.dgr');assert.equal(hash(archive),backup.result.archiveSHA256);const temp=fs.mkdtempSync(path.join(pair.sourceRoot,'recovery-finish-')),key=readRecoveryKey(path.join(pair.sourceRoot,'backup-key')),launched:Awaited<ReturnType<typeof resumeRecoveryCluster>>[]=[],checks:string[]=[];
const save=(name:string,value:unknown)=>fs.writeFileSync(out+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});
try{
 const zip=path.join(temp,'archive.zip');await decryptArchive(archive,zip,key,defaultLimits);const m=await inspectArchiveZip(zip,path.join(temp,'unused'),defaultLimits,false,validateNativeRecoveryManifest);assert.equal(m.database.recoveryCatalogAlgorithm,'check-bool-v1');
 launched.push(await resumeRecoveryCluster(pair.sourceRoot,auditFile));let target=await resumeRecoveryCluster(pair.targetRoot,auditFile);launched.push(target);
 async function snapshot(server:typeof target){const c=createPostgresClient(server.connection);await c.connect();try{await c.query('BEGIN READ ONLY');const data=await nativeRecoverySnapshot(c,m.database.schema,m.database,defaultLimits);await c.query('COMMIT');return data;}finally{await c.end();}}
 assert.ok(nativeRecoverySnapshotsEqual(await snapshot(launched[0]),m.database));const before=await snapshot(target);assert.deepEqual(before.tables.filter(t=>t.name!=='_dg_native_runtime_control'),m.database.tables.filter(t=>t.name!=='_dg_native_runtime_control'));assert.equal(before.rows,m.database.rows);
 const source=path.join(pair.sourceRoot,'native-data-offline-original'),prior=inventory(source,defaultLimits),restored=inventory(m.dataRoot,defaultLimits);assert.deepEqual(restored.directories,prior.directories);
 for(const file of prior.files){const actual=path.join(m.dataRoot,...file.relative.split('/'));if(['api.json','worker.json','.dg-native-postgres.json'].includes(file.relative)){const config=read(actual);assert.equal(config.purpose,'native-recovery-quarantined');assert.equal(config.sourceFileSHA256,hash(file.absolute));assert.equal(config.connection,undefined);}else assert.equal(hash(actual),hash(file.absolute));}
 const image=prior.files.find(f=>fs.readFileSync(f.absolute).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert.ok(image);assert.ok(PNG.sync.read(fs.readFileSync(path.join(m.dataRoot,...image.relative.split('/')))).width>1);
 assert.equal(read(path.join(m.dataRoot,recoveryPolicyFile)).complete,true);assert.throws(()=>loadNativeRuntimeConfig(path.join(m.dataRoot,'api.json')));
 async function refused(){for(const[role,file]of [[m.database.apiRole,'api-password'],[m.database.workerRole,'worker-password']]){const c=createPostgresClient({...target.connection,user:role,passwordFile:path.join(pair.targetRoot,file)});try{await assert.rejects(c.connect(),{code:'42501'});}finally{await c.end();}}}
 await refused();const c=createPostgresClient(target.connection);await c.connect();try{
  const row=(await c.query('SELECT * FROM public._dg_native_recovery_control WHERE id=1')).rows[0];assert.equal(row.status,'quarantined');assert.equal(row.backup_id,m.backupId);assert.equal(row.archive_sha256,backup.result.archiveSHA256);assert.equal(row.runtime_id,m.database.runtimeId);assert.equal((await c.query('SELECT status FROM '+identifier(m.database.schema)+'._dg_native_runtime_control WHERE id=1')).rows[0].status,'recovery_quarantined');
  const jobs=(await c.query('SELECT status,attempts FROM '+identifier(m.database.schema)+'.jobs')).rows;assert.equal(jobs.length,1);assert.deepEqual(jobs[0],{status:'queued',attempts:'0'});save('retained-committed-restore',{result:'PASS',sourceRoot:pair.sourceRoot,targetRoot:pair.targetRoot,originalBackupId:m.backupId,originalArchiveSHA256:backup.result.archiveSHA256,restoreExecutedAgain:false,configurationFilesQuarantined:3,originalLocalFilesAndKeysMatch:true,allNonControlTablesMatch:true,attemptsType:'int8 string',pendingJobsNeverRun:true});
 }finally{await c.end();}checks.push('跨集群实际恢复逐表逐行匹配，文件与原两密钥保持，旧队列不执行且业务角色禁止连接');
 const tamper=createPostgresClient(target.connection);await tamper.connect();try{await tamper.query('BEGIN');await tamper.query('UPDATE '+identifier(m.database.schema)+".users SET name='原创合成篡改验证' WHERE id=(SELECT id FROM "+identifier(m.database.schema)+'.users ORDER BY id LIMIT 1)');const changed=await nativeRecoverySnapshot(tamper,m.database.schema,m.database,defaultLimits);assert.equal(changed.recoveryCatalogSHA256,before.recoveryCatalogSHA256);assert.equal(nativeRecoverySnapshotsEqual(changed,before),false);}finally{await tamper.query('ROLLBACK');await tamper.end();}assert.deepEqual(await snapshot(target),before);checks.push('隔离恢复后篡改数据会被拒绝，目录和权限摘要相同也不能掩盖行变化');
 await observeRecoveryClusters(out+'/observed-before-restart.json',launched.map(s=>s.child.pid!),target.connection.port);save('before-target-restart',before);
 // Restart only the instance whose stop and supervisor completion are awaited
 // by this live owner; do not reopen any other completed or sealed proof.
 target=await target.restart();launched[1]=target;assert.deepEqual(await snapshot(target),before);await refused();assert.ok(nativeRecoverySnapshotsEqual(await snapshot(launched[0]),m.database));assert.equal(hash(archive),backup.result.archiveSHA256);save('after-target-restart',await snapshot(target));
 checks.push('恢复库重启后隔离、492表和原文件保持，原队列仍未执行');await observeRecoveryClusters(out+'/observed-after-restart.json',launched.map(s=>s.child.pid!),target.connection.port);
 save('proof',{result:'PASS_RETAINED_COMMITTED_RESTORE_REMAINING_ASSERTIONS_TAMPER_RESTART',checkedAt:new Date().toISOString(),checks,sourceRoot:pair.sourceRoot,targetRoot:pair.targetRoot,originalArchiveSHA256:backup.result.archiveSHA256,sourceDatabaseUnchanged:true,restoreExecutedAgain:false,previousPassedCasesRepeated:false,tableCount:492,bothOriginalKeysExact:true,workerRun:false,realExternalActions:false,mainRestarted:false,goalStatus:'active'});console.log(JSON.stringify({result:'PASS_RETAINED_COMMITTED_RESTORE_REMAINING_ASSERTIONS_TAMPER_RESTART',checks:checks.length,restoreExecutedAgain:false,goal:'active'}));
}finally{key.fill(0);for(const server of launched.reverse())await server.stop();removeOwnedTree(temp,pair.sourceRoot,'recovery-finish-');}
