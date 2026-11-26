import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import type {MemoryView,GuestVisitView} from '@digitalguide/contracts';
import {createApp} from '../../apps/api/src/app.js';
import {NativeSpeaker} from '../../packages/postgres/src/runtime-speaker.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeSpeakerHandoffHelpers} from './postgres-speaker-handoff-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,h:ReturnType<typeof nativeSpeakerHandoffHelpers>,p:NativeTestPerson;
describe.skipIf(!nativePostgresAvailable)('原生独立下一访客与限时交接领取',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture();h=nativeSpeakerHandoffHelpers(x);},60000);beforeEach(async()=>{p=await h.person();});afterEach(()=>vi.restoreAllMocks());afterAll(async()=>{await x?.close();});
 it('独立意图只准备原六十秒交接，不开始新会话、不续任何活动或绝对期限',async()=>{
  const{guest:g}=await h.locked(p),before=(await h.current(g)).session,prepared=await h.prepareHandoff(g),again=await h.prepareHandoff(g);
  expect(again.intentId).toBe(prepared.intentId);expect(again.expiresAt).toBe(prepared.expiresAt);expect(await h.handoffCount(g)).toEqual({intents:1,next:0,sessions:1});expect((await h.current(g)).session).toEqual(before);
  const cookie=prepared.response.cookies.find(c=>c.name.startsWith('dg_native_handoff_'))!;expect(cookie).toMatchObject({httpOnly:true,sameSite:'Strict',path:'/api/v1/guest/sessions/'+g.id+'/speaker-focus/'});expect(JSON.stringify(prepared.response.json())).not.toContain('HT1.');
  const row=await x.owner(async db=>(await db.query('SELECT created_at,expires_at FROM _dg_native_speaker_handoff_origins WHERE id=$1',[prepared.intentId])).rows[0]);expect(Date.parse(row.expires_at)-Date.parse(row.created_at)).toBe(60000);
 });
 it('提交后新访客独立匿名，旧凭证不能读取新会话且必须重新确认声音用途',async()=>{
  const{guest:g}=await h.locked(p);await h.event(p,g);await h.focusOp(g,'fallback',{mode:'ptt',confirmed:true});await h.focusOp(g,'ptt',{confirmed:true});const before=(await h.current(g)).session,prepared=await h.prepareHandoff(g),r=await h.commitHandoff(g,prepared);expect(r.statusCode,r.payload).toBe(200);const nextId=r.json().data.sessionId as string;expect(nextId).not.toBe(g.id);
  for(const sid of [g.id,nextId])expect((await x.app.inject({url:'/api/v1/guest/sessions/'+sid,headers:g.headers})).statusCode).toBe(401);
  const next=await h.claimHandoff(r),s=(await h.current(next)).session;expect(s).toMatchObject({status:'active',focusVersion:0,replyEpoch:0,scene:'reception'});expect(s.messages.filter(m=>m.role==='visitor')).toEqual([]);expect(await h.focus(next)).toMatchObject({state:'handoff_pending',reference:null,pttReady:false,counts:{accepted:0,buffered:0}});
  expect((await h.guestGet(next,'/memory')).json().data.person).toBeNull();expect((await h.guestGet(next,'/visit')).json().data.visit).toBeNull();expect(s.features?.speakerFocus).toBe(true);
  const old=await x.owner(async db=>(await db.query('SELECT status,focus_version,activity_at,expires_at FROM reception_sessions WHERE id=$1',[g.id])).rows[0]);expect(old).toEqual({status:'ended',focus_version:String(before.focusVersion+1),activity_at:before.activityAt,expires_at:before.expiresAt});
  expect(await h.focusOp(next,'',{mode:'temporary',sameVisitorConfirmed:true,consent:true,noticeVersion:'speaker-v1'})).toMatchObject({state:'acquiring',focusVersion:1});
 });
 it('双API原意图原键八次只交接一次，首次新访问领取后所有旧交接恢复入口关闭',async()=>{
  const{guest:g}=await h.locked(p),prepared=await h.prepareHandoff(g),second=await createApp(x.config);
  try{const replies=await Promise.all(Array.from({length:8},(_,i)=>h.commitHandoff(g,prepared,prepared.operationKey,i%2?second:x.app)));expect(replies.map(r=>r.statusCode)).toEqual(Array(8).fill(200));expect(new Set(replies.map(r=>r.json().data.sessionId)).size).toBe(1);expect(await h.handoffCount(g)).toEqual({intents:1,next:1,sessions:2});
   const pending=await x.app.inject({url:'/api/v1/guest/sessions/'+g.id+'/speaker-focus/handoff-intent',headers:prepared.headers});expect(pending.statusCode,pending.payload).toBe(200);expect(pending.json().data).toMatchObject({state:'committed',operationKey:prepared.operationKey});const next=await h.claimHandoff(replies[0]);expect((await h.current(next)).session.focusVersion).toBe(0);
   expect((await h.commitHandoff(g,prepared)).json().error.code).toBe('HANDOFF_UNAVAILABLE');expect((await x.app.inject({url:'/api/v1/guest/sessions/'+g.id+'/speaker-focus/handoff-intent',headers:prepared.headers})).json().error.code).toBe('HANDOFF_UNAVAILABLE');
  }finally{await second.close();}
 });
 it('旧普通cookie和原键不足以领取新访问，伪造意图、错误CSRF与跨会话凭证拒绝',async()=>{
  const{guest:g}=await h.locked(p),other=await h.locked(p),prepared=await h.prepareHandoff(g),url='/api/v1/guest/sessions/'+g.id+'/speaker-focus/handoff';
  for(const headers of [{...g.headers,'idempotency-key':prepared.operationKey},{...prepared.headers,'x-csrf-token':'wrong','idempotency-key':prepared.operationKey},{...other.guest.headers,cookie:other.guest.cookie+'; '+prepared.cookie,'idempotency-key':prepared.operationKey}])expect((await x.app.inject({method:'POST',url,headers,payload:prepared.body})).statusCode).toBeGreaterThanOrEqual(400);
  expect(await h.handoffCount(g)).toEqual({intents:1,next:0,sessions:1});expect((await h.commitHandoff(g,prepared,prepared.operationKey,x.app,{...prepared.body,version:prepared.body.version+1})).json().error.code).toBe('IDEMPOTENCY_CONFLICT');expect(await h.handoffCount(g)).toEqual({intents:1,next:0,sessions:1});
 });
 it('准备后版本变化不能交接旧状态，重新明确准备会撤销旧意图且不复活旧目标',async()=>{
  const{guest:g}=await h.locked(p),old=await h.prepareHandoff(g);await h.message(g,'原创明确的新问题',await h.current(g));expect((await h.commitHandoff(g,old)).json().error.code).toBe('VERSION_CONFLICT');
  const fresh=await h.prepareHandoff(g);expect(fresh.intentId).not.toBe(old.intentId);expect((await h.commitHandoff(g,old)).json().error.code).toBe('HANDOFF_UNAVAILABLE');expect((await h.commitHandoff(g,fresh)).statusCode).toBe(200);expect(await h.handoffCount(g)).toEqual({intents:2,next:1,sessions:2});
 });
 it('同一人重锁、人工接管或访问更新都会使原准备失效',async()=>{
  for(const action of ['reacquire','human','access']as const){const{guest:g}=await h.locked(p),prepared=await h.prepareHandoff(g);if(action==='reacquire')await h.focusOp(g,'reacquire',{sameVisitorConfirmed:true});else if(action==='human')await h.control(g,'handoff',await h.current(g));else await h.good(p,'/sessions/'+g.id+'/access',{});
   expect((await h.commitHandoff(g,prepared)).json().error.code).toBe('HANDOFF_UNAVAILABLE');expect((await h.handoffCount(g)).next).toBe(0);
  }
 });
 it('原本人确认事实与来访记录保留在旧对象，另一终端不变，新对象不继承',async()=>{
  const{guest:g}=await h.locked(p),other=await h.locked(p);let memory=await h.goodGuest<MemoryView>(g,'/memory',{displayName:'原创旧访客',roles:['visitor'],consent:true,noticeVersion:'memory-v1',retentionDays:30,focusVersion:1});memory=await h.goodGuest<MemoryView>(g,'/memory/facts',{key:'like',value:'原创只属于旧访客的偏好',visibility:'private',expiresAt:memory.person!.expiresAt,focusVersion:1});memory=await h.goodGuest<MemoryView>(g,'/memory/facts/decide',{factId:memory.facts[0].id,version:1,action:'confirm',confirmed:true,focusVersion:1});const visit=await h.visit(g,p),otherBefore=(await h.current(other.guest)).session,prepared=await h.prepareHandoff(g),r=await h.commitHandoff(g,prepared),next=await h.claimHandoff(r);
  expect((await h.guestGet(next,'/memory')).json().data.person).toBeNull();expect((await h.guestGet(next,'/visit')).json().data.visit).toBeNull();expect((await h.current(other.guest)).session).toEqual(otherBefore);
  const kept=await x.owner(async db=>({fact:(await db.query('SELECT value,status,expires_at FROM memory_facts WHERE id=$1',[memory.facts[0].id])).rows[0],person:(await db.query('SELECT guest_session_id FROM people WHERE id=$1',[memory.person!.id])).rows[0],visit:(await db.query('SELECT id,session_id FROM visits WHERE id=$1',[visit.draft.visit!.id])).rows[0]}));expect(kept.fact).toMatchObject({value:memory.facts[0].value,status:'confirmed',expires_at:memory.facts[0].expiresAt});expect(kept.person.guest_session_id).toBe(g.id);expect(kept.visit.session_id).toBe(g.id);
  expect(JSON.stringify((await h.guestGet(next,'/visit')).json().data as GuestVisitView)).not.toContain('原创旧访客');
 });
 it('明确确认与服务配置由服务端验证，未配置外部服务不会静默创建模拟交接',async()=>{
  const{guest:g}=await h.locked(p),body=await h.handoffInput(g);for(const change of [{confirmed:false},{nextVisitorConfirmed:false},{version:'1'},{unexpected:true}])expect((await h.guestPost(g,'/speaker-focus/handoff-intent',{...body,...change})).statusCode).toBe(400);
  const external=(await h.focusGuest(p,'external-focus')).guest;expect((await h.guestPost(external,'/speaker-focus/handoff-intent',await h.handoffInput(external))).json().error.code).toBe('PROVIDER_NOT_CONFIGURED');
 });
 it('管理员合成参考确认真实走原生事务，重放不重复更新且旧focus无效',async()=>{
  const{guest:g}=await h.focusGuest(p);await h.focusOp(g,'',{mode:'temporary',sameVisitorConfirmed:true,consent:true,noticeVersion:'speaker-v1'});const input=await h.focusInput(g,{fixture:'clear'}),key=randomUUID(),path='/sessions/'+g.id+'/speaker-focus/reference';expect(await h.good(p,path,input,key)).toMatchObject({state:'locked',simulated:true});const first=(await h.current(g)).session;expect(await h.good(p,path,input,key)).toMatchObject({state:'locked'});expect((await h.current(g)).session).toEqual(first);await h.focusOp(g,'reacquire',{sameVisitorConfirmed:true});expect((await h.post(p,path,input,key)).json().error.code).toBe('VERSION_CONFLICT');
 });
 it('普通员工与其他租户不能代为确认参考，样例不足不冒充锁定',async()=>{
  const{guest:g}=await h.focusGuest(p);await h.focusOp(g,'',{mode:'temporary',sameVisitorConfirmed:true,consent:true,noticeVersion:'speaker-v1'});const input=await h.focusInput(g,{fixture:'too_short'}),viewer=await h.colleague(p,'viewer'),other=await h.person(),path='/sessions/'+g.id+'/speaker-focus/reference';expect((await h.post(viewer,path,input)).statusCode).toBe(403);expect((await h.post(other,path,input)).statusCode).toBe(404);expect(await h.good(p,path,input)).toMatchObject({state:'uncertain',reference:{quality:'insufficient'}});
 });
 it('八个请求已读取同一交接提示时，首个完成关闭旧参考后其余仍恢复原交接',async()=>{
  const{guest:g}=await h.locked(p),prepared=await h.prepareHandoff(g),second=await createApp(x.config),original=NativeSpeaker.prototype.call;let arrivals=0,release:()=>void=()=>undefined;const ready=new Promise<void>(r=>{release=r;}),timer=setTimeout(release,15000);
  vi.spyOn(NativeSpeaker.prototype,'call').mockImplementation(async function(this:NativeSpeaker,name:string,args:unknown[]=[]){const value=await original.call(this,name,args);if(name==='dg_native_speaker_handoff_prelock'){arrivals++;if(arrivals===8)release();await ready;}return value;});
  try{const replies=await Promise.all(Array.from({length:8},(_,i)=>h.commitHandoff(g,prepared,prepared.operationKey,i%2?second:x.app))),sanitized=replies.map(r=>({status:r.statusCode,code:r.json().error?.code??null}));expect(arrivals).toBe(8);expect(sanitized,JSON.stringify(sanitized)).toEqual(Array.from({length:8},()=>({status:200,code:null})));expect(await h.handoffCount(g)).toEqual({intents:1,next:1,sessions:2});}finally{clearTimeout(timer);await second.close();}
 });
 it('交接保留独立登记母参考与另一终端，旧码和迟到声音不能进入下一访客',async()=>{
  const reference=await h.enroll(p),a=await h.focusGuest(p),b=await h.focusGuest(p),code=await h.authorize(p,reference,a.guest);
  await h.startEnrolled(a.guest,code.useCode);await h.focusOp(a.guest,'reference',{fixture:'clear'});await h.startEnrolled(b.guest,(await h.authorize(p,reference,b.guest)).useCode);await h.focusOp(b.guest,'reference',{fixture:'clear'});const kept=(await h.current(b.guest)).session,references=await h.references(p),prepared=await h.prepareHandoff(a.guest),r=await h.commitHandoff(a.guest,prepared),next=await h.claimHandoff(r);
  expect(await h.references(p)).toEqual(references);expect((await h.current(b.guest)).session).toEqual(kept);expect(await h.focus(b.guest)).toMatchObject({state:'locked',mode:'enrolled'});
  const start=await h.enrolledInput(next,code.useCode);expect((await h.guestPost(next,'/speaker-focus',start)).json().error.code).toBe('REFERENCE_USE_DENIED');const before=(await h.current(next)).session;
  const late=await h.good<{accepted:boolean;reason:string}>(p,'/sessions/'+a.guest.id+'/speaker-events',{focusVersion:1,segmentId:randomUUID(),sequence:0,fixture:'target_final',text:'属于旧对象的迟到内容',source:'mock_speaker_event'});expect(late).toMatchObject({accepted:false,reason:'stale_focus'});expect((await h.current(next)).session).toEqual(before);
 });
 it('原角色或终端所有人失去权限后，已提交但未领取的交接也不能继续发放访问',async()=>{
  const{guest:g}=await h.locked(p),prepared=await h.prepareHandoff(g),r=await h.commitHandoff(g,prepared);expect(r.statusCode,r.payload).toBe(200);
  await x.owner(db=>db.query("UPDATE memberships SET role='viewer' WHERE user_id=$1",[p.user]));const denied=await h.commitHandoff(g,prepared);expect(denied.statusCode).toBe(409);expect(denied.json().error.code).toBe('SOURCE_UNAVAILABLE');expect(denied.cookies.some(c=>c.name.startsWith('dg_native_guest_')&&c.value.startsWith('RG1.'))).toBe(false);expect((await h.handoffCount(g)).next).toBe(1);
 });
 it('准备操作有速率限制，原编号重试不多计；提交必须使用该意图返回的原编号',async()=>{
  const{guest:g}=await h.locked(p),body=await h.handoffInput(g),key=randomUUID(),first=await h.prepareHandoff(g,body,key),before=(await h.current(g)).session;for(let i=0;i<9;i++)expect((await h.prepareHandoff(g,body)).intentId).toBe(first.intentId);
  expect((await h.prepareHandoff(g,body,key)).expiresAt).toBe(first.expiresAt);const limited=await h.guestPost(g,'/speaker-focus/handoff-intent',body);expect(limited.statusCode).toBe(429);expect(limited.json().error.code).toBe('RATE_LIMITED');expect((await h.current(g)).session).toEqual(before);
  expect((await h.commitHandoff(g,first,'wrong-handoff-key')).json().error.code).toBe('VALIDATION_FAILED');expect((await h.handoffCount(g)).next).toBe(0);expect((await h.commitHandoff(g,first)).statusCode).toBe(200);
 });
 it('响应头已处理但交接正文丢失时，原浏览器可恢复且旧普通权限仍然失效',async()=>{
  const{guest:g}=await h.locked(p),prepared=await h.prepareHandoff(g),oldPath='/api/v1/guest/sessions/'+g.id,oldName=g.cookie.split('=')[0],jar=new Map([[oldName+'|'+oldPath,g.cookie.split('=')[1]]]);
  const intentCookie=prepared.response.cookies.find(c=>c.name.startsWith('dg_native_handoff_'))!;jar.set(intentCookie.name+'|'+intentCookie.path,encodeURIComponent(intentCookie.value));
  const committed=await h.commitHandoff(g,prepared);expect(committed.statusCode).toBe(200);
  // Intentionally consume only Set-Cookie; the first response body is dropped.
  for(const c of committed.cookies){const key=c.name+'|'+c.path;if(c.value==='')jar.delete(key);else jar.set(key,encodeURIComponent(c.value));}
  const route=oldPath+'/speaker-focus/handoff-intent',cookie=[...jar].filter(([key])=>route.startsWith(key.split('|')[1])).map(([key,value])=>key.split('|')[0]+'='+value).join('; '),status=await x.app.inject({url:route,headers:{cookie}});expect(status.statusCode,status.payload).toBe(200);const d=status.json().data;
  expect((await h.guestGet(g)).statusCode).toBe(401);const recovered=await x.app.inject({method:'POST',url:oldPath+'/speaker-focus/handoff',headers:{cookie,'x-csrf-token':d.csrfToken,'idempotency-key':d.operationKey},payload:d.input});expect(recovered.statusCode,recovered.payload).toBe(200);await h.claimHandoff(recovered);expect((await h.commitHandoff(g,prepared)).json().error.code).toBe('HANDOFF_UNAVAILABLE');expect(await h.handoffCount(g)).toEqual({intents:1,next:1,sessions:2});
 });
});
