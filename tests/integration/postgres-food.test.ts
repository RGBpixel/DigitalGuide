import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {Restaurant,RestaurantTerminal,ReceptionSession,GuestDining,DiningParty,DiningRecommendation,RestaurantGrant,StaffMenu} from '@digitalguide/contracts';
import {NativeFood} from '../../packages/postgres/src/runtime-food.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {NativeReception,nativeReceptionCookieName} from '../../packages/postgres/src/runtime-reception.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeReceptionHelpers,type NativeGuest} from './postgres-reception-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';

let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,h:ReturnType<typeof nativeReceptionHelpers>,p:NativeTestPerson,apiDb:NativePostgresDatabase;
const root='docs/evidence/T20/postgres-food',fields={name:'原创本次口味同行',size:2,visitMinutes:60,guestNote:''};
const preferences=(extra:object={})=>({likes:[],avoids:[],allergens:[],allergyMode:'not_provided',maxSpice:null,budgetPerDishMinor:null,note:'',...extra});
async function store(){const venue=randomUUID();await x.owner(db=>db.query('INSERT INTO venues VALUES($1,$2,$3,$4,$5)',[venue,p.tenant,p.workspace,'原创口味确认场所','Asia/Shanghai']));return h.good<Restaurant>(p,'/restaurant/restaurants',{venueId:venue,name:'原创本次偏好餐厅'});}
async function guest(r:Restaurant):Promise<NativeGuest>{
 const t=await h.good<RestaurantTerminal>(p,'/restaurant/restaurants/'+r.id+'/terminals',{name:'原创当前口味终端'}),s=await h.good<ReceptionSession>(p,'/restaurant/terminals/'+t.id+'/session',{action:'open',confirmed:true}),issued=await h.post(p,'/restaurant/terminals/'+t.id+'/access',{sessionId:s.id});expect(issued.statusCode).toBe(200);
 const cookie=issued.cookies.find(c=>c.name===nativeReceptionCookieName(x.result.runtimeId))!,raw=cookie.name+'='+encodeURIComponent(cookie.value),response=await x.app.inject({url:'/api/v1/guest/sessions/'+s.id,headers:{cookie:raw}});expect(response.statusCode).toBe(200);const view=response.json().data;return{id:s.id,cookie:raw,headers:{cookie:raw,'x-csrf-token':view.csrfToken},view};
}
async function dining(g:NativeGuest){const r=await h.guestGet(g,'/dining');expect(r.statusCode,r.payload).toBe(200);return r.json().data as GuestDining;}
async function input(g:NativeGuest,suffix:string,body:object){const v=await dining(g);return{...(suffix.endsWith('/preferences')?{importId:null,sourceFactIds:[]}:{}),...body,...(suffix.endsWith('/recommendations')?{}:{confirmed:true}),focusVersion:v.focusVersion,selectionVersion:v.selectionVersion};}
async function post(g:NativeGuest,suffix:string,body:object,key=randomUUID()){return h.guestPost(g,'/dining'+suffix,await input(g,suffix,body),key);}
async function good<T=DiningParty>(g:NativeGuest,suffix:string,body:object,key=randomUUID()):Promise<T>{
 const request=await input(g,suffix,body),response=await h.guestPost(g,'/dining'+suffix,request,key);
 if(response.statusCode===503&&/\/(preferences|preferences\/confirm|recommendations)$/.test(suffix)){
  const core=new NativeCoreRepository(apiDb),reception=new NativeReception(core),proof=reception.credentials(x.config.sessionSecret,x.result.runtimeId,g.id,decodeURIComponent(g.cookie.slice(g.cookie.indexOf('=')+1))),view=await dining(g);
  await apiDb.transaction(async()=>{try{const service=new NativeFood(core,x.config.sessionSecret),frame={id:g.id,...proof,focusVersion:view.focusVersion},operation=await service.applyFood(suffix.split('/')[2],suffix.endsWith('/recommendations')?'recommend':suffix.endsWith('/confirm')?'confirm':'draft',request,frame);await service.foodResult(operation,frame);await apiDb.query('SET CONSTRAINTS ALL IMMEDIATE');}catch(error){const e=error as{code?:string;message?:string;where?:string};console.log(JSON.stringify({stage:'native_food_diagnostic',code:e.code,message:e.message,where:e.where?.slice(0,1800),rawInputOrCredentialsLogged:false}));throw error;}throw new Error('Diagnostic transaction must roll back');});
 }
 expect(response.statusCode,response.payload).toBe(200);return response.json().data as T;
}
const party=(g:NativeGuest,name=fields.name)=>good(g,'/parties',{...fields,name});
const draft=(g:NativeGuest,p:DiningParty,value=preferences(),key=randomUUID())=>good(g,'/parties/'+p.id+'/preferences',{version:p.version,preferences:value},key);
const confirm=(g:NativeGuest,p:DiningParty)=>good(g,'/parties/'+p.id+'/preferences/confirm',{version:p.version,preferenceId:p.preference!.id,revision:p.preference!.revision});
async function recommend(g:NativeGuest,p:DiningParty,key=randomUUID()){const v=await dining(g);return good<DiningRecommendation>(g,'/parties/'+p.id+'/recommendations',{version:p.version,menuVersion:v.menu.version},key);}
const item=(r:Restaurant,name:string,extra:object={})=>h.good<StaffMenu['items'][number]>(p,'/restaurant/restaurants/'+r.id+'/menu-items',{name,category:'原创主食',ingredientTags:['番茄'],allergenInfoComplete:true,flavorTags:['清淡'],skus:[{name:'标准份',priceMinor:1800,stockRemaining:5}],...extra});

