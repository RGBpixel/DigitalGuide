import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import type {Restaurant,RestaurantTerminal,ReceptionSession,MemoryView,RecoveryIssue,PrivacyReceipt} from '@digitalguide/contracts';
import {NativeReception,nativeReceptionCookieName} from '../../packages/postgres/src/runtime-reception.js';
import {NativeGuestMemory} from '../../packages/postgres/src/runtime-guest-memory.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeReceptionHelpers,type NativeGuest} from './postgres-reception-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';

let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,h:ReturnType<typeof nativeReceptionHelpers>,p:NativeTestPerson,apiDb:NativePostgresDatabase;
const root='docs/evidence/T20/postgres-food/memory',enrollment={displayName:'原创虚构熟客小溪',roles:['customer'],consent:true,noticeVersion:'memory-v1',retentionDays:30};
async function store(){const venue=randomUUID();await x.owner(db=>db.query('INSERT INTO venues VALUES($1,$2,$3,$4,$5)',[venue,p.tenant,p.workspace,'原创记忆用途场所','Asia/Shanghai']));return h.good<Restaurant>(p,'/restaurant/restaurants',{venueId:venue,name:'原创用途隔离餐厅'});}
async function guest(r:Restaurant):Promise<NativeGuest>{
 const t=await h.good<RestaurantTerminal>(p,'/restaurant/restaurants/'+r.id+'/terminals',{name:'原创熟客自愿终端'}),s=await h.good<ReceptionSession>(p,'/restaurant/terminals/'+t.id+'/session',{action:'open',confirmed:true}),issued=await h.post(p,'/restaurant/terminals/'+t.id+'/access',{sessionId:s.id});expect(issued.statusCode,issued.payload).toBe(200);
 const cookie=issued.cookies.find(c=>c.name===nativeReceptionCookieName(x.result.runtimeId))!,raw=cookie.name+'='+encodeURIComponent(cookie.value),response=await x.app.inject({url:'/api/v1/guest/sessions/'+s.id,headers:{cookie:raw}});expect(response.statusCode,response.payload).toBe(200);const view=response.json().data;return{id:s.id,cookie:raw,headers:{cookie:raw,'x-csrf-token':view.csrfToken},view};
}
async function view(g:NativeGuest){const r=await h.guestGet(g,'/memory');expect(r.statusCode,r.payload).toBe(200);return r.json().data as MemoryView;}
async function apply<T=MemoryView>(g:NativeGuest,path:string,input:object,key=randomUUID()){return h.goodGuest<T>(g,'/memory'+path,{...input,focusVersion:(await h.current(g)).session.focusVersion},key);}
const enroll=(g:NativeGuest,key?:ReturnType<typeof randomUUID>)=>apply(g,'',enrollment,key);
const issue=(g:NativeGuest,v:MemoryView)=>apply<RecoveryIssue>(g,'/recovery',{version:v.person!.version,confirmed:true});
const end=async(g:NativeGuest)=>h.control(g,'end',await h.current(g));
const restore=(g:NativeGuest,code:string,key=randomUUID())=>h.guestPost(g,'/memory/restore',{recoveryCode:code,consent:true,noticeVersion:'memory-v1',focusVersion:0},key);
async function proof(g:NativeGuest){const core=new NativeCoreRepository(apiDb),service=new NativeGuestMemory(core),reception=new NativeReception(core);return{service,reception,credentials:reception.credentials(x.config.sessionSecret,x.result.runtimeId,g.id,decodeURIComponent(g.cookie.slice(g.cookie.indexOf('=')+1)))};}

