import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {assertNativeRecoveryAccess,assertNativeRuntimeDirectory,parseNativeRuntimeConfig,nativeRuntimeMarker,runtimeDataHash} from '../../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {recoveryLockPath,recoveryPolicyFile} from '../../packages/recovery/src/guard.js';

function fixture(){
 const dir=path.resolve('storage/postgres-recovery-guard-unit/'+randomUUID());fs.mkdirSync(dir,{recursive:true});
 for(const n of ['.session-secret','.provenance-secret'])fs.writeFileSync(path.join(dir,n),randomBytes(48).toString('hex'),{flag:'wx'});
 const c=parseNativeRuntimeConfig({version:1,purpose:'native-application-validation-only',schema:'dg_validation_'+randomUUID().replaceAll('-',''),runtimeId:randomUUID(),dataDir:dir,appEnv:'development',connection:{purpose:'offline-staging-only',host:'127.0.0.1',port:1,database:'unused',user:'unused',passwordFile:path.join(dir,'unread-password'),tls:{mode:'loopback-test-only'}}});
 fs.writeFileSync(path.join(dir,nativeRuntimeMarker),JSON.stringify({version:1,complete:true,purpose:c.purpose,schema:c.schema,runtimeId:c.runtimeId,dataDirSHA256:runtimeDataHash(dir),appEnv:c.appEnv}));
 return{dir,c};
}
const policy=()=>({version:1,complete:true,activation:'isolated-validation-only',backupId:randomUUID(),archiveSHA256:'a'.repeat(64)});

describe('原生数据库维护和恢复隔离入口',()=>{
 it('普通原生实例仍能验证目录，不创建密钥或恢复标记',()=>{
  const x=fixture(),before=['.session-secret','.provenance-secret'].map(n=>fs.readFileSync(path.join(x.dir,n)));
  expect(()=>assertNativeRuntimeDirectory(x.c)).not.toThrow();expect(()=>assertNativeRecoveryAccess(x.dir)).not.toThrow();
  expect(fs.existsSync(path.join(x.dir,recoveryPolicyFile))).toBe(false);
  expect(['.session-secret','.provenance-secret'].map(n=>fs.readFileSync(path.join(x.dir,n)))).toEqual(before);
 });
 it.each(['directory','file'])('运维锁即使为空或类型为%s，也拒绝目录验证',kind=>{
  const x=fixture(),lock=recoveryLockPath(x.dir);if(kind==='directory')fs.mkdirSync(lock);else fs.writeFileSync(lock,'');
  expect(()=>assertNativeRuntimeDirectory(x.c)).toThrowError(expect.objectContaining({code:'PG_RUNTIME_MAINTENANCE'}));
 });
 it.each(['valid','incomplete','invalid-json','directory','dangling-junction'])('恢复标记%s保持关闭，不借用SQLite只读验证模式',kind=>{
  const x=fixture(),file=path.join(x.dir,recoveryPolicyFile);
  if(kind==='directory')fs.mkdirSync(file);
  else if(kind==='dangling-junction')fs.symlinkSync(path.join(x.dir,'absent-target'),file,'junction');
  else fs.writeFileSync(file,kind==='invalid-json'?'{':JSON.stringify({...policy(),complete:kind!=='incomplete'}));
  expect(()=>assertNativeRuntimeDirectory(x.c)).toThrowError(expect.objectContaining({code:'PG_RUNTIME_RECOVERY_ISOLATED'}));
 });
 it('直接API或worker连接在读取密码或建立连接之前拒绝恢复副本',async()=>{
  const x=fixture();fs.writeFileSync(path.join(x.dir,recoveryPolicyFile),JSON.stringify(policy()));
  for(const role of ['api','worker'] as const)await expect(NativePostgresDatabase.open(x.c,role)).rejects.toMatchObject({code:'PG_RUNTIME_RECOVERY_ISOLATED'});
  expect(fs.existsSync(x.c.connection.passwordFile)).toBe(false);
 });
});
