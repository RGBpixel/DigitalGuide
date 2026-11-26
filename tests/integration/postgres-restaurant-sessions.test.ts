import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {Restaurant,RestaurantTerminal,RestaurantGrant,GuestSessionView,ReceptionSession,Profile,SceneApp} from '@digitalguide/contracts';
import {receptionSessionSchema} from '@digitalguide/contracts';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {NativeRestaurant} from '../../packages/postgres/src/runtime-restaurant.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {nativeReceptionCookieName} from '../../packages/postgres/src/runtime-reception.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeReceptionHelpers,type NativeGuest} from './postgres-reception-helpers.js';
import {nativeSpeakerHandoffHelpers} from './postgres-speaker-handoff-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,h:ReturnType<typeof nativeReceptionHelpers>,p:NativeTestPerson,apiDb:NativePostgresDatabase;
const root='docs/evidence/T20/postgres-restaurant-session';
const config=(r:Restaurant)=>({name:r.name,publicGuide:r.publicGuide,profileId:r.profileId,sceneAppId:r.sceneAppId,holdSeconds:r.holdSeconds,visitMinutes:r.visitMinutes,lateMinutes:r.lateMinutes,acceptingGuests:r.acceptingGuests,openingWindows:r.openingWindows,version:r.version});
async function store(extra:object={}){const venue=randomUUID();await x.owner(db=>db.query('INSERT INTO venues VALUES($1,$2,$3,$4,$5)',[venue,p.tenant,p.workspace,'原创餐厅会话场所','Asia/Shanghai']));return h.good<Restaurant>(p,'/restaurant/restaurants',{venueId:venue,name:'原创会话餐厅',...extra});}
async function terminal(r:Restaurant,person=p,name='原创独立顾客终端'){
 const response=await h.post(person,'/restaurant/restaurants/'+r.id+'/terminals',{name});
 if(response.statusCode===503)await apiDb.transaction(async()=>{await apiDb.query("SELECT set_config('digitalguide.actor_id',$1,true)",[person.user]);try{await new NativeRestaurant(new NativeCoreRepository(apiDb)).call('dg_native_dining_create_terminal',[r.id,{name}]);}catch(e){const error=e as{code?:string;message?:string;where?:string};console.log(JSON.stringify({stage:'native_dining_terminal',code:error.code,message:error.message,where:error.where?.slice(0,900),syntheticOnly:true}));throw e;}throw new Error('Diagnostic transaction always rolls back');});
 expect(response.statusCode,response.payload).toBe(200);return response.json().data as RestaurantTerminal;
}
const nextIntents=new Map<string,Record<string,unknown>>();
async function openInput(t:RestaurantTerminal,person=p,action:'open'|'next'='open',key=randomUUID()){
 if(action==='open')return{action,confirmed:true};let input=nextIntents.get(key);if(!input){const current=(await h.get<RestaurantTerminal[]>(person,'/restaurant/restaurants/'+t.restaurantId+'/terminals')).find(row=>row.id===t.id)!;input={action,confirmed:true,sessionId:current.currentSessionId,version:current.currentSessionVersion,focusVersion:current.currentFocusVersion};nextIntents.set(key,input);}return input;
}
const open=async(t:RestaurantTerminal,person=p,action:'open'|'next'='open',key=randomUUID())=>h.good<ReceptionSession>(person,'/restaurant/terminals/'+t.id+'/session',await openInput(t,person,action,key),key);
const grant=(r:Restaurant,m:NativeTestPerson,role:'host'|'manager'|'kitchen',version=0,enabled=true)=>h.good<RestaurantGrant[]>(p,'/restaurant/restaurants/'+r.id+'/staff',{userId:m.user,role,version,enabled,expiresAt:null});
async function access(t:RestaurantTerminal,s:ReceptionSession,person=p,key=randomUUID()):Promise<NativeGuest>{
 const response=await h.post(person,'/restaurant/terminals/'+t.id+'/access',{sessionId:s.id},key);expect(response.statusCode,response.payload).toBe(200);const c=response.cookies.find(c=>c.name===nativeReceptionCookieName(x.result.api.runtimeId));expect(c).toBeDefined();expect(c).toMatchObject({httpOnly:true,sameSite:'Strict',path:'/api/v1/guest/sessions/'+s.id});
 const cookie=c!.name+'='+encodeURIComponent(c!.value),loaded=await x.app.inject({url:'/api/v1/guest/sessions/'+s.id,headers:{cookie}});expect(loaded.statusCode,loaded.payload).toBe(200);const view=loaded.json().data as GuestSessionView;return{id:s.id,cookie,headers:{cookie,'x-csrf-token':view.csrfToken},view,accessKey:key};
}
async function guest(r:Restaurant,person=p){const t=await terminal(r,p),s=await open(t,person);return{t,s,g:await access(t,s,person)};}
describe.skipIf(!nativePostgresAvailable)('原生餐厅独立终端、门店职责及匿名顾客生命周期',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture({onInitialized:(result,cluster)=>{for(const[migration,leaf]of [['087-native-restaurant-sessions.sql','migration-frozen.json'],['088-native-restaurant-feature-scope.sql','feature-scope-frozen.json'],['089-native-restaurant-switch-target.sql','switch-target-frozen.json']]){const file=root+'/'+leaf,sha256=createHash('sha256').update(fs.readFileSync('migrations/postgres/'+migration)).digest('hex');if(fs.existsSync(file))expect(JSON.parse(fs.readFileSync(file,'utf8')).sha256).toBe(sha256);else fs.writeFileSync(file,JSON.stringify({migration,sha256,firstKnownCommittedAt:new Date().toISOString(),root:cluster.root,runtimeId:result.runtimeId,appliedFilesMayNotBeEdited:true},null,2)+'\n',{flag:'wx'});}}}).catch(error=>{const e=error as{code?:string;position?:string;where?:string};console.log(JSON.stringify({stage:'native_restaurant_session_init',code:e.code,position:e.position,where:e.where?.slice(0,900)}));throw error;});apiDb=await NativePostgresDatabase.open(x.result.api,'api');h=nativeReceptionHelpers(x);},60000);
 beforeEach(async()=>{p=await h.person();});afterAll(async()=>{await apiDb?.close();await x?.close();});
 it('门店终端耐久写入且同键只创建一次，80字名称不扩大企业前台的60字限制',async()=>{
  const r=await store(),name='原'.repeat(80),key=randomUUID(),t=await h.good<RestaurantTerminal>(p,'/restaurant/restaurants/'+r.id+'/terminals',{name},key),again=await h.good<RestaurantTerminal>(p,'/restaurant/restaurants/'+r.id+'/terminals',{name},key);expect(again.id).toBe(t.id);expect(t).toMatchObject({restaurantId:r.id,name,currentSessionId:null});expect(await h.get<RestaurantTerminal[]>(p,'/restaurant/restaurants/'+r.id+'/terminals')).toEqual([t]);
  expect((await h.post(p,'/terminals',{venueId:r.venueId,name})).statusCode).toBe(400);expect((await h.get<{items:{id:string}[]}>(p,'/terminals?workspaceId='+p.workspace)).items.some(v=>v.id===t.id)).toBe(false);
 });
 it('基础viewer只有获得独立经理职责后才能配置终端，迎宾仅可开启，后厨与其他组织拒绝',async()=>{
  const r=await store(),manager=await h.colleague(p,'viewer'),host=await h.colleague(p,'viewer'),kitchen=await h.colleague(p,'viewer'),foreign=await h.person();
  await grant(r,manager,'manager');await grant(r,host,'host');await grant(r,kitchen,'kitchen');const t=await terminal(r,manager);
  expect((await h.post(host,'/restaurant/restaurants/'+r.id+'/terminals',{name:'越权配置'})).statusCode).toBe(404);const s=await open(t,host),g=await access(t,s,host);expect(g.view.session.scene).toBe('restaurant');
  for(const person of [kitchen,foreign])expect((await h.post(person,'/restaurant/terminals/'+t.id+'/session',{action:'open',confirmed:true})).statusCode).toBe(404);
  expect((await h.post(manager,'/sessions',{terminalId:t.id})).statusCode).toBe(403);expect((await h.post(p,'/sessions',{terminalId:t.id})).statusCode).toBe(404);
 });
 it('同一终端并发开启仅生成一个匿名会话和一份问候，期限固定900秒',async()=>{
  const r=await store(),t=await terminal(r),rows=await Promise.all(Array.from({length:6},()=>open(t)));expect(new Set(rows.map(s=>s.id)).size).toBe(1);expect(rows[0].messages).toHaveLength(1);expect(rows[0]).toMatchObject({scene:'restaurant',identity:'anonymous',source:'manual',version:1,focusVersion:0});expect(receptionSessionSchema.safeParse(rows[0]).success).toBe(true);
  expect(new Date(rows[0].expiresAt).getTime()-new Date(rows[0].activityAt).getTime()).toBe(900000);
 });
 it('餐厅访客没有后台身份，企业来访拒绝且本人记忆必须主动授权',async()=>{
  const{g}=await guest(await store());expect(g.view.features).toMatchObject({visitRegistration:false,personalMemory:true,dining:true});for(const path of ['/people','/assets','/jobs'])expect((await x.app.inject({url:'/api/v1'+path,headers:g.headers})).statusCode).toBe(401);
  expect((await h.guestGet(g,'/visit')).statusCode).toBe(403);const personal=await h.guestGet(g,'/memory');expect(personal.statusCode,personal.payload).toBe(200);expect(personal.json().data).toEqual({person:null,facts:[],notes:[]});
  const value=await h.goodGuest(g,'/messages',{text:'我要找同事、保存偏好并点单',version:g.view.session.version,focusVersion:0,source:'typed'});expect(value.session.messages.at(-1)!.text).toContain('尚未启用');
  expect(await x.owner(async db=>(await db.query('SELECT (SELECT count(*) FROM visits WHERE session_id=$1)::int visits,(SELECT count(*) FROM people WHERE guest_session_id=$1)::int people',[g.id])).rows[0])).toEqual({visits:0,people:0});
 });
 it('凭证严格绑定终端会话，签发新凭证使旧凭证与旧签发键失效',async()=>{
  const r=await store(),a=await guest(r),b=await guest(r);expect((await x.app.inject({url:'/api/v1/guest/sessions/'+b.g.id,headers:a.g.headers})).statusCode).toBe(401);
  const next=await access(a.t,a.s);expect((await h.guestGet(a.g)).statusCode).toBe(401);expect((await h.guestGet(next)).statusCode).toBe(200);expect((await h.post(p,'/restaurant/terminals/'+a.t.id+'/access',{sessionId:a.s.id},a.g.accessKey)).statusCode).toBe(409);
  expect((await x.app.inject({method:'POST',url:'/api/v1/guest/sessions/'+next.id+'/messages',headers:{cookie:next.cookie,'idempotency-key':randomUUID()},payload:{text:'缺失安全凭证',version:next.view.session.version,focusVersion:0,source:'typed'}})).statusCode).toBe(403);
 });
 it('接待下一位原子结束旧会话和回复，旧操作键不会恢复旧访客或重建第二位',async()=>{
  const r=await store(),t=await terminal(r),key=randomUUID(),s=await open(t,p,'open',key),g=await access(t,s),nextKey=randomUUID(),n=await open(t,p,'next',nextKey),again=await open(t,p,'next',nextKey);expect(n.id).not.toBe(s.id);expect(again.id).toBe(n.id);expect(n.focusVersion).toBe(0);expect(n.messages).toHaveLength(1);expect((await h.guestGet(g)).statusCode).toBe(401);expect((await h.post(p,'/restaurant/terminals/'+t.id+'/session',{action:'open',confirmed:true},key)).statusCode).toBe(410);
  const state=await x.owner(async db=>(await db.query('SELECT status,access_version,focus_version,(SELECT count(*)::int FROM reception_messages WHERE session_id=$1 AND status IN(\'ready\',\'playing\')) playable FROM reception_sessions WHERE id=$1',[s.id])).rows[0]);expect(state).toMatchObject({status:'ended',access_version:'3',focus_version:'1',playable:0});
 });
 it('撤回迎宾授权立即终止其访次并清除正文，重新授权不复活旧Cookie或原开启键',async()=>{
  const r=await store(),host=await h.colleague(p,'viewer');await grant(r,host,'host');const t=await terminal(r),key=randomUUID(),s=await open(t,host,'open',key),g=await access(t,s,host);await grant(r,host,'host',1,false);expect((await h.guestGet(g)).statusCode).toBe(401);await grant(r,host,'host',2,true);expect((await h.post(host,'/restaurant/terminals/'+t.id+'/session',{action:'open',confirmed:true},key)).statusCode).toBe(409);expect((await h.guestGet(g)).statusCode).toBe(401);expect((await open(t,host)).id).not.toBe(s.id);
  const rows=await x.owner(db=>db.query('SELECT text FROM reception_messages WHERE session_id=$1',[s.id]));expect(rows.rows.every(v=>v.text==='')).toBe(true);
 });
 it('门店拥有终端；配置它的经理离开后，另一迎宾开启的顾客会话仍可使用',async()=>{
  const r=await store(),manager=await h.colleague(p,'viewer'),host=await h.colleague(p,'viewer');await grant(r,manager,'manager');await grant(r,host,'host');const t=await terminal(r,manager),s=await open(t,host),g=await access(t,s,host);await x.owner(db=>db.query('DELETE FROM memberships WHERE user_id=$1',[manager.user]));expect((await h.current(g)).session.id).toBe(s.id);expect((await h.get<RestaurantTerminal[]>(host,'/restaurant/restaurants/'+r.id+'/terminals'))[0].id).toBe(t.id);
 });
 it('开启人的空间移除再恢复或管理员身份往返均不恢复原会话授权',async()=>{
  const r=await store(),host=await h.colleague(p,'viewer');await grant(r,host,'host');const{g}=await guest(r,host);await x.owner(async db=>{await db.query('UPDATE memberships SET workspace_ids=$2 WHERE user_id=$1',[host.user,JSON.stringify([p.privateWorkspace])]);await db.query('UPDATE memberships SET workspace_ids=$2 WHERE user_id=$1',[host.user,JSON.stringify([p.workspace,p.privateWorkspace])]);});expect((await h.guestGet(g)).statusCode).toBe(401);
  const a=await guest(r);await x.owner(async db=>{await db.query("UPDATE memberships SET role='viewer' WHERE user_id=$1",[p.user]);await db.query("UPDATE memberships SET role='admin' WHERE user_id=$1",[p.user]);});expect((await h.guestGet(a.g)).statusCode).toBe(401);
 });
 it('暂停迎宾不清除已开启的访次，禁止新访次且失败的下一位操作完整回滚',async()=>{
  let r=await store();const a=await guest(r),other=await terminal(r);r=await h.good<Restaurant>(p,'/restaurant/restaurants/'+r.id+'/update',{...config(r),acceptingGuests:false});expect((await h.current(a.g)).session.id).toBe(a.s.id);
  for(const t of [a.t,other]){const result=await h.post(p,'/restaurant/terminals/'+t.id+'/session',await openInput(t,p,t.id===a.t.id?'next':'open'));expect(result.statusCode,result.payload).toBe(409);expect(result.json().error.code).toBe('RESTAURANT_PAUSED');}
  expect((await h.current(a.g)).session.id).toBe(a.s.id);expect((await h.get<RestaurantTerminal[]>(p,'/restaurant/restaurants/'+r.id+'/terminals')).find(t=>t.id===a.t.id)?.currentSessionId).toBe(a.s.id);
 });
 it('门店来源改绑永久撤回旧访次；仅绑定本店餐厅角色和公开餐厅应用',async()=>{
  let r=await store();const a=await guest(r),asset=await h.asset(p),profile=await h.good<Profile>(p,'/profiles',{workspaceId:p.workspace,name:'原创餐厅角色',avatarAssetId:asset.id,scenes:['restaurant']});r=await h.good<Restaurant>(p,'/restaurant/restaurants/'+r.id+'/update',{...config(r),profileId:profile.id});expect((await h.guestGet(a.g)).statusCode).toBe(401);const s=await open(a.t),g=await access(a.t,s);expect(g.view.session.profileName).toBe(profile.name);
  await h.good<Restaurant>(p,'/restaurant/restaurants/'+r.id+'/update',{...config(r),profileId:null});expect((await h.guestGet(g)).statusCode).toBe(401);expect((await h.guestGet(a.g)).statusCode).toBe(401);
 });
 it('餐厅公开场景正常答疑及专注状态读取，场景停用立即取消原访次',async()=>{
  const asset=await h.asset(p),profile=await h.good<Profile>(p,'/profiles',{workspaceId:p.workspace,name:'原创餐厅问答角色',avatarAssetId:asset.id,scenes:['restaurant']}),sceneFields={name:'原创公开餐厅',scene:'restaurant',channelKey:'restaurant-'+randomUUID(),profileId:profile.id,audience:'public',welcomeText:'欢迎咨询原创餐厅',speakerProvider:'mock-focus-final',targetSpeechProvider:'mock-target-speech'},scene=await h.good<SceneApp>(p,'/scene-apps',{workspaceId:p.workspace,...sceneFields}),r=await store({profileId:profile.id,sceneAppId:scene.id}),a=await guest(r);
  expect((await h.guestGet(a.g,'/speaker-focus')).statusCode).toBe(200);const value=await h.goodGuest(a.g,'/messages',{text:'你好',version:a.g.view.session.version,focusVersion:0,source:'typed'});expect(value.session.messages.at(-1)?.text).toBeTruthy();await h.good(p,'/scene-apps/'+scene.id+'/update',{...sceneFields,version:scene.version,enabled:false});expect((await h.guestGet(a.g)).statusCode).toBe(401);
 });
 it('API和worker角色不能直接改写餐厅终端关联、来源或冻结的会话时钟',async()=>{
  const a=await guest(await store());for(const db of [apiDb,x.workerDb])await expect(db.query('UPDATE restaurant_terminals SET restaurant_id=restaurant_id WHERE terminal_id=$1',[a.t.id])).rejects.toThrow();
  await expect(apiDb.query('SELECT dg_native_dining_spawn($1,$2,$3,$4,$5)',[a.t.id,p.user,'manual','0'.repeat(64),JSON.stringify({profile:null,scene:null,assets:[]})])).rejects.toThrow();
  await expect(x.owner(db=>db.query('UPDATE reception_sessions SET expires_at=dg_utc_now(),version=version+1 WHERE id=$1',[a.s.id]))).rejects.toThrow();
 });
 it('开启响应与签发之间已换人时，旧页面不能领取新顾客凭证',async()=>{
  const r=await store(),t=await terminal(r),old=await open(t),next=await open(t,p,'next'),before=await x.owner(async db=>(await db.query('SELECT count(*)::int n FROM _dg_native_reception_access WHERE session_id=$1',[next.id])).rows[0].n);
  const response=await h.post(p,'/restaurant/terminals/'+t.id+'/access',{sessionId:old.id});expect(response.statusCode).toBe(409);expect(response.cookies).toHaveLength(0);expect(await x.owner(async db=>(await db.query('SELECT count(*)::int n FROM _dg_native_reception_access WHERE session_id=$1',[next.id])).rows[0].n)).toBe(before);
 });
 it('餐厅可经本人同意锁定合成参考并使用原两步换人协议，新顾客不继承旧参考',async()=>{
  const asset=await h.asset(p),profile=await h.good<Profile>(p,'/profiles',{workspaceId:p.workspace,name:'原创餐厅专注角色',avatarAssetId:asset.id,scenes:['restaurant']}),scene=await h.good<SceneApp>(p,'/scene-apps',{workspaceId:p.workspace,name:'原创餐厅专注应用',scene:'restaurant',channelKey:'dining-focus-'+randomUUID(),profileId:profile.id,audience:'public',welcomeText:'欢迎来到原创餐厅。',speakerProvider:'mock-focus-final',targetSpeechProvider:'mock-target-speech'}),r=await store({profileId:profile.id,sceneAppId:scene.id}),host=await h.colleague(p,'viewer'),manager=await h.colleague(p,'viewer');await grant(r,host,'host');await grant(r,manager,'manager');const t=await terminal(r,manager),s=await open(t,host),g=await access(t,s,host),focus=nativeSpeakerHandoffHelpers(x);await x.owner(db=>db.query('DELETE FROM memberships WHERE user_id=$1',[manager.user]));
  await focus.focusOp(g,'',{mode:'temporary',sameVisitorConfirmed:true,consent:true,noticeVersion:'speaker-v1'});expect((await focus.focusOp(g,'reference',{fixture:'clear'})).state).toBe('locked');
  const current=(await h.current(g)).session,eventBase={focusVersion:current.focusVersion,sequence:0,source:'mock_speaker_event'};
  for(const fixture of ['other_louder','overlap_final','uncertain_final']){const result=await h.good<{accepted:boolean}>(host,'/restaurant/sessions/'+g.id+'/speaker-events',{...eventBase,segmentId:randomUUID(),fixture,text:'不应保存的周围声音'});expect(result.accepted).toBe(false);}
  expect((await focus.focus(g)).state).toBe('uncertain');await focus.focusOp(g,'reacquire',{sameVisitorConfirmed:true});await focus.focusOp(g,'reference',{fixture:'clear'});eventBase.focusVersion=(await h.current(g)).session.focusVersion;
  expect((await h.good<{accepted:boolean}>(host,'/restaurant/sessions/'+g.id+'/speaker-events',{...eventBase,segmentId:randomUUID(),fixture:'target_final',text:'您好，介绍这家餐厅'})).accepted).toBe(true);
  expect((await h.current(g)).session.messages.some(m=>m.text.includes('不应保存的周围声音'))).toBe(false);
  expect((await h.post(p,'/restaurant/sessions/'+g.id+'/speaker-events',{...eventBase,segmentId:randomUUID(),fixture:'target_final',text:'另一名员工越权模拟'})).statusCode).toBe(403);
  const prepared=await focus.prepareHandoff(g),response=await focus.commitHandoff(g,prepared);expect(response.statusCode,response.payload).toBe(200);const next=await focus.claimHandoff(response);expect(next.view.session.scene).toBe('restaurant');expect(next.view.session.id).not.toBe(g.id);expect(next.view.session.messages).toHaveLength(1);expect((await focus.focus(next)).reference).toBeNull();expect(next.view.features?.personalMemory).toBe(true);expect((await h.guestGet(next,'/memory')).json().data).toEqual({person:null,facts:[],notes:[]});expect((await h.guestGet(g)).statusCode).toBe(401);
 });
 it('两个员工的独立下一位意图只能结束所确认的原顾客，晚到请求不能结束新顾客',async()=>{
  const a=await guest(await store()),input=await openInput(a.t,p,'next'),results=await Promise.all([h.post(p,'/restaurant/terminals/'+a.t.id+'/session',input),h.post(p,'/restaurant/terminals/'+a.t.id+'/session',input)]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);const started=results.find(r=>r.statusCode===200)!.json().data as ReceptionSession,current=(await h.get<RestaurantTerminal[]>(p,'/restaurant/restaurants/'+a.t.restaurantId+'/terminals'))[0];expect(current.currentSessionId).toBe(started.id);expect((await h.post(p,'/restaurant/terminals/'+a.t.id+'/session',input)).statusCode).toBe(409);expect(await x.owner(async db=>(await db.query('SELECT count(*)::int n FROM reception_sessions WHERE terminal_id=$1',[a.t.id])).rows[0].n)).toBe(2);
 });
 it('下一位意图同时核对会话版本和发问人版本，原会话变化后不接受过期确认',async()=>{
  const a=await guest(await store()),old=await openInput(a.t,p,'next');let view=await h.control(a.g,'stop',a.g.view);expect((await h.post(p,'/restaurant/terminals/'+a.t.id+'/session',old)).statusCode).toBe(409);view=await h.control(a.g,'handoff',view);expect((await h.post(p,'/restaurant/terminals/'+a.t.id+'/session',{...old,version:view.session.version,focusVersion:view.session.focusVersion-1})).statusCode).toBe(409);expect((await h.current(a.g)).session.status).toBe('human');
 });
 it('原生下一位请求必须明确被确认的会话，缺失目标不会结束当前顾客',async()=>{
  const a=await guest(await store());expect((await h.post(p,'/restaurant/terminals/'+a.t.id+'/session',{action:'next',confirmed:true})).statusCode).toBe(400);expect((await h.current(a.g)).session.id).toBe(a.s.id);
 });
});
