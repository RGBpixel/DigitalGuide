import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {createApp} from '../../apps/api/src/app.js';
import {recoveryLockPath,recoveryPolicyFile} from '../../packages/recovery/src/guard.js';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';

describe.skipIf(!nativePostgresAvailable)('真实原生PostgreSQL维护与恢复隔离',()=>{
 let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,api:NativePostgresDatabase,originalKeys:string[],originalConfigs:string[];
 const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const keys=()=>['.session-secret','.provenance-secret'].map(n=>hash(path.join(x.result.api.dataDir,n)));
 const configs=()=>['api.json','worker.json', '.dg-native-postgres.json'].map(n=>hash(path.join(x.result.api.dataDir,n)));
 const lock=()=>recoveryLockPath(x.result.api.dataDir),marker=()=>path.join(x.result.api.dataDir,recoveryPolicyFile);
 const quarantine=()=>fs.writeFileSync(marker(),JSON.stringify({version:1,complete:true,activation:'isolated-validation-only',backupId:randomUUID(),archiveSHA256:'b'.repeat(64)}),{flag:'wx'});
 function clearMarker(){if(fs.existsSync(marker()))fs.unlinkSync(marker());}
 async function absent(token:string){await x.owner(async c=>expect((await c.query('SELECT 1 FROM auth_sessions WHERE token_hash=$1',[token])).rowCount).toBe(0));}
 async function insert(token:string){await api.query("INSERT INTO auth_sessions VALUES ($1,$2,'synthetic','2099-01-01','mock','development')",[token,f.adminA]);}
 beforeAll(async()=>{x=await nativeRuntimeFixture();api=await NativePostgresDatabase.open(x.result.api,'api');originalKeys=keys();originalConfigs=configs();},90000);
 afterAll(async()=>{try{if(x){clearMarker();if(fs.existsSync(lock()))fs.rmdirSync(lock());await api?.close();expect(keys()).toEqual(originalKeys);expect(configs()).toEqual(originalConfigs);}}finally{await x?.close();}},45000);

 it('程序化API创建与两个直接角色均不能绕过维护锁',async()=>{
  fs.mkdirSync(lock());try{
   for(const[config,role]of [[x.result.api,'api'],[x.result.worker,'worker']] as const)await expect(NativePostgresDatabase.open(config,role)).rejects.toMatchObject({code:'PG_RUNTIME_MAINTENANCE'});
   await expect(createApp(x.config)).rejects.toMatchObject({code:'PG_RUNTIME_MAINTENANCE'});
  }finally{fs.rmdirSync(lock());}
 });
 it('已打开的API池和worker领取拒绝新工作，HTTP提供清晰503且无敏感路径',async()=>{
  fs.mkdirSync(lock());try{
   let called=false;await expect(api.transaction(async()=>{called=true;})).rejects.toMatchObject({code:'PG_RUNTIME_MAINTENANCE',status:503});expect(called).toBe(false);
   await expect(x.repo.claim('mock-local',3)).rejects.toMatchObject({code:'PG_RUNTIME_MAINTENANCE',status:503});
   const response=await x.app.inject({method:'POST',url:'/api/v1/auth/login',payload:{accountId:f.adminA}});
   expect(response.statusCode).toBe(503);expect(response.json().error.code).toBe('PG_RUNTIME_MAINTENANCE');expect(response.payload).not.toContain(x.cluster.root);expect(response.payload).not.toContain(x.result.api.connection.passwordFile);
  }finally{fs.rmdirSync(lock());}
 });
 it('事务已写入后出现维护锁，提交前拒绝并实际回滚',async()=>{
  const token=randomUUID();try{await expect(api.transaction(async()=>{await insert(token);fs.mkdirSync(lock());})).rejects.toMatchObject({code:'PG_RUNTIME_MAINTENANCE',status:503});await absent(token);}finally{fs.rmdirSync(lock());}
 });
 it('真实暂停的在途事务遇到恢复标记，恢复执行后回滚而非提交',async()=>{
  const token=randomUUID();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const pending=api.transaction(async()=>{await insert(token);entered();await gate;});
  const checked=expect(pending).rejects.toMatchObject({code:'PG_RUNTIME_RECOVERY_ISOLATED',status:503});
  try{await started;quarantine();release();await checked;await absent(token);}finally{release();clearMarker();await pending.catch(()=>undefined);}
 });
 it('调用方捕获内层隔离异常并移除标记，原外层事务仍必须回滚',async()=>{
  const token=randomUUID();try{
   await expect(api.transaction(async()=>{await insert(token);quarantine();try{await api.transaction(async()=>{throw new Error('must not enter');});}catch(error){expect(error).toMatchObject({code:'PG_RUNTIME_RECOVERY_ISOLATED'});clearMarker();}})).rejects.toMatchObject({code:'PG_RUNTIME_RECOVERY_ISOLATED',status:503});
   await absent(token);
  }finally{clearMarker();}
 });
 it('有效恢复标记拒绝程序化API、直接连接和既有池，worker不领取任务',async()=>{
  quarantine();try{
   for(const[config,role]of [[x.result.api,'api'],[x.result.worker,'worker']] as const)await expect(NativePostgresDatabase.open(config,role)).rejects.toMatchObject({code:'PG_RUNTIME_RECOVERY_ISOLATED'});
   await expect(createApp(x.config)).rejects.toMatchObject({code:'PG_RUNTIME_RECOVERY_ISOLATED'});
   await expect(createApp({...x.config,recoveryValidationOnly:true})).rejects.toMatchObject({code:'PG_RUNTIME_MODE_INVALID'});
   await expect(api.transaction(()=>api.query('SELECT 1'),true)).rejects.toMatchObject({code:'PG_RUNTIME_RECOVERY_ISOLATED'});
   await expect(x.repo.claim('mock-local',3)).rejects.toMatchObject({code:'PG_RUNTIME_RECOVERY_ISOLATED'});
   const response=await x.app.inject({method:'POST',url:'/api/v1/auth/login',payload:{accountId:f.adminA}});expect(response.statusCode).toBe(503);expect(response.json().error.code).toBe('PG_RUNTIME_RECOVERY_ISOLATED');
  }finally{clearMarker();}
 });
 it('故障注入结束后原实例正常读写且两密钥、配置与495表保持',async()=>{
  const headers=await x.login();expect((await x.app.inject({url:'/api/v1/me',headers})).statusCode).toBe(200);
  await x.owner(async c=>expect((await c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname=$1",[x.result.schema])).rows[0].n).toBe(495));
  expect(keys()).toEqual(originalKeys);expect(configs()).toEqual(originalConfigs);
 });
});
