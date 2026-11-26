import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterEach,describe,it,expect} from 'vitest';
import {assertRecoveryAccess,assertRecoveryWorkerDisabled,recoveryLockPath,recoveryPolicyFile,recoveryReadAllowed} from '../../packages/recovery/src/guard.js';
import {safeRelative,defaultLimits} from '../../packages/recovery/src/files.js';
import {validateManifest} from '../../packages/recovery/src/manifest.js';
import {loadConfig} from '../../apps/api/src/config.js';
const hash='a'.repeat(64),variables=['DATA_DIR','APP_ENV','PROVIDER_MODE','SESSION_SECRET','CONTENT_PROVENANCE_SIGNING_KEY','RECOVERY_VALIDATION_ONLY'] as const,saved=Object.fromEntries(variables.map(k=>[k,process.env[k]]));
afterEach(()=>{for(const k of variables)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];});
function folder(){const d=path.resolve('storage/recovery-unit/'+randomUUID());fs.mkdirSync(d,{recursive:true});return d;}
function policy(d:string,complete=true){fs.writeFileSync(path.join(d,recoveryPolicyFile),JSON.stringify({version:1,backupId:randomUUID(),archiveSHA256:hash,complete,activation:'isolated-validation-only'}));}
function manifest(){return{version:1,format:'sqlite-full-data-dir-v1',backupId:randomUUID(),createdAt:new Date().toISOString(),dataRoot:path.resolve('storage/fictional-recovery-source'),files:['digitalguide.sqlite','.session-secret','.provenance-secret'].map(p=>({path:p,bytes:1,sha256:hash})),directories:[] as string[],database:{schemaSHA256:hash,tables:[{name:'schema_migrations',rows:1,sha256:hash}],rows:1,migrations:[{name:'001-foundation.sql',sha256:hash}]},activation:'isolated-validation-only'};}
describe('恢复格式、路径和启动隔离',()=>{
  it.each(['../escape','a/../escape','C:/escape','/absolute','a\\escape','file:stream','con.txt','LPT1','trailing.','space ','a//b','a/./b','hidden\u0000name'])('拒绝不安全或Windows不支持的归档路径：%s',value=>{expect(()=>safeRelative(value)).toThrow();});
  it('接受有父目录的中文私有文件，但拒绝重复、大小写/规范化冲突及文件作为父目录',()=>{
    const valid=manifest();valid.directories=['私有素材'];valid.files.push({path:'私有素材/原创角色.png',bytes:12,sha256:hash});expect(validateManifest(valid,defaultLimits).files).toHaveLength(4);
    for(const added of ['.SESSION-SECRET','digitalguide.sqlite/escape']){const m=manifest();m.files.push({path:added,bytes:1,sha256:hash});expect(()=>validateManifest(m,defaultLimits)).toThrow();}
    const unicode=manifest();unicode.files.push({path:'é.txt',bytes:1,sha256:hash},{path:'e\u0301.txt',bytes:1,sha256:hash});expect(()=>validateManifest(unicode,defaultLimits)).toThrow();
    const missing=manifest();missing.files=missing.files.filter(f=>f.path!=='.provenance-secret');expect(()=>validateManifest(missing,defaultLimits)).toThrow();
  });
  it('表行数和唯一性必须一致，文件和字节限制不能被清单绕过',()=>{
    const row=manifest();row.database.rows=2;expect(()=>validateManifest(row,defaultLimits)).toThrow();const duplicate=manifest();duplicate.database.tables.push(duplicate.database.tables[0]);duplicate.database.rows=2;expect(()=>validateManifest(duplicate,defaultLimits)).toThrow();expect(()=>validateManifest(manifest(),{...defaultLimits,maxBytes:2})).toThrow();expect(()=>validateManifest(manifest(),{...defaultLimits,maxFiles:2})).toThrow();
  });
  it('正常目录不改默认模式；有运维锁时所有模式拒绝启动，不能静默忽略',()=>{
    const d=folder();expect(()=>assertRecoveryAccess(d)).not.toThrow();fs.mkdirSync(recoveryLockPath(d));for(const mode of [undefined,{appEnv:'development',environment:'mock',recoveryValidationOnly:true},{appEnv:'production',environment:'live'}])expect(()=>assertRecoveryAccess(d,mode)).toThrow(/运维锁/);
  });
  it('恢复目录默认拒绝；仅明确mock/开发或沙箱验证可读，worker始终拒绝',()=>{
    const d=folder();policy(d);for(const mode of [undefined,{appEnv:'production',environment:'mock',recoveryValidationOnly:true},{appEnv:'development',environment:'live',recoveryValidationOnly:true},{appEnv:'development',environment:'sandbox',recoveryValidationOnly:true},{appEnv:'development',environment:'mock'}])expect(()=>assertRecoveryAccess(d,mode)).toThrow();for(const appEnv of ['development','sandbox'])expect(()=>assertRecoveryAccess(d,{appEnv,environment:'mock',recoveryValidationOnly:true})).not.toThrow();expect(()=>assertRecoveryWorkerDisabled(d)).toThrow(/worker保持关闭/);
  });
  it('损坏、非完整或错误类型的隔离标记不能通过验证模式打开',()=>{
    const d=folder();policy(d,false);const mode={appEnv:'development',environment:'mock',recoveryValidationOnly:true};expect(()=>assertRecoveryAccess(d,mode)).toThrow(/标记损坏/);fs.writeFileSync(path.join(d,recoveryPolicyFile),'{broken');expect(()=>assertRecoveryAccess(d,mode)).toThrow(/标记损坏/);fs.unlinkSync(path.join(d,recoveryPolicyFile));fs.mkdirSync(path.join(d,recoveryPolicyFile));expect(()=>assertRecoveryAccess(d,mode)).toThrow(/标记损坏/);
  });
  it('断开的隔离标记或维护锁目录联接也保持关闭，不能当作不存在',()=>{
    const d=folder(),missing=path.join(path.dirname(d),'missing-'+randomUUID());fs.symlinkSync(missing,path.join(d,recoveryPolicyFile),process.platform==='win32'?'junction':'dir');expect(fs.existsSync(path.join(d,recoveryPolicyFile))).toBe(false);expect(()=>assertRecoveryAccess(d,{appEnv:'development',environment:'mock',recoveryValidationOnly:true})).toThrow(/标记损坏/);const other=folder();fs.symlinkSync(missing,recoveryLockPath(other),process.platform==='win32'?'junction':'dir');expect(()=>assertRecoveryAccess(other)).toThrow(/运维锁/);
  });
  it('验证模式只允许核心读取和新登录，拒绝业务GET、副作用、公开回调及编码绕过',()=>{
    for(const p of ['/api/v1/me','/api/v1/readiness','/api/v1/assets/'+randomUUID()+'/content','/api/v1/profiles','/api/v1/jobs'])expect(recoveryReadAllowed('GET',p)).toBe(true);expect(recoveryReadAllowed('POST','/api/v1/auth/login')).toBe(true);for(const[method,p]of [['POST','/api/v1/jobs'],['POST','/api/v1/webhooks/mock-payments'],['GET','/api/v1/live-sessions/'+randomUUID()],['GET','/api/v1/assets/%2e%2e'],['PATCH','/api/v1/assets/'+randomUUID()],['POST','/api/v1/auth/login/extra']])expect(recoveryReadAllowed(method,p)).toBe(false);
  });
  it('配置层在私有密钥生成前检查维护锁；恢复验证标志不能应用于普通目录',()=>{
    const d=folder();Object.assign(process.env,{DATA_DIR:d,APP_ENV:'development',PROVIDER_MODE:'mock'});delete process.env.RECOVERY_VALIDATION_ONLY;delete process.env.SESSION_SECRET;delete process.env.CONTENT_PROVENANCE_SIGNING_KEY;fs.mkdirSync(recoveryLockPath(d));expect(()=>loadConfig()).toThrow(/运维锁/);expect(fs.existsSync(path.join(d,'.session-secret'))).toBe(false);fs.rmdirSync(recoveryLockPath(d));process.env.RECOVERY_VALIDATION_ONLY='1';expect(()=>loadConfig()).toThrow(/不是具有隔离标记/);policy(d);fs.writeFileSync(path.join(d,'.session-secret'),'s'.repeat(96));fs.writeFileSync(path.join(d,'.provenance-secret'),'p'.repeat(96));expect(loadConfig().recoveryValidationOnly).toBe(true);process.env.APP_ENV='production';expect(()=>loadConfig()).toThrow(/恢复副本/);
  });
});