describe.skipIf(!nativePostgresAvailable)('原生本次偏好确认、服务端菜单推荐与来源边界',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture({onInitialized:(result,cluster)=>{const migration='094-native-dining-food.sql',file=root+'/migration-frozen.json',sha256=createHash('sha256').update(fs.readFileSync('migrations/postgres/'+migration)).digest('hex');if(fs.existsSync(file))expect(JSON.parse(fs.readFileSync(file,'utf8')).sha256).toBe(sha256);else fs.writeFileSync(file,JSON.stringify({migration,sha256,firstKnownCommittedAt:new Date().toISOString(),root:cluster.root,runtimeId:result.runtimeId,appliedFilesMayNotBeEdited:true},null,2)+'\n',{flag:'wx'});}});apiDb=await NativePostgresDatabase.open(x.result.api,'api');h=nativeReceptionHelpers(x);},60000);
 beforeEach(async()=>{p=await h.person();});afterAll(async()=>{await apiDb?.close();await x?.close();});
 it('保存草稿不自动确认，当前草稿明确确认后才可推荐且不产生订单',async()=>{
  const r=await store();await item(r,'原创番茄饭');const g=await guest(r),a=await party(g),saved=await draft(g,a,preferences({likes:['清淡']}));expect(saved.preference?.status).toBe('draft');expect(saved.preference?.usable).toBe(false);expect((await post(g,'/parties/'+a.id+'/recommendations',{version:saved.version,menuVersion:(await dining(g)).menu.version})).statusCode).toBe(409);
  const confirmed=await confirm(g,saved);expect(confirmed.preference?.usable).toBe(true);const rec=await recommend(g,confirmed);expect(rec.status).toBe('current');expect(rec.items.length).toBe(1);expect(rec.items[0].reasons).toContain('符合本次确认的口味');await x.owner(async db=>expect(Number((await db.query('SELECT count(*) value FROM restaurant_orders WHERE party_id=$1',[a.id])).rows[0].value)).toBe(0));
 });
 it('原键回放不新建草稿、不延长偏好期限或会话活动时间',async()=>{
  const r=await store(),g=await guest(r),a=await party(g),key=randomUUID(),value=preferences({note:'原创本次说明'}),first=await draft(g,a,value,key),before=await h.current(g),again=await draft(g,a,value,key),after=await h.current(g);expect(again.preference?.id).toBe(first.preference?.id);expect(again.preference?.expiresAt).toBe(first.preference?.expiresAt);expect(again.preference?.revision).toBe(1);expect(after.session.activityAt).toBe(before.session.activityAt);expect(after.session.expiresAt).toBe(before.session.expiresAt);
  await x.owner(async db=>expect(Number((await db.query('SELECT count(*) value FROM dining_preferences WHERE party_id=$1',[a.id])).rows[0].value)).toBe(1));
 });
 it('新草稿使旧修订失效，旧确认不能覆盖当前口味',async()=>{
  const r=await store(),g=await guest(r),a=await party(g),old=await draft(g,a,preferences({likes:['清淡']})),latest=await draft(g,old,preferences({likes:['番茄']}));expect(latest.preference?.revision).toBe(2);expect((await post(g,'/parties/'+a.id+'/preferences/confirm',{version:latest.version,preferenceId:old.preference!.id,revision:old.preference!.revision})).statusCode).toBe(409);expect((await confirm(g,latest)).preference?.preferences.likes).toEqual(['番茄']);
 });
 it('明确过敏、可能接触成分、未知配料、辣度与预算均由服务端排除且支持规范化文字',async()=>{
  const r=await store();await item(r,'原创花生饭',{ingredientTags:['peanut']});await item(r,'原创可能接触花生',{mayContainTags:['peanut']});await item(r,'原创配料待核对',{allergenInfoComplete:false});await item(r,'原创重辣饭',{spiceLevel:3});await item(r,'原创超预算',{skus:[{name:'大份',priceMinor:5000,stockRemaining:5}]});const safe=await item(r,'原创清淡新菜',{isNew:true});
  const g=await guest(r),a=await party(g),confirmed=await confirm(g,await draft(g,a,preferences({likes:['清淡'],allergyMode:'specified',allergens:['ＰＥＡＮＵＴ'],maxSpice:1,budgetPerDishMinor:2000}))),rec=await recommend(g,confirmed);expect(rec.items.map(i=>i.itemId)).toEqual([safe.id]);expect(rec.excluded.length).toBe(5);expect(rec.items[0].cautions.join('')).toContain('再次核对');expect(rec.notice).toContain('不会自动下单');
 });
 it('库存变化使旧推荐失效，旧菜单不能创建新候选且实际售罄不被客户端覆盖',async()=>{
  const r=await store(),dish=await item(r,'原创可售饭'),g=await guest(r),a=await confirm(g,await draft(g,await party(g))),rec=await recommend(g,a),oldMenu=(await dining(g)).menu.version;
  await h.good(p,'/restaurant/skus/'+dish.skus[0].id+'/stock',{version:dish.skus[0].version,quantity:0,reason:'原创本地售罄核对'});const read=await h.guestGet(g,'/dining/recommendations/'+rec.id);expect(read.statusCode).toBe(200);expect(read.json().data.status).toBe('stale');expect((await post(g,'/parties/'+a.id+'/recommendations',{version:a.version,menuVersion:oldMenu})).statusCode).toBe(409);expect((await recommend(g,a)).items.length).toBe(0);
 });
 it('人数或安排变化后原确认和推荐不能继续使用',async()=>{
  const r=await store();await item(r,'原创当前菜单');const g=await guest(r),a=await confirm(g,await draft(g,await party(g))),rec=await recommend(g,a),changed=await good(g,'/parties/'+a.id+'/update',{...fields,name:a.name,size:3,version:a.version});expect(changed.preference?.usable).toBe(false);expect((await post(g,'/parties/'+a.id+'/recommendations',{version:changed.version,menuVersion:(await dining(g)).menu.version})).statusCode).toBe(409);expect((await h.guestGet(g,'/dining/recommendations/'+rec.id)).json().data.status).toBe('stale');
 });
 it('换组再返回不能复活旧确认，重新保存确认后才可继续推荐',async()=>{
  const r=await store();await item(r,'原创问答组菜单');const g=await guest(r),a=await confirm(g,await draft(g,await party(g))),rec=await recommend(g,a);await party(g,'原创第二同行组');await good(g,'/parties/'+a.id+'/select',{version:a.version});const current=(await dining(g)).parties.find(p=>p.id===a.id)!;expect(current.preference?.usable).toBe(false);expect((await h.guestGet(g,'/dining/recommendations/'+rec.id)).json().data.status).toBe('stale');expect((await recommend(g,await confirm(g,await draft(g,current)))).status).toBe('current');
 });
 it('恢复本组后保留原偏好记录但撤销旧操作权，须在新终端重新核对',async()=>{
  const r=await store(),g=await guest(r),a=await confirm(g,await draft(g,await party(g))),next=await guest(r),claimed=await good(next,'/claim',{code:a.claimCode});expect(claimed.preference?.id).toBe(a.preference?.id);expect(claimed.preference?.usable).toBe(false);expect((await post(g,'/parties/'+a.id+'/preferences',{version:claimed.version,preferences:preferences()})).statusCode).toBe(404);
 });
 it('其他顾客、其他组织和后厨职责不能读取或修改本人偏好推荐',async()=>{
  const r=await store();await item(r,'原创独立菜单');const g=await guest(r),a=await confirm(g,await draft(g,await party(g))),rec=await recommend(g,a),other=await guest(r),foreign=await h.person(),kitchen=await h.colleague(p,'viewer');await h.good<RestaurantGrant[]>(p,'/restaurant/restaurants/'+r.id+'/staff',{userId:kitchen.user,role:'kitchen',version:0,enabled:true,expiresAt:null});
  expect((await h.guestGet(other,'/dining/recommendations/'+rec.id)).statusCode).toBe(404);for(const person of [foreign,kitchen])expect((await x.app.inject({url:'/api/v1/restaurant/recommendations/'+rec.id,headers:person.headers})).statusCode).toBe(404);expect((await post(other,'/parties/'+a.id+'/preferences',{version:a.version,preferences:preferences()})).statusCode).toBe(404);
 });
 it('并发保存同一安排的草稿最多成功一次且无半份来源记录',async()=>{
  const r=await store(),g=await guest(r),a=await party(g),body=await input(g,'/parties/'+a.id+'/preferences',{version:a.version,preferences:preferences()}),results=await Promise.all([h.guestPost(g,'/dining/parties/'+a.id+'/preferences',body),h.guestPost(g,'/dining/parties/'+a.id+'/preferences',body)]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);await x.owner(async db=>expect(Number((await db.query('SELECT count(*) value FROM _dg_native_food_preference_origins WHERE party_id=$1',[a.id])).rows[0].value)).toBe(1));
 });
 it('未接通的历史建议不伪造来源，过敏声明及额外价格字段必须严格校验',async()=>{
  const r=await store(),g=await guest(r),a=await party(g);expect((await post(g,'/parties/'+a.id+'/preferences',{version:a.version,preferences:preferences(),importId:randomUUID(),sourceFactIds:[randomUUID()]})).statusCode).toBe(409);expect((await post(g,'/parties/'+a.id+'/preferences',{version:a.version,preferences:preferences({allergyMode:'none_declared',allergens:['花生']})})).statusCode).toBe(400);expect((await post(g,'/parties/'+a.id+'/recommendations',{version:a.version,menuVersion:1,priceMinor:1})).statusCode).toBe(400);expect((await dining(g)).parties[0].preference).toBeNull();
 });
 it('API与worker不能直读偏好或调用私有排名核心，未到期worker不能提前清除原偏好',async()=>{
  const r=await store(),g=await guest(r),a=await draft(g,await party(g));for(const db of [apiDb,x.workerDb]){await expect(db.query('SELECT payload FROM dining_preferences WHERE id=$1',[a.preference!.id])).rejects.toThrow();await expect(db.query("SELECT dg_native_food_candidates('{}','{}')")).rejects.toThrow();}
  const service=new NativeFood(new NativeCoreRepository(x.workerDb),x.config.sessionSecret);expect(await x.workerDb.transaction(()=>service.sweep(r.id))).toBe(0);const current=(await dining(g)).parties[0];expect(current.preference?.expiresAt).toBe(a.preference?.expiresAt);expect(current.preference?.preferences).toEqual(a.preference?.preferences);
 });
 it('门店职责撤回再授予后旧偏好键不能恢复原授权的回执',async()=>{
  const r=await store(),host=await h.colleague(p,'viewer'),grant=(version:number,enabled:boolean)=>h.good<RestaurantGrant[]>(p,'/restaurant/restaurants/'+r.id+'/staff',{userId:host.user,role:'host',version,enabled,expiresAt:null});await grant(0,true);
  const a=await h.good<DiningParty>(host,'/restaurant/restaurants/'+r.id+'/parties',{...fields,confirmed:true}),key=randomUUID(),body={version:a.version,preferences:preferences({note:'原创店员核对说明'}),confirmed:true};
  const saved=await h.good<DiningParty>(host,'/restaurant/parties/'+a.id+'/preferences',body,key);expect(saved.preference?.source).toBe('staff_confirmation');await grant(1,false);await grant(2,true);
  const replay=await h.post(host,'/restaurant/parties/'+a.id+'/preferences',body,key);expect(replay.statusCode).toBe(409);expect(replay.json().error.code).toBe('AUTHORIZATION_CHANGED');
 });
 it('旧推荐键在问答组切换后不能恢复原目标的缓存结果',async()=>{
  const r=await store();await item(r,'原创缓存候选菜单');const g=await guest(r),a=await confirm(g,await draft(g,await party(g))),key=randomUUID(),suffix='/parties/'+a.id+'/recommendations',body=await input(g,suffix,{version:a.version,menuVersion:(await dining(g)).menu.version});
  const first=await h.guestPost(g,'/dining'+suffix,body,key);expect(first.statusCode).toBe(200);await party(g,'原创缓存切换同行');await good(g,'/parties/'+a.id+'/select',{version:a.version});const replay=await h.guestPost(g,'/dining'+suffix,body,key);expect(replay.statusCode).toBe(409);expect(replay.json().error.code).toBe('AUTHORIZATION_CHANGED');
 });
});
