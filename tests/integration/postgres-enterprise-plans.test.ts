import {describe,it,beforeAll,afterAll,expect} from 'vitest';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativePlanFixture} from './enterprise-plan-fixtures.js';
import {enterprisePlanContract} from './enterprise-plan-contract.js';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {randomUUID} from 'node:crypto';
describe.skipIf(!nativePostgresAvailable)('原生PG18持久套餐、席位及核心任务准入',()=>enterprisePlanContract(nativePlanFixture,'postgres'));
describe.skipIf(!nativePostgresAvailable)('原生套餐元数据独立核对',()=>{
 let x:Awaited<ReturnType<typeof nativePlanFixture>>;
 beforeAll(async()=>{x=await nativePlanFixture();},120000);
 afterAll(async()=>x?.close(),60000);
 it('原生共享接口元数据要求当前登录，暴露明确确认、版本和幂等字段',async()=>{
  expect((await x.app.inject({url:'/api/v1/openapi.json'})).statusCode).toBe(401);
  const headers=await x.login(f.adminA),r=await x.app.inject({url:'/api/v1/openapi.json',headers});expect(r.statusCode,r.payload).toBe(200);
  const spec=r.json().data,path=spec.paths['/enterprise/plans/assign'].post;expect(path.requestBody.content['application/json'].schema.properties.confirmSandboxPolicy.const).toBe(true);expect(path.parameters.some((p:{name:string;required:boolean})=>p.name==='Idempotency-Key'&&p.required)).toBe(true);expect(path.requestBody.content['application/json'].schema.properties.expectedRevision.minimum).toBe(0);
 });
 it('原生两API并发提交受沙箱日额度约束，不把组织安全上限当作可用权益',async()=>{
  const headers=await x.login(f.adminA),post=(app:typeof x.app,path:string,payload:object)=>app.inject({method:'POST',url:'/api/v1/'+path,headers:{...headers,'idempotency-key':randomUUID()},payload});
  const assigned=await post(x.app,'enterprise/plans/assign',{workspaceId:f.workspaceA,planId:'sandbox_basic',termDays:7,expectedRevision:0,confirmSandboxPolicy:true});expect(assigned.statusCode,assigned.payload).toBe(200);
  const responses=await Promise.all(Array.from({length:11},(_,i)=>post(i%2?x.second:x.app,'jobs',{workspaceId:f.workspaceA,kind:'provider.check'})));expect(responses.filter(r=>r.statusCode===202)).toHaveLength(10);expect(responses.filter(r=>r.statusCode===409&&r.json().error.code==='QUOTA_EXCEEDED')).toHaveLength(1);
  const read=await x.app.inject({url:'/api/v1/enterprise/plans?workspaceId='+f.workspaceA,headers});expect(read.json().data.quota).toMatchObject({coreJobsToday:10,effectiveDailyLimit:10,legacySafetyDailyLimit:100});
 });
 it('原生管理员撤权后原cookie不能重放已授权的套餐或席位操作',async()=>{
  const headers=await x.login(f.adminA);await x.query("UPDATE memberships SET role='viewer' WHERE user_id=?",f.adminA);
  const read=await x.app.inject({url:'/api/v1/enterprise/plans?workspaceId='+f.workspaceA,headers}),write=await x.app.inject({method:'POST',url:'/api/v1/enterprise/plans/assign',headers:{...headers,'idempotency-key':randomUUID()},payload:{workspaceId:f.workspaceA,planId:'sandbox_enterprise',termDays:90,expectedRevision:1,confirmSandboxPolicy:true}});expect([401,403]).toContain(read.statusCode);expect([401,403]).toContain(write.statusCode);
  expect((await x.query('SELECT plan_id FROM enterprise_plan_assignments WHERE tenant_id=? AND app_env=?',f.tenantA,'development'))[0].plan_id).toBe('sandbox_basic');
 });
});