describe.skipIf(!nativePostgresAvailable)('原生餐厅本人记忆的用途、门店与恢复范围',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture({onInitialized:(result,cluster)=>{const migration='095-native-dining-memory-purpose.sql',file=root+'/purpose-migration-frozen.json',sha256=createHash('sha256').update(fs.readFileSync('migrations/postgres/'+migration)).digest('hex');if(fs.existsSync(file))expect(JSON.parse(fs.readFileSync(file,'utf8')).sha256).toBe(sha256);else fs.writeFileSync(file,JSON.stringify({migration,sha256,firstKnownCommittedAt:new Date().toISOString(),root:cluster.root,runtimeId:result.runtimeId,appliedFilesMayNotBeEdited:true},null,2)+'\n',{flag:'wx'});}});apiDb=await NativePostgresDatabase.open(x.result.api,'api');h=nativeReceptionHelpers(x);},60000);
 beforeEach(async()=>{p=await h.person();});afterAll(async()=>{await apiDb?.close();await x?.close();});

 it('匿名无长期资料，明确同意才建立绑定本店的自述顾客且不授予员工身份',async()=>{
  const r=await store(),g=await guest(r);expect((await view(g)).person).toBeNull();expect(g.view.features?.personalMemory).toBe(true);
  const v=await enroll(g);expect(v.person).toMatchObject({identity:'self_reported',roles:['customer'],personalization:false,doNotDisturb:true});
  const rows=await x.owner(db=>db.query('SELECT p.owner_user_id,p.guest_session_id,s.restaurant_id,s.origin_session_id FROM people p JOIN _dg_native_food_memory_scopes s ON s.person_id=p.id WHERE p.id=$1',[v.person!.id]));expect(rows.rows).toEqual([{owner_user_id:null,guest_session_id:g.id,restaurant_id:r.id,origin_session_id:g.id}]);
 });
 it('并发原键登记只产生一份餐厅用途与同意记录，缓存不保存称呼原文',async()=>{
  const r=await store(),g=await guest(r),key=randomUUID(),rows=await Promise.all(Array.from({length:6},()=>enroll(g,key)));expect(new Set(rows.map(v=>v.person!.id)).size).toBe(1);
  const raw=await x.owner(async db=>({scopes:(await db.query('SELECT person_id FROM _dg_native_food_memory_scopes WHERE origin_session_id=$1',[g.id])).rows,links:(await db.query('SELECT person_id FROM memory_session_links WHERE session_id=$1',[g.id])).rows,cache:(await db.query('SELECT response FROM idempotency WHERE actor_id=$1',['guest:'+g.id])).rows}));expect(raw.scopes).toHaveLength(1);expect(raw.links).toHaveLength(1);expect(JSON.stringify(raw.cache)).not.toContain(enrollment.displayName);
 });
 it('结束后在同店凭本人单次码恢复，保留原资料期限和用途且原码不能重复消费',async()=>{
  const r=await store(),a=await guest(r),v=await enroll(a),code=await issue(a,v);await end(a);const b=await guest(r),response=await restore(b,code.recoveryCode);expect(response.statusCode,response.payload).toBe(200);expect(response.json().data.person).toMatchObject({id:v.person!.id,expiresAt:v.person!.expiresAt});await end(b);const c=await guest(r);expect((await restore(c,code.recoveryCode)).statusCode).toBe(409);expect((await view(c)).person).toBeNull();
  const raw=await x.owner(db=>db.query('SELECT restaurant_id,origin_session_id FROM _dg_native_food_memory_scopes WHERE person_id=$1',[v.person!.id]));expect(raw.rows).toEqual([{restaurant_id:r.id,origin_session_id:a.id}]);
 });
 it('另一门店不能读取恢复描述或直接调用恢复SQL，失败不会消费原码',async()=>{
  const r=await store(),other=await store(),a=await guest(r),v=await enroll(a),code=await issue(a,v);await end(a);const b=await guest(other),q=await proof(b),hash=createHash('sha256').update(code.recoveryCode).digest('hex');
  await expect(apiDb.transaction(()=>q.service.call('dg_native_guest_memory_recovery_meta',[b.id,q.credentials.tokenHash,code.credentialId,hash]))).rejects.toMatchObject({code:'RESTORE_UNAVAILABLE'});
  await expect(apiDb.transaction(()=>q.service.call('dg_native_guest_memory_apply',[b.id,q.credentials.tokenHash,q.credentials.csrfHash,0,'restore',{credentialId:code.credentialId,codeHash:hash,consent:true,noticeVersion:'memory-v1'}]))).rejects.toMatchObject({code:'RESTORE_UNAVAILABLE'});
  expect((await restore(b,code.recoveryCode)).statusCode).toBe(409);expect((await view(b)).person).toBeNull();const c=await guest(r);expect((await restore(c,code.recoveryCode)).statusCode).toBe(200);
 });
 it('同一工作空间的企业前台资料不能恢复到餐厅，餐厅资料也不能恢复到前台',async()=>{
  const r=await store(),front=(await h.guest(p)).guest,frontCode=await issue(front,await enroll(front));await end(front);const dining=await guest(r);expect((await restore(dining,frontCode.recoveryCode)).statusCode).toBe(409);expect((await view(dining)).person).toBeNull();
  const meal=await guest(r),mealCode=await issue(meal,await enroll(meal));await end(meal);const nextFront=(await h.guest(p)).guest;expect((await restore(nextFront,mealCode.recoveryCode)).statusCode).toBe(409);expect((await view(nextFront)).person).toBeNull();
  const originalFront=(await h.guest(p)).guest;expect((await restore(originalFront,frontCode.recoveryCode)).statusCode).toBe(200);
 });
 it('跨租户本人码和其他顾客cookie不能读取资料或恢复，服务端不信任请求中的门店',async()=>{
  const r=await store(),a=await guest(r),code=await issue(a,await enroll(a)),other=await guest(r);expect((await x.app.inject({url:'/api/v1/guest/sessions/'+a.id+'/memory',headers:other.headers})).statusCode).toBe(401);
  expect((await h.guestPost(other,'/memory',{...enrollment,restaurantId:r.id,focusVersion:0})).statusCode).toBe(400);await end(a);const foreign=(await h.guest(await h.person())).guest;expect((await restore(foreign,code.recoveryCode)).statusCode).toBe(409);expect((await view(foreign)).person).toBeNull();
 });
 it('恢复失败次数单独持久保存，五次跨门店尝试后限流且没有本人链接',async()=>{
  const r=await store(),other=await store(),a=await guest(r),code=await issue(a,await enroll(a));await end(a);const b=await guest(other);for(let n=0;n<5;n++)expect((await restore(b,code.recoveryCode)).statusCode).toBe(409);expect((await restore(b,code.recoveryCode)).statusCode).toBe(429);
  const rows=await x.owner(async db=>({attempts:(await db.query('SELECT id FROM _dg_native_guest_memory_attempts WHERE session_id=$1',[b.id])).rows,links:(await db.query('SELECT person_id FROM memory_session_links WHERE session_id=$1',[b.id])).rows}));expect(rows.attempts).toHaveLength(5);expect(rows.links).toHaveLength(0);
 });
 it('本人可以确认和撤回资料、导出与删除，删除原键只返回最小收据且用途守卫不含原文',async()=>{
  const r=await store(),g=await guest(r);let v=await enroll(g);v=await apply(g,'/settings',{version:v.person!.version,displayName:v.person!.displayName,roles:['customer'],personalization:true,doNotDisturb:true,quietStart:'00:00',quietEnd:'00:01',cooldownMinutes:5});
  v=await apply(g,'/facts',{key:'like',value:'原创熟客喜欢清淡口味',visibility:'reception',expiresAt:v.person!.expiresAt});v=await apply(g,'/facts/decide',{factId:v.facts[0].id,version:v.facts[0].version,action:'confirm',confirmed:true});
  const q=await proof(g),context=await apiDb.transaction(()=>q.service.context(g.id,q.credentials.tokenHash));expect(context?.facts.map(f=>f.value)).toContain('原创熟客喜欢清淡口味');expect((await h.guestGet(g,'/memory/export')).payload).toContain('原创熟客喜欢清淡口味');
  v=await apply(g,'/settings',{version:v.person!.version,displayName:v.person!.displayName,roles:['customer'],personalization:false,doNotDisturb:true,quietStart:'00:00',quietEnd:'00:01',cooldownMinutes:5});expect(await apiDb.transaction(()=>q.service.context(g.id,q.credentials.tokenHash))).toBeNull();
  const key=randomUUID(),input={version:v.person!.version,confirmed:true},receipt=await apply<PrivacyReceipt>(g,'/erase',input,key);expect(receipt.status).toBe('completed');expect(await apply(g,'/erase',input,key)).toEqual(receipt);expect((await view(g)).person).toBeNull();
  const raw=await x.owner(async db=>({facts:(await db.query('SELECT id FROM memory_facts WHERE person_id=$1',[v.person!.id])).rows,scope:(await db.query('SELECT * FROM _dg_native_food_memory_scopes WHERE person_id=$1',[v.person!.id])).rows}));expect(raw.facts).toHaveLength(0);expect(raw.scope).toHaveLength(1);expect(JSON.stringify(raw.scope)).not.toContain(enrollment.displayName);
 });
 it('原登记回执只对原cookie与focus有效，转人工后不能继续写入偏好',async()=>{
  const r=await store(),g=await guest(r),v=await enroll(g),q=await proof(g),receipt=(await x.owner(db=>db.query<{id:string}>("SELECT id FROM _dg_native_guest_memory_actions WHERE session_id=$1 AND kind='enroll'",[g.id]))).rows[0].id,other=await guest(r),foreign=await proof(other);
  await expect(apiDb.transaction(()=>foreign.service.result(receipt,foreign.credentials.tokenHash))).rejects.toMatchObject({code:'AUTH_REQUIRED'});expect((await apiDb.transaction(()=>q.service.result<MemoryView>(receipt,q.credentials.tokenHash))).person!.id).toBe(v.person!.id);
  await h.control(g,'handoff',await h.current(g));expect((await h.guestPost(g,'/memory/facts',{key:'like',value:'不可写入的人工接管后正文',visibility:'reception',expiresAt:v.person!.expiresAt,focusVersion:0})).statusCode).toBe(409);
 });
 it('API与worker没有目的表原始读写权，也不能调用绕过用途的旧私有接口',async()=>{
  const sql="SELECT has_table_privilege(current_user,'_dg_native_food_memory_scopes','SELECT') OR has_table_privilege(current_user,'_dg_native_food_memory_scopes','INSERT') OR has_function_privilege(current_user,'dg_native_guest_memory_apply_before_dining_scope(text,text,text,bigint,text,jsonb)','EXECUTE') OR has_function_privilege(current_user,'dg_native_food_memory_scope_matches(text,text)','EXECUTE') AS allowed";
  expect((await apiDb.transaction(()=>apiDb.query<{allowed:boolean}>(sql))).rows[0].allowed).toBe(false);expect((await x.workerDb.transaction(()=>x.workerDb.query<{allowed:boolean}>(sql))).rows[0].allowed).toBe(false);
 });
});
