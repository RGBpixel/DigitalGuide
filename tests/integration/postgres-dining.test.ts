import fs from 'node:fs';
import {createApp} from '../../apps/api/src/app.js';
import {createHash,randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {Restaurant,RestaurantTable,RestaurantTerminal,ReceptionSession,GuestDining,DiningParty,DiningHoldPlan,RestaurantGrant} from '@digitalguide/contracts';
import {NativeDining} from '../../packages/postgres/src/runtime-dining.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {NativeReception,nativeReceptionCookieName} from '../../packages/postgres/src/runtime-reception.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeReceptionHelpers,type NativeGuest} from './postgres-reception-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,h:ReturnType<typeof nativeReceptionHelpers>,p:NativeTestPerson,apiDb:NativePostgresDatabase;
const root='docs/evidence/T20/postgres-dining',fields={name:'原创就餐小组',size:2,visitMinutes:30,guestNote:'原创合成安排'},bodies=new Map<string,Record<string,unknown>>(),digest=(value:string)=>createHash('sha256').update(value).digest('hex');
async function store(extra:object={}){const venue=randomUUID();await x.owner(db=>db.query('INSERT INTO venues VALUES($1,$2,$3,$4,$5)',[venue,p.tenant,p.workspace,'原创预约落座场所','Asia/Shanghai']));return h.good<Restaurant>(p,'/restaurant/restaurants',{venueId:venue,name:'原创预约落座餐厅',...extra});}
const table=(r:Restaurant,code='A1',capacity=4)=>h.good<RestaurantTable>(p,'/restaurant/restaurants/'+r.id+'/tables',{code,name:'原创'+code+'桌',capacity});
async function guest(r:Restaurant,person=p):Promise<NativeGuest>{
 const terminal=await h.good<RestaurantTerminal>(p,'/restaurant/restaurants/'+r.id+'/terminals',{name:'原创独立就餐终端'}),session=await h.good<ReceptionSession>(person,'/restaurant/terminals/'+terminal.id+'/session',{action:'open',confirmed:true}),response=await h.post(person,'/restaurant/terminals/'+terminal.id+'/access',{sessionId:session.id});expect(response.statusCode).toBe(200);const cookie=response.cookies.find(c=>c.name===nativeReceptionCookieName(x.result.runtimeId))!;expect(!!cookie).toBe(true);const raw=cookie.name+'='+encodeURIComponent(cookie.value),loaded=await x.app.inject({url:'/api/v1/guest/sessions/'+session.id,headers:{cookie:raw}});expect(loaded.statusCode).toBe(200);const view=loaded.json().data;return{id:session.id,cookie:raw,headers:{cookie:raw,'x-csrf-token':view.csrfToken},view};
}
async function dining(g:NativeGuest){const response=await h.guestGet(g,'/dining');expect(response.statusCode,response.payload).toBe(200);return response.json().data as GuestDining;}
async function input(g:NativeGuest,path:string,body:object,key=randomUUID()){let original=bodies.get(key);if(!original){const current=await dining(g);original={...body,...(path==='/table-plan'?{}:{confirmed:true}),focusVersion:current.focusVersion,selectionVersion:current.selectionVersion};bodies.set(key,original);}return original;}
async function post(g:NativeGuest,path:string,body:object,key=randomUUID()){return h.guestPost(g,'/dining'+path,await input(g,path,body,key),key);}
async function good<T=DiningParty>(g:NativeGuest,path:string,body:object,key=randomUUID()):Promise<T>{
 const request=await input(g,path,body,key),response=await h.guestPost(g,'/dining'+path,request,key);
 if(response.statusCode===503&&['/parties','/table-plan','/claim'].includes(path)){
  const core=new NativeCoreRepository(apiDb),reception=new NativeReception(core),proof=reception.credentials(x.config.sessionSecret,x.result.runtimeId,g.id,decodeURIComponent(g.cookie.slice(g.cookie.indexOf('=')+1))),current=await dining(g);
  await apiDb.transaction(async()=>{
   try{
    const service=new NativeDining(core,x.config.sessionSecret),frame={id:g.id,...proof,focusVersion:current.focusVersion};
    const operation=await service.apply(path==='/table-plan'?'party':'restaurant',path==='/table-plan'?String(request.partyId):current.restaurant.id,path==='/table-plan'?'plan':path==='/claim'?'claim':'create',request,frame);
    await service.result(operation,frame);await apiDb.query('SET CONSTRAINTS ALL IMMEDIATE');
   }catch(error){
    const e=error as{code?:string;message?:string;where?:string};
    console.log(JSON.stringify({stage:'native_dining_diagnostic',path,code:e.code,message:e.message,where:e.where?.slice(0,1800),rawCredentialLogged:false}));throw error;
   }
   throw new Error('Diagnostic transaction must roll back');
  });
 }
 expect(response.statusCode,response.payload).toBe(200);return response.json().data as T;
}
async function seat(g:NativeGuest,party:DiningParty){const plan=await good<DiningHoldPlan>(g,'/table-plan',{partyId:party.id,version:party.version,tableId:null}),held=await good(g,'/table-holds',{planId:plan.id,planHash:plan.hash});return good(g,'/table-holds/'+held.occupancy!.id+'/seat',{version:held.occupancy!.version,partyVersion:held.version});}
const config=(r:Restaurant)=>({name:r.name,publicGuide:r.publicGuide,profileId:r.profileId,sceneAppId:r.sceneAppId,holdSeconds:r.holdSeconds,visitMinutes:r.visitMinutes,lateMinutes:r.lateMinutes,acceptingGuests:r.acceptingGuests,openingWindows:r.openingWindows,version:r.version});
describe.skipIf(!nativePostgresAvailable)('原生预约排队、固定桌台方案、本人就餐凭证与实际落座',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture({onInitialized:(result,cluster)=>{for(const[migration,leaf]of [['090-native-dining.sql','migration-frozen.json'],['091-native-dining-clock.sql','clock-frozen.json'],['092-native-dining-claim-owner.sql','claim-frozen.json'],['093-native-dining-operation-variable.sql','operation-frozen.json']]){const file=root+'/'+leaf,sha256=createHash('sha256').update(fs.readFileSync('migrations/postgres/'+migration)).digest('hex');if(fs.existsSync(file))expect(JSON.parse(fs.readFileSync(file,'utf8')).sha256).toBe(sha256);else fs.writeFileSync(file,JSON.stringify({migration,sha256,firstKnownCommittedAt:new Date().toISOString(),root:cluster.root,runtimeId:result.runtimeId,appliedFilesMayNotBeEdited:true},null,2)+'\n',{flag:'wx'});}}}).catch(error=>{const e=error as{code?:string;position?:string;where?:string};console.log(JSON.stringify({stage:'native_dining_init',code:e.code,position:e.position,where:e.where?.slice(0,1400),rawCredentialLogged:false}));throw error;});apiDb=await NativePostgresDatabase.open(x.result.api,'api');h=nativeReceptionHelpers(x);},60000);
 beforeEach(async()=>{p=await h.person();});afterAll(async()=>{await apiDb?.close();await x?.close();});
 it('顾客主动确认才创建本组排队，号次持久增长且原键重放不重复创建或改变问答对象',async()=>{
  const r=await store(),g=await guest(r),key=randomUUID(),a=await good(g,'/parties',fields,key),b=await good(g,'/parties',fields,key);expect(a.id).toBe(b.id);expect(a.queueNumber).toBe(1);expect(a.status).toBe('waiting');expect(digest(a.claimCode!)).toBe(digest(b.claimCode!));const current=await dining(g);expect(current.selectionVersion).toBe(1);expect(current.selectedPartyId).toBe(a.id);expect(current.parties.length).toBe(1);expect('_claim'in current.parties[0]).toBe(false);expect(current.restaurant.capabilities?.preferences).toBe(false);
  const second=await good(g,'/parties',{...fields,name:'原创第二组'});expect(second.queueNumber).toBe(2);expect((await post(g,'/parties',fields,key)).statusCode).toBe(409);expect((await dining(g)).selectedPartyId).toBe(second.id);
 });
 it('经理与迎宾职责按门店复核，后厨、其他组织及其他顾客均不能读取或修改本组',async()=>{
  const r=await store(),g=await guest(r),party=await good(g,'/parties',fields),other=await guest(r),kitchen=await h.colleague(p,'viewer'),host=await h.colleague(p,'viewer'),foreign=await h.person();for(const[m,role]of [[kitchen,'kitchen'],[host,'host']]as const)await h.good<RestaurantGrant[]>(p,'/restaurant/restaurants/'+r.id+'/staff',{userId:m.user,role,version:0,enabled:true,expiresAt:null});
  for(const person of [kitchen,foreign])expect((await x.app.inject({url:'/api/v1/restaurant/parties/'+party.id,headers:person.headers})).statusCode).toBe(404);expect((await h.get<DiningParty>(host,'/restaurant/parties/'+party.id)).id).toBe(party.id);expect((await post(other,'/parties/'+party.id+'/cancel',{version:party.version})).statusCode).toBe(404);
 });
 it('同一桌的并发预约最多一方成功，相邻半开区间可以预约且无半份排队记录',async()=>{
  const r=await store(),t=await table(r),a=await guest(r),b=await guest(r),start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString(),body={party:fields,tableId:t.id,startsAt:start,endsAt:end},results=await Promise.all([post(a,'/reservations',body),post(b,'/reservations',body)]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
  const next=await good(b,'/reservations',{...body,startsAt:end,endsAt:new Date(Date.parse(end)+3600000).toISOString()});expect(next.reservation?.startsAt).toBe(end);expect(await x.owner(async db=>(await db.query('SELECT count(*)::int n FROM dining_parties WHERE restaurant_id=$1',[r.id])).rows[0].n)).toBe(2);
 });
 it('两个顾客竞争同一桌时旧方案被版本拒绝，实际入座不会被另一组覆盖',async()=>{
  const r=await store();await table(r);const a=await guest(r),b=await guest(r),pa=await good(a,'/parties',fields),pb=await good(b,'/parties',fields),planA=await good<DiningHoldPlan>(a,'/table-plan',{partyId:pa.id,version:pa.version,tableId:null}),planB=await good<DiningHoldPlan>(b,'/table-plan',{partyId:pb.id,version:pb.version,tableId:null}),requests=await Promise.all([post(a,'/table-holds',{planId:planA.id,planHash:planA.hash}),post(b,'/table-holds',{planId:planB.id,planHash:planB.hash})]);expect(requests.map(r=>r.statusCode).sort()).toEqual([200,409]);const index=requests.findIndex(r=>r.statusCode===200),holder=[a,b][index],held=requests[index].json().data as DiningParty,seated=await good(holder,'/table-holds/'+held.occupancy!.id+'/seat',{version:held.occupancy!.version,partyVersion:held.version});expect(seated.status).toBe('seated');expect(seated.occupancy?.state).toBe('seated');expect(seated.occupancy?.expiresAt).toBeNull();
 });
 it('切换就餐问答组后旧方案和旧选择确认不能继续操作，即使返回原组也不复活旧方案',async()=>{
  const r=await store();await table(r);const g=await guest(r),a=await good(g,'/parties',fields),plan=await good<DiningHoldPlan>(g,'/table-plan',{partyId:a.id,version:a.version,tableId:null}),b=await good(g,'/parties',{...fields,name:'原创同行第二组'});expect((await post(g,'/table-holds',{planId:plan.id,planHash:plan.hash})).statusCode).toBe(409);await good(g,'/parties/'+a.id+'/select',{version:a.version});expect((await post(g,'/table-holds',{planId:plan.id,planHash:plan.hash})).statusCode).toBe(409);expect((await dining(g)).parties.some(p=>p.id===b.id)).toBe(true);
 });
 it('预约改期轮换私有凭证，改期和入座均不返回内部nonce或哈希',async()=>{
  const r=await store();await table(r);const g=await guest(r),start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString(),a=await good(g,'/reservations',{party:fields,tableId:null,startsAt:start,endsAt:end}),updated=await good(g,'/reservations/'+a.reservation!.id+'/update',{party:fields,tableId:null,startsAt:new Date(Date.parse(start)+86400000).toISOString(),endsAt:new Date(Date.parse(end)+86400000).toISOString(),version:a.reservation!.version,partyVersion:a.version});expect(digest(updated.claimCode!)).not.toBe(digest(a.claimCode!));expect('_claim'in updated).toBe(false);expect(updated.accessVersion).toBe(a.accessVersion+1);
 });
 it('实际入座只能由店员结束，桌位转待清洁后才可显式重新开放',async()=>{
  const r=await store(),t=await table(r),g=await guest(r),party=await good(g,'/parties',fields),seated=await seat(g,party);expect((await post(g,'/parties/'+seated.id+'/cancel',{version:seated.version})).statusCode).toBe(409);const ended=await h.good<DiningParty>(p,'/restaurant/parties/'+seated.id+'/finish',{version:seated.version,confirmed:true});expect(ended.status).toBe('completed');const tables=await h.get<RestaurantTable[]>(p,'/restaurant/restaurants/'+r.id+'/tables'),current=tables.find(row=>row.id===t.id)!;expect(current.state).toBe('cleaning');const opened=await h.good<RestaurantTable>(p,'/restaurant/tables/'+t.id+'/state',{version:current.version,action:'open',confirmed:true});expect(opened.state).toBe('available');
 });
 it('已有排队后仍可修改门店配置，暂停迎宾阻止新组且不删除已有就餐事实',async()=>{
  let r=await store();const g=await guest(r),party=await good(g,'/parties',fields);r=await h.good<Restaurant>(p,'/restaurant/restaurants/'+r.id+'/update',{...config(r),acceptingGuests:false});expect((await post(g,'/parties',fields)).statusCode).toBe(409);expect((await dining(g)).parties[0].id).toBe(party.id);expect(r.acceptingGuests).toBe(false);
 });
 it('结束对话仍保留就餐事实，凭私有码只转移本人本组，旧码失效且原键恢复不延长时钟',async()=>{
  const r=await store(),a=await guest(r),party=await good(a,'/parties',fields);await h.control(a,'end',await h.current(a));const b=await guest(r),key=randomUUID(),claimed=await good(b,'/claim',{code:party.claimCode},key),before=await h.current(b),again=await good(b,'/claim',{code:party.claimCode},key),after=await h.current(b);expect(claimed.id).toBe(party.id);expect(again.id).toBe(party.id);expect(digest(claimed.claimCode!)).toBe(digest(again.claimCode!));expect(digest(claimed.claimCode!)).not.toBe(digest(party.claimCode!));expect(after.session.activityAt).toBe(before.session.activityAt);expect(after.session.expiresAt).toBe(before.session.expiresAt);const c=await guest(r);expect((await post(c,'/claim',{code:party.claimCode})).statusCode).toBe(404);expect((await dining(c)).parties.length).toBe(0);
 });
 it('私人凭证恢复仍保留原预留截止时间，原终端及其旧操作不能再操作该组',async()=>{
  const r=await store({holdSeconds:600});await table(r);const a=await guest(r),party=await good(a,'/parties',fields),plan=await good<DiningHoldPlan>(a,'/table-plan',{partyId:party.id,version:party.version,tableId:null}),held=await good(a,'/table-holds',{planId:plan.id,planHash:plan.hash}),b=await guest(r),claimed=await good(b,'/claim',{code:held.claimCode});expect(claimed.occupancy?.id).toBe(held.occupancy?.id);expect(claimed.occupancy?.expiresAt).toBe(held.occupancy?.expiresAt);expect(claimed.occupancy?.expectedEndAt).toBe(held.occupancy?.expectedEndAt);expect((await dining(a)).parties.length).toBe(0);expect((await post(a,'/parties/'+party.id+'/cancel',{version:claimed.version})).statusCode).toBe(404);
 });
 it('API和worker没有原始就餐表读写权限，也不能调用私有凭证或状态核心',async()=>{
  const r=await store(),g=await guest(r),party=await good(g,'/parties',fields);for(const db of [apiDb,x.workerDb]){await expect(db.query('SELECT claim_nonce FROM dining_parties WHERE id=$1',[party.id])).rejects.toThrow();await expect(db.query('UPDATE dining_parties SET version=version+1 WHERE id=$1',[party.id])).rejects.toThrow();await expect(db.query('SELECT dg_native_dining_ticket_fields($1,$2)',[JSON.stringify({}),party.id])).rejects.toThrow();}
 });
 it('无效时长、超容量和营业窗口外预约均不留下半份就餐记录',async()=>{
  const r=await store();await table(r);const g=await guest(r),start=new Date(Date.now()+7200000).toISOString();
  for(const request of [
   {party:fields,tableId:null,startsAt:start,endsAt:new Date(Date.parse(start)+14400001).toISOString()},
   {party:{...fields,size:5},tableId:null,startsAt:start,endsAt:new Date(Date.parse(start)+1800000).toISOString()}
  ])expect((await post(g,'/reservations',request)).statusCode).toBe(409);
  const localMinute=(new Date(start).getUTCHours()*60+new Date(start).getUTCMinutes()+480)%1440;
  const closedMinute=(localMinute+720)%1440;
  await h.good(p,'/restaurant/restaurants/'+r.id+'/update',{...config(r),openingWindows:[{days:[0,1,2,3,4,5,6],startMinute:closedMinute,endMinute:closedMinute+1}]});
  expect((await post(g,'/reservations',{party:fields,tableId:null,startsAt:start,endsAt:new Date(Date.parse(start)+1800000).toISOString()})).statusCode).toBe(409);
  expect((await dining(g)).parties.length).toBe(0);
 });
 it('到店签到只在原预约窗口内开放，签到后取得排队号并可实际入座',async()=>{
  const r=await store();await table(r);const a=await guest(r),start=new Date(Date.now()+600000).toISOString(),reserved=await good(a,'/reservations',{party:fields,tableId:null,startsAt:start,endsAt:new Date(Date.parse(start)+1800000).toISOString()});
  const arrived=await good(a,'/reservations/'+reserved.reservation!.id+'/check-in',{version:reserved.reservation!.version});
  expect(arrived.status).toBe('waiting');expect(arrived.queueNumber).toBe(1);expect(arrived.reservation?.status).toBe('checked_in');expect((await seat(a,arrived)).status).toBe('seated');
  const b=await guest(r),future=new Date(Date.now()+14400000).toISOString(),later=await good(b,'/reservations',{party:fields,tableId:null,startsAt:future,endsAt:new Date(Date.parse(future)+1800000).toISOString()});
  expect((await post(b,'/reservations/'+later.reservation!.id+'/check-in',{version:later.reservation!.version})).statusCode).toBe(409);
  expect((await dining(b)).parties[0].status).toBe('reserved');
 });
 it('同一个私有码并发恢复只成功一次，旧终端和失败一方都不再拥有该组',async()=>{
  const r=await store(),a=await guest(r),party=await good(a,'/parties',fields),b=await guest(r),c=await guest(r);
  const responses=await Promise.all([post(b,'/claim',{code:party.claimCode}),post(c,'/claim',{code:party.claimCode})]);
  expect(responses.map(row=>row.statusCode).sort()).toEqual([200,404]);
  expect((await dining(a)).parties.length).toBe(0);
  expect((await dining(b)).parties.length+(await dining(c)).parties.length).toBe(1);
 });
 it('错误凭证尝试独立持久化，原键不消耗第二次额度且不能延长会话时钟',async()=>{
  const r=await store(),g=await guest(r),before=await h.current(g),key=randomUUID();
  const code='ND1.'+randomUUID()+'.'+'a'.repeat(43),body=await input(g,'/claim',{code},key);
  expect((await post(g,'/claim',{code},key)).statusCode).toBe(404);
  expect((await post(g,'/claim',{code},key)).statusCode).toBe(404);
  for(let i=0;i<4;i++)expect((await post(g,'/claim',{code})).statusCode).toBe(404);
  expect((await post(g,'/claim',{code})).statusCode).toBe(429);
  expect((await post(g,'/claim',{code},key)).statusCode).toBe(404);
  expect((await h.guestPost(g,'/dining/claim',{...body,code:'ND1.'+randomUUID()+'.'+'b'.repeat(43)},key)).statusCode).toBe(409);
  const after=await h.current(g);expect(after.session.activityAt).toBe(before.session.activityAt);expect(after.session.expiresAt).toBe(before.session.expiresAt);
  await x.owner(async db=>expect(Number((await db.query('SELECT count(*) value FROM _dg_native_dining_claim_attempts WHERE session_id=$1',[g.id])).rows[0].value)).toBe(5));
 });
 it('企业访客不能进入餐厅业务，顾客缺少CSRF或选择版本时不能新建排队',async()=>{
  const enterprise=(await h.guest(p)).guest;
  expect((await h.guestGet(enterprise,'/dining')).statusCode).toBe(404);
  const r=await store(),g=await guest(r),body=await input(g,'/parties',fields);
  const missingCsrf=await x.app.inject({method:'POST',url:'/api/v1/guest/sessions/'+g.id+'/dining/parties',headers:{cookie:g.cookie,'idempotency-key':randomUUID()},payload:body});
  expect(missingCsrf.statusCode).toBe(403);
  const {selectionVersion:ignored,...missingVersion}=body;expect(ignored).toBe(0);
  expect((await h.guestPost(g,'/dining/parties',missingVersion)).statusCode).toBe(400);expect((await dining(g)).parties.length).toBe(0);
 });
 it('迎宾职责撤回再授予后旧键及旧桌台方案都不能复活',async()=>{
  const r=await store();await table(r);const host=await h.colleague(p,'viewer');
  const grant=async(version:number,enabled:boolean)=>h.good<RestaurantGrant[]>(p,'/restaurant/restaurants/'+r.id+'/staff',{userId:host.user,role:'host',version,enabled,expiresAt:null});
  await grant(0,true);const key=randomUUID(),body={...fields,confirmed:true},party=await h.good<DiningParty>(host,'/restaurant/restaurants/'+r.id+'/parties',body,key);
  const plan=await h.good<DiningHoldPlan>(host,'/restaurant/restaurants/'+r.id+'/table-plan',{partyId:party.id,version:party.version,tableId:null});
  await grant(1,false);await grant(2,true);
  expect((await h.post(host,'/restaurant/restaurants/'+r.id+'/parties',body,key)).statusCode).toBe(409);
  expect((await h.post(host,'/restaurant/table-holds',{planId:plan.id,planHash:plan.hash,confirmed:true})).statusCode).toBe(409);
  expect((await h.get<DiningParty>(host,'/restaurant/parties/'+party.id)).status).toBe('waiting');
 });
 it('私有预览同步开放店员和顾客的落座界面能力，仍不声称点单支付或个人记忆已连接',async()=>{
  const r=await store(),g=await guest(r),app=await createApp({...x.config,nativeDiningUiPreview:true});
  try{
   const staff=await app.inject({url:'/api/v1/restaurant/restaurants/'+r.id,headers:p.headers}),guestView=await app.inject({url:'/api/v1/guest/sessions/'+g.id,headers:g.headers});
   expect(staff.statusCode).toBe(200);expect(staff.json().data.capabilities).toMatchObject({seating:true,preferences:false,ordering:false,payments:false,hospitality:false});
   expect(guestView.statusCode).toBe(200);expect(guestView.json().data.features).toMatchObject({dining:true,personalMemory:false,visitRegistration:false});
   expect((await h.current(g)).features?.dining).toBe(true);
   const view=guestView.json().data,response=await app.inject({method:'POST',url:'/api/v1/guest/sessions/'+g.id+'/messages',headers:{...g.headers,'idempotency-key':randomUUID()},payload:{text:'我想预约和点单',version:view.session.version,focusVersion:view.session.focusVersion,source:'typed'}});
   expect(response.statusCode,response.payload).toBe(200);const text=response.json().data.session.messages.at(-1).text;expect(text).toContain('核对并提交预约');expect(text).toContain('尚未启用');expect((await dining(g)).parties.length).toBe(0);
  }finally{await app.close();}
 });
 it('直接传入预览配置也不能绕过生产、真实提供商及SQLite限制',async()=>{
  for(const config of [{...x.config,nativeDiningUiPreview:true as const,providerMode:'live' as const},{...x.config,nativeDiningUiPreview:true as const,appEnv:'production' as const}])await expect(createApp(config)).rejects.toMatchObject({code:'PG_RUNTIME_MODE_INVALID'});
  await expect(createApp({...x.config,nativePostgres:undefined,nativeDiningUiPreview:true})).rejects.toMatchObject({code:'NATIVE_PREVIEW_MODE_INVALID'});
 });
});
