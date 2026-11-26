import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PNG} from 'pngjs';
import {nativeCluster,nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {createNativeRecoveryBackup,verifyNativeRecoveryBackup,restoreNativeRecoveryBackup} from '../../packages/postgres/src/recovery.js';
import {nativeRecoverySnapshot,recoveryConnectionHash} from '../../packages/postgres/src/recovery-snapshot.js';
import {createPostgresClient,identifier,type PostgresConnectionConfig} from '../../packages/postgres/src/config.js';
import {loadNativeRuntimeConfig} from '../../packages/postgres/src/runtime-config.js';
import {recoveryPolicyFile,recoveryLockPath} from '../../packages/recovery/src/guard.js';
import {defaultLimits,inventory,within} from '../../packages/recovery/src/files.js';
import {syntheticPng} from '../../packages/media/src/index.js';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {nativeRecoverySnapshotsEqual} from '../../packages/postgres/src/recovery-catalog.js';

describe.skipIf(!nativePostgresAvailable)('原生PostgreSQL真实加密备份与跨集群隔离恢复',()=>{
 let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,target:Awaited<ReturnType<typeof nativeCluster>>,backup:Awaited<ReturnType<typeof createNativeRecoveryBackup>>,sourceSnapshot:Awaited<ReturnType<typeof nativeRecoverySnapshot>>,targetBeforeRestart:Awaited<ReturnType<typeof nativeRecoverySnapshot>>;
 let archive:string,keyFile:string,configFile:string,originalDir:string,offlineDir:string,jobId:string,targetApi:PostgresConnectionConfig,targetWorker:PostgresConnectionConfig;
 const phases:{operationId:string;phase:string}[]=[],evidence='docs/evidence/T20/postgres-recovery',sha=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 function record(name:string,value:unknown){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'backend-'+path.basename(x.cluster.root)+'-'+name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
 function sourceOffline(){if(fs.existsSync(offlineDir)){expect(fs.existsSync(originalDir)).toBe(false);return;}expect(within(originalDir,x.cluster.root)).toBe(true);expect(within(offlineDir,x.cluster.root)).toBe(true);fs.renameSync(originalDir,offlineDir);record('owned-source-offline-move',{originalDir,offlineDir,sourceStopped:true,ownedFreshFixtureOnly:true,sourceDatabaseUnchanged:true});}
 const options=()=>({configFile,loader:x.cluster.connection,output:archive,keyFile,confirmedStopped:true,onPhase:(event:{operationId:string;phase:string})=>{phases.push(event);}});
 const restoreOptions=(loader=target.connection,dataDir=originalDir)=>({archive,keyFile,loader,dataDir,confirmed:true});
 const metadata=()=>({runtimeId:x.result.runtimeId,appEnv:'development' as const,ownerRole:x.cluster.connection.user,apiRole:x.result.api.connection.user,workerRole:x.result.worker.connection.user,sourceConnectionSHA256:recoveryConnectionHash(x.cluster.connection)});
 async function snapshot(connection:PostgresConnectionConfig){const c=createPostgresClient(connection);await c.connect();try{await c.query('BEGIN READ ONLY');const result=await nativeRecoverySnapshot(c,x.result.schema,metadata(),defaultLimits);await c.query('COMMIT');return result;}finally{await c.end();}}
 async function rejectedBusinessConnections(){for(const connection of [targetApi,targetWorker]){const c=createPostgresClient(connection);try{await expect(c.connect()).rejects.toMatchObject({code:'42501'});}finally{await c.end();}}}
 beforeAll(async()=>{
  x=await nativeRuntimeFixture({onInitialized:(result,cluster)=>{const file=path.join(evidence,'125-first-committed.json'),sql='migrations/postgres/125-native-recovery-quarantine.sql',entry={checkedAt:new Date().toISOString(),root:cluster.root,schema:result.schema,name:path.basename(sql),sha256:sha(sql),runtime:122,committed:true};if(fs.existsSync(file))expect(JSON.parse(fs.readFileSync(file,'utf8')).sha256).toBe(entry.sha256);else fs.writeFileSync(file,JSON.stringify(entry,null,2)+'\n',{flag:'wx'});}});
  originalDir=x.result.api.dataDir;offlineDir=path.join(x.cluster.root,'native-data-offline-original');configFile=path.join(originalDir,'api.json');archive=path.join(x.cluster.root,'native-backup.dgr');keyFile=path.join(x.cluster.root,'backup-key');fs.writeFileSync(keyFile,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
  const headers=await x.login(),post=async(url:string,payload:object)=>{const r=await x.app.inject({method:'POST',url:'/api/v1'+url,headers:{...headers,'idempotency-key':randomUUID()},payload});expect(r.statusCode).toBeGreaterThanOrEqual(200);expect(r.statusCode).toBeLessThan(300);return r.json().data;};
  const upload=await post('/assets/uploads',{workspaceId:f.workspaceA,fileName:'原创备份合成图.png',contentBase64:syntheticPng([23,130,86]).toString('base64')});await post('/assets',{uploadId:upload.uploadId,name:'原创备份合成素材',category:'avatar'});jobId=(await post('/jobs',{workspaceId:f.workspaceA,kind:'provider.check'})).id;
  fs.mkdirSync(path.join(originalDir,'objects','原创空目录'),{recursive:true});fs.writeFileSync(path.join(originalDir,'objects','原创备份说明.txt'),'原创合成说明，不是真实客户资料。',{flag:'wx'});
  await x.app.close();await x.workerDb.close();sourceSnapshot=await snapshot(x.cluster.connection);backup=await createNativeRecoveryBackup(options());record('backup',{result:backup,phases,sourceTables:sourceSnapshot.tables.length,sourceDatabaseSHA256:createHash('sha256').update(JSON.stringify(sourceSnapshot)).digest('hex')});
  target=await nativeCluster();const admin=await target.admin();try{await admin.query('CREATE ROLE dg_recovery_padding NOLOGIN');for(const[name,file]of [[x.result.api.connection.user,'api-password'],[x.result.worker.connection.user,'worker-password']]){const password=randomBytes(32).toString('hex');fs.writeFileSync(path.join(target.root,file),password,{flag:'wx',mode:0o600});await admin.query('CREATE ROLE '+identifier(name)+" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");}}finally{await admin.end();}
  targetApi={...target.connection,user:x.result.api.connection.user,passwordFile:path.join(target.root,'api-password')};targetWorker={...target.connection,user:x.result.worker.connection.user,passwordFile:path.join(target.root,'worker-password')};
  record('independent-target',{sourceRoot:x.cluster.root,targetRoot:target.root,sourcePort:x.cluster.port,targetPort:target.port,sameCluster:false,distinctTargetBusinessPasswords:true});
 },180000);
 afterAll(async()=>{try{await target?.stop();}finally{await x?.close();}},60000);

 it('实际加密备份包含495表、原本地文件和127迁移，源数据不变',async()=>{
  expect(backup).toMatchObject({result:'PASS',tableCount:495,sourceDatabaseChanged:false,productionRecoveryAccepted:false,latestMigration:'127-native-recovery-privacy.sql'});expect(backup.rows).toBe(sourceSnapshot.rows);expect(await snapshot(x.cluster.connection)).toEqual(sourceSnapshot);expect(fs.existsSync(recoveryLockPath(originalDir))).toBe(false);
  const bytes=fs.readFileSync(archive);expect(bytes.subarray(0,8).toString()).toBe('DGRBK001');expect(bytes.includes(Buffer.from('.session-secret'))).toBe(false);expect(bytes.includes(Buffer.from('原创合成说明'))).toBe(false);expect(phases.map(p=>p.phase)).toContain('readback_verification');
 });
 it('未确认停机拒绝备份，不产生新归档',async()=>{await expect(createNativeRecoveryBackup({...options(),confirmedStopped:false,output:archive+'.no-confirm'})).rejects.toMatchObject({code:'PG_RECOVERY_STOP_CONFIRMATION_REQUIRED'});expect(fs.existsSync(archive+'.no-confirm')).toBe(false);});
 it('真实业务连接仍在时拒绝源备份并清理维护锁',async()=>{
  const client=createPostgresClient(x.result.api.connection);await client.connect();try{await expect(createNativeRecoveryBackup({...options(),output:archive+'.busy'})).rejects.toMatchObject({code:'PG_RECOVERY_SOURCE_BUSY'});}finally{await client.end();}expect(fs.existsSync(archive+'.busy')).toBe(false);expect(fs.existsSync(recoveryLockPath(originalDir))).toBe(false);
 });
 it('业务身份不能冒充运维账号，源内输出和已有输出拒绝',async()=>{
  await expect(createNativeRecoveryBackup({...options(),loader:x.result.api.connection,output:archive+'.bad-role'})).rejects.toMatchObject({code:'PG_RECOVERY_SOURCE_IDENTITY'});
  await expect(createNativeRecoveryBackup({...options(),output:path.join(originalDir,'unsafe.dgr')})).rejects.toMatchObject({code:'PG_RECOVERY_OUTPUT_LOCATION'});
  const before=sha(archive);await expect(createNativeRecoveryBackup(options())).rejects.toMatchObject({code:'PG_RECOVERY_OUTPUT_EXISTS'});expect(sha(archive)).toBe(before);
 });
 it('容量与取消失败不发布归档，也不改变源数据库',async()=>{
  await expect(createNativeRecoveryBackup({...options(),output:archive+'.limited',limits:{maxRows:1}})).rejects.toMatchObject({code:'PG_RECOVERY_LIMIT_EXCEEDED'});
  const abort=new AbortController();abort.abort();await expect(createNativeRecoveryBackup({...options(),output:archive+'.cancelled',signal:abort.signal})).rejects.toMatchObject({code:'RECOVERY_CANCELLED'});expect(fs.existsSync(archive+'.limited')).toBe(false);expect(fs.existsSync(archive+'.cancelled')).toBe(false);expect(await snapshot(x.cluster.connection)).toEqual(sourceSnapshot);
 });
 it('认证与清单验证通过但不冒充数据库恢复验证',async()=>{const result=await verifyNativeRecoveryBackup({archive,keyFile,workDir:x.cluster.root});expect(result).toMatchObject({result:'PASS',archiveSHA256:backup.archiveSHA256,tableCount:495,databaseRestoreVerified:false,productionRecoveryAccepted:false});});
 it('错误密钥和被篡改密文在触及目标库前拒绝',async()=>{
  const wrong=path.join(x.cluster.root,'wrong-backup-key');fs.writeFileSync(wrong,randomBytes(32).toString('hex'),{flag:'wx'});await expect(verifyNativeRecoveryBackup({archive,keyFile:wrong,workDir:x.cluster.root})).rejects.toMatchObject({code:'RECOVERY_AUTH_FAILED'});
  const corrupt=archive+'.corrupt',bytes=fs.readFileSync(archive);bytes[30]^=1;fs.writeFileSync(corrupt,bytes,{flag:'wx'});await expect(verifyNativeRecoveryBackup({archive:corrupt,keyFile,workDir:x.cluster.root})).rejects.toMatchObject({code:'RECOVERY_AUTH_FAILED'});
 });
 it('已有原目录和错误的跨目录恢复拒绝，不覆盖源文件',async()=>{
  const keyBefore=sha(path.join(originalDir,'.session-secret'));await expect(restoreNativeRecoveryBackup(restoreOptions())).rejects.toMatchObject({code:'PG_RECOVERY_TARGET_EXISTS'});expect(sha(path.join(originalDir,'.session-secret'))).toBe(keyBefore);
  await expect(restoreNativeRecoveryBackup(restoreOptions(target.connection,path.join(x.cluster.root,'different-directory')))).rejects.toMatchObject({code:'PG_RECOVERY_ROOT_MISMATCH'});
 });
 it('独立非空目标库被拒绝，原有对象和权限不受覆盖',async()=>{
  sourceOffline();
  const name='dg_nonempty_'+randomUUID().replaceAll('-','').slice(0,16),admin=await target.admin();try{await admin.query('CREATE DATABASE '+identifier(name)+' OWNER '+identifier(target.connection.user)+" TEMPLATE template0 ENCODING 'UTF8'");}finally{await admin.end();}
  const connection={...target.connection,database:name},c=createPostgresClient(connection);await c.connect();try{await c.query('CREATE TABLE public.sentinel(value text)');await c.query("INSERT INTO public.sentinel VALUES ('original synthetic value')");}finally{await c.end();}
  await expect(restoreNativeRecoveryBackup(restoreOptions(connection))).rejects.toMatchObject({code:'PG_RECOVERY_TARGET_NOT_EMPTY'});const verify=createPostgresClient(connection);await verify.connect();try{expect((await verify.query('SELECT value FROM public.sentinel')).rows).toEqual([{value:'original synthetic value'}]);expect((await verify.query("SELECT to_regclass('public._dg_native_recovery_control') marker")).rows[0].marker).toBeNull();}finally{await verify.end();}expect(fs.existsSync(originalDir)).toBe(false);
 });
 it('跨集群实际恢复逐表逐行匹配，文件与原两密钥保持，旧队列不执行且业务角色禁止连接',async()=>{
  sourceOffline();
  const result=await restoreNativeRecoveryBackup(restoreOptions());expect(result).toMatchObject({result:'PASS',tableCount:495,databaseRestoreVerified:true,databaseQuarantined:true,workerEnabled:false,liveActionsEnabled:false,configurationActivation:false});
  const restored=await snapshot(target.connection);expect(restored.tables.filter(t=>t.name!=='_dg_native_runtime_control')).toEqual(sourceSnapshot.tables.filter(t=>t.name!=='_dg_native_runtime_control'));expect(restored.rows).toBe(sourceSnapshot.rows);expect(await snapshot(x.cluster.connection)).toEqual(sourceSnapshot);
  const old=inventory(offlineDir,defaultLimits),now=inventory(originalDir,defaultLimits);expect(now.directories).toEqual(old.directories);for(const file of old.files){const actual=path.join(originalDir,...file.relative.split('/'));if(['api.json','worker.json','.dg-native-postgres.json'].includes(file.relative))expect(JSON.parse(fs.readFileSync(actual,'utf8')).purpose).toBe('native-recovery-quarantined');else expect(sha(actual)).toBe(sha(file.absolute));}
  const image=old.files.find(f=>fs.readFileSync(f.absolute).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));expect(image).toBeDefined();const decoded=PNG.sync.read(fs.readFileSync(path.join(originalDir,...image!.relative.split('/'))));expect(decoded.width).toBeGreaterThan(1);
  expect(JSON.parse(fs.readFileSync(path.join(originalDir,recoveryPolicyFile),'utf8'))).toMatchObject({complete:true,activation:'isolated-validation-only',database:'postgres'});expect(()=>loadNativeRuntimeConfig(path.join(originalDir,'api.json'))).toThrow();
  await rejectedBusinessConnections();const c=createPostgresClient(target.connection);await c.connect();try{expect((await c.query('SELECT status FROM '+identifier(x.result.schema)+'._dg_native_runtime_control WHERE id=1')).rows[0].status).toBe('recovery_quarantined');expect((await c.query('SELECT status,attempts FROM '+identifier(x.result.schema)+'.jobs WHERE id=$1',[jobId])).rows[0]).toEqual({status:'queued',attempts:'0'});expect((await c.query('SELECT status FROM public._dg_native_recovery_control WHERE id=1')).rows[0].status).toBe('quarantined');}finally{await c.end();}
  targetBeforeRestart=restored;record('restore',{result,sourceRoot:x.cluster.root,targetRoot:target.root,crossCluster:true,allNonControlTablesMatch:true,sourceDatabaseUnchanged:true,localFilesAndBothKeysExact:true,quarantinedConfigFiles:3,businessConnectionsDenied:2,queueExecuted:false});
 },120000);
 it('隔离恢复后篡改数据会被拒绝，目录和权限摘要相同也不能掩盖行变化',async()=>{
  expect(targetBeforeRestart).toBeDefined();const c=createPostgresClient(target.connection);await c.connect();try{await c.query('BEGIN');await c.query('UPDATE '+identifier(x.result.schema)+'.users SET name=$1 WHERE id=$2',['原创合成篡改验证',f.adminA]);const changed=await nativeRecoverySnapshot(c,x.result.schema,metadata(),defaultLimits);expect(changed.recoveryCatalogSHA256).toBe(targetBeforeRestart.recoveryCatalogSHA256);expect(nativeRecoverySnapshotsEqual(changed,targetBeforeRestart)).toBe(false);}finally{await c.query('ROLLBACK');await c.end();}expect(await snapshot(target.connection)).toEqual(targetBeforeRestart);
 });
 it('恢复库重启后隔离、495表和原文件保持，原队列仍未执行',async()=>{
  expect(targetBeforeRestart).toBeDefined();await target.stop();await target.start();expect(await snapshot(target.connection)).toEqual(targetBeforeRestart);await rejectedBusinessConnections();expect(JSON.parse(fs.readFileSync(path.join(originalDir,recoveryPolicyFile),'utf8')).complete).toBe(true);record('restart',{result:'PASS',targetRoot:target.root,tables:495,databaseQuarantineRetained:true,businessConnectionsDenied:2,sourceRoot:x.cluster.root,sourceDatabaseUnchanged:true});
 },60000);
});
