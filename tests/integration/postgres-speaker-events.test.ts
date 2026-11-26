import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import type {MemoryView,SpeakerFixture} from '@digitalguide/contracts';
import {createApp} from '../../apps/api/src/app.js';
import {NativeReception} from '../../packages/postgres/src/runtime-reception.js';
import {NativeSpeaker} from '../../packages/postgres/src/runtime-speaker.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeSpeakerEventHelpers} from './postgres-speaker-event-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,h:ReturnType<typeof nativeSpeakerEventHelpers>,p:NativeTestPerson;

describe.skipIf(!nativePostgresAvailable)('原生可信合成声音事件、问答和来源记忆',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture();h=nativeSpeakerEventHelpers(x);},60000);
 beforeEach(async()=>{p=await h.person();});afterEach(()=>vi.restoreAllMocks());afterAll(async()=>{await x?.close();});
 it('已锁定目标的最终字幕与回复、签名来源及回执在同一事务保存',async()=>{
  const{guest:g}=await h.locked(p),before=(await h.current(g)).session,result=await h.event(p,g),after=(await h.current(g)).session;
  expect(result).toMatchObject({accepted:true,buffered:false,reason:'target_final_confirmed_mock',simulated:true,focusVersion:1});
  expect(after.messages).toHaveLength(before.messages.length+2);expect(after.version).toBe(before.version+1);expect(after.replyEpoch).toBe(before.replyEpoch+1);expect(after.expiresAt).toBe(before.expiresAt);
  const rows=await x.owner(async db=>(await db.query('SELECT role,input_source,speaker_decision_id FROM reception_messages WHERE speaker_decision_id=$1 ORDER BY native_ordinal',[result.decisionId])).rows);
  expect(rows).toEqual([{role:'visitor',input_source:'verified_mock_audio',speaker_decision_id:result.decisionId},{role:'assistant',input_source:'system',speaker_decision_id:result.decisionId}]);
  const proof=await x.owner(async db=>(await db.query('SELECT o.descriptor,g.descriptor_hash,g.signature_hash FROM _dg_native_speaker_event_origins o JOIN _dg_native_speaker_event_signatures g USING(decision_id) WHERE decision_id=$1',[result.decisionId])).rows[0]);
  expect(proof.descriptor).toMatchObject({attribution:'target',accepted:true,final:true,actorId:p.user,source:'mock_speaker_event'});expect(proof.signature_hash).toMatch(/^[a-f0-9]{64}$/);expect(proof.descriptor).not.toHaveProperty('text');
  expect(JSON.stringify(result)).not.toMatch(/referenceId|textHash|usage_target|signature|csrf|token/);
 });
 it('final模式的部分字幕只保存短期元数据，非目标或噪声不进入问答和记忆',async()=>{
  const{guest:g}=await h.locked(p),before=(await h.current(g)).session,compose=vi.spyOn(NativeReception.prototype,'composeReply');
  for(const fixture of ['target_partial','other_partial','other_final','other_louder','echo_final','noise_final'] as const){const r=await h.event(p,g,fixture,'原始过滤文本绝不能保存-'+fixture);expect(r.accepted).toBe(false);}
  expect(compose).not.toHaveBeenCalled();const after=(await h.current(g)).session;expect(after).toEqual(before);
  const privateRows=await x.owner(async db=>{const result:unknown[]=[];for(const t of ['_dg_native_speaker_ingress','_dg_native_speaker_event_origins','_dg_native_speaker_event_signatures','_dg_native_speaker_streams','_dg_native_speaker_pending','speaker_segment_decisions','audit_events','outbox_events'])result.push((await db.query('SELECT to_jsonb(t) value FROM '+t+' t')).rows);return result;});
  expect(JSON.stringify(privateRows)).not.toContain('原始过滤文本');expect((await h.counts(g)).sources).toBe(0);
 });
 it.each([
  ['target_partial',false,'awaiting_final'],['target_final',true,'target_final_confirmed_mock'],['target_crowd_final',true,'target_final_confirmed_mock'],
  ['other_partial',false,'non_target_partial'],['other_final',false,'non_target_final'],['other_louder',false,'non_target_final'],
  ['uncertain_final',false,'attribution_uncertain'],['overlap_final',false,'overlap_not_separable'],['echo_final',false,'self_echo'],['noise_final',false,'background_noise'],
  ['target_speech_started',false,'target_barge_in_mock'],['other_speech_started',false,'non_target_speech'],['tracking_lost',false,'tracking_lost'],
  ['ptt_target_final',false,'ptt_confirmation_required'],['replay_match_final',true,'target_final_confirmed_mock']
 ] as [SpeakerFixture,boolean,string][])('early模式样例 %s 只按已声明模拟能力判定',async(fixture,accepted,reason)=>{
  const{guest:g}=await h.locked(p,'mock-focus-early'),compose=vi.spyOn(NativeReception.prototype,'composeReply');expect(await h.event(p,g,fixture)).toMatchObject({accepted,reason,simulated:true});expect(compose).toHaveBeenCalledTimes(accepted?1:0);
  expect((await h.counts(g)).sources).toBe(accepted?1:0);expect((await x.app.inject({url:'/api/v1/visits?workspaceId='+p.workspace,headers:g.headers})).statusCode).toBe(401);
 });
 it('两个API沿原键八次并发只生成一轮问答，改变正文不能覆盖原操作',async()=>{
  const{guest:g}=await h.locked(p),input=await h.input(g),key=randomUUID(),second=await createApp(x.config);
  try{const results=await Promise.all(Array.from({length:8},(_,i)=>h.post(p,'/sessions/'+g.id+'/speaker-events',input,key,i%2?second:x.app)));expect(results.map(r=>r.statusCode)).toEqual(Array(8).fill(200));expect(new Set(results.map(r=>r.json().data.decisionId)).size).toBe(1);expect(await h.counts(g)).toMatchObject({decisions:1,origins:1,sources:1,ingress:1});expect((await h.post(p,'/sessions/'+g.id+'/speaker-events',{...input,text:'改变后的正文'},key)).json().error.code).toBe('IDEMPOTENCY_CONFLICT');}finally{await second.close();}
 });
 it('部分顺序、最终和迟到事件不能重复进入问答',async()=>{
  const{guest:g}=await h.locked(p),segmentId=randomUUID();expect(await h.event(p,g,'target_partial','部分一',{segmentId,sequence:2})).toMatchObject({buffered:true});
  for(const sequence of [0,1,2])expect(await h.event(p,g,'target_final','旧序号',{segmentId,sequence})).toMatchObject({accepted:false,reason:'duplicate_or_out_of_order',decisionId:null});
  const final=await h.event(p,g,'target_final','最终目标问题',{segmentId,sequence:3});expect(final.accepted).toBe(true);expect(await h.event(p,g,'target_final','迟到最终',{segmentId,sequence:4})).toMatchObject({accepted:false,reason:'duplicate_or_out_of_order'});expect((await h.counts(g)).sources).toBe(1);
 });
 it('早期目标可以打断，旁人或final模式的早期事件不打断且不续活动时间',async()=>{
  for(const provider of ['mock-focus-final','mock-focus-early'] as const){const{guest:g}=await h.locked(p,provider);await h.event(p,g);let s=(await h.current(g)).session;const reply=s.messages.at(-1)!;
   await h.goodGuest(g,'/events',{type:'reply.started',replyId:reply.id,replyEpoch:s.replyEpoch,focusVersion:s.focusVersion});s=(await h.current(g)).session;
   for(const fixture of ['other_speech_started','other_louder','echo_final'] as const){expect((await h.event(p,g,fixture)).interrupted).toBe(false);expect((await h.current(g)).session).toEqual(s);}
   const result=await h.event(p,g,'target_speech_started'),after=(await h.current(g)).session;expect(result.interrupted).toBe(provider==='mock-focus-early');expect(after.activityAt).toBe(s.activityAt);expect(after.expiresAt).toBe(s.expiresAt);expect(after.messages.find(m=>m.id===reply.id)!.status).toBe(provider==='mock-focus-early'?'cancelled':'playing');
  }
 });
 it('五秒部分缓冲有四段与十六次上限，期限固定且数据库不保存字幕',async()=>{
  const{guest:g}=await h.locked(p),segmentId=randomUUID(),before=(await h.current(g)).session;
  for(let sequence=0;sequence<16;sequence++)expect(await h.event(p,g,'target_partial','原始短期字幕',{segmentId,sequence})).toMatchObject({accepted:false,buffered:true});
  expect(await h.event(p,g,'target_partial','第十七次',{segmentId,sequence:16})).toMatchObject({buffered:false,reason:'partial_buffer_limit'});
  for(let i=0;i<4;i++)expect((await h.event(p,g,'target_partial','界'.repeat(1000))).buffered).toBe(true);
  expect((await h.event(p,g,'target_partial','第五段')).buffered).toBe(false);expect((await h.focus(g)).counts.buffered).toBe(4);
  const buffers=await x.owner(async db=>(await db.query('SELECT to_jsonb(t) value FROM _dg_native_speaker_pending t WHERE session_id=$1',[g.id])).rows.map(r=>r.value));expect(buffers).toHaveLength(4);expect(JSON.stringify(buffers)).not.toContain('原始短期字幕');expect((await h.current(g)).session).toEqual(before);
 });
 it('PTT只使用一次原十秒许可，不会自动接纳其他事件或授予身份',async()=>{
  const{guest:g}=await h.locked(p);await h.focusOp(g,'fallback',{mode:'ptt',confirmed:true});await h.focusOp(g,'ptt',{confirmed:true});
  expect(await h.event(p,g)).toMatchObject({accepted:false,reason:'ptt_confirmation_required'});expect((await h.focus(g)).pttReady).toBe(true);
  expect(await h.event(p,g,'ptt_target_final')).toMatchObject({accepted:true,reason:'ptt_target_confirmed_mock'});expect((await h.focus(g)).pttReady).toBe(false);
  expect(await h.event(p,g,'ptt_target_final')).toMatchObject({accepted:false,reason:'ptt_confirmation_required'});expect((await h.counts(g)).sources).toBe(1);
 });
 it('已接纳音频可提出偏好候选，必须本人另行确认；系统和旁人不是记忆来源',async()=>{
  const{guest:g}=await h.locked(p);let memory=await h.goodGuest<MemoryView>(g,'/memory',{displayName:'原创合成发问人',roles:['visitor'],consent:true,noticeVersion:'memory-v1',retentionDays:30,focusVersion:1});
  const result=await h.event(p,g,'target_final','本人喜欢原创山间路线。'),s=(await h.current(g)).session,question=s.messages.find(m=>m.role==='visitor')!,reply=s.messages.at(-1)!;
  const proposed={key:'like',value:'原创山间路线',visibility:'reception',expiresAt:memory.person!.expiresAt,sourceMessageId:question.id,focusVersion:1};memory=await h.goodGuest<MemoryView>(g,'/memory/facts',proposed);expect(memory.facts[0].status).toBe('pending');
  expect((await h.guestPost(g,'/memory/facts',{...proposed,sourceMessageId:reply.id})).json().error.code).toBe('INVALID_SOURCE');
  expect(result.decisionId).not.toBeNull();memory=await h.goodGuest<MemoryView>(g,'/memory/facts/decide',{factId:memory.facts[0].id,version:1,action:'confirm',confirmed:true,focusVersion:1});expect(memory.facts[0].status).toBe('confirmed');
  await h.focusOp(g,'reacquire',{sameVisitorConfirmed:true});const kept=(await h.guestGet(g,'/memory')).json().data as MemoryView;expect(kept.facts[0]).toMatchObject({value:'原创山间路线',status:'confirmed'});expect((await h.guestPost(g,'/memory/facts',{...proposed,focusVersion:2})).json().error.code).toBe('INVALID_SOURCE');
 });
 it('旧focus和客户端自报音频都不能进入模型，重放原键不能恢复旧目标',async()=>{
  const{guest:g}=await h.locked(p),input=await h.input(g),key=randomUUID();await h.good(p,'/sessions/'+g.id+'/speaker-events',input,key);await h.focusOp(g,'reacquire',{sameVisitorConfirmed:true});const compose=vi.spyOn(NativeReception.prototype,'composeReply');
  for(const k of [key,randomUUID()])expect(await h.good(p,'/sessions/'+g.id+'/speaker-events',input,k)).toMatchObject({accepted:false,reason:'stale_focus'});
  const result=await h.goodGuest<{accepted:boolean}>(g,'/events',{type:'audio.segment',segmentId:randomUUID(),attribution:'target',final:true,focusVersion:2,source:'mock_audio',text:'客户端伪造字幕'});expect(result.accepted).toBe(false);expect(compose).not.toHaveBeenCalled();expect((await h.counts(g)).sources).toBe(1);
 });
 it('模型生成失败会回滚决定、来源、回执和问题，原键可在恢复后使用',async()=>{
  const{guest:g}=await h.locked(p),input=await h.input(g),key=randomUUID(),before=await h.counts(g),session=(await h.current(g)).session,compose=vi.spyOn(NativeReception.prototype,'composeReply').mockRejectedValueOnce(new Error('synthetic answer failure'));
  const failed=await h.post(p,'/sessions/'+g.id+'/speaker-events',input,key);expect(failed.statusCode).toBe(503);expect(failed.json().error.code).toBe('PG_OPERATION_FAILED');expect(await h.counts(g)).toEqual(before);expect((await h.current(g)).session).toEqual(session);compose.mockRestore();expect(await h.good(p,'/sessions/'+g.id+'/speaker-events',input,key)).toMatchObject({accepted:true});expect((await h.counts(g)).sources).toBe(1);
 });
 it('上下文签名被替换时在模型前拒绝，整个事务回滚',async()=>{
  const{guest:g}=await h.locked(p),before=await h.counts(g),original=NativeSpeaker.prototype.call,compose=vi.spyOn(NativeReception.prototype,'composeReply');
  vi.spyOn(NativeSpeaker.prototype,'call').mockImplementation(async function(this:NativeSpeaker,name:string,args:unknown[]=[]){const value=await original.call(this,name,args);if(name==='dg_native_speaker_event_context')return{...(value as object),signatureHash:'0'.repeat(64)};return value;});
  const r=await h.post(p,'/sessions/'+g.id+'/speaker-events',await h.input(g));expect(r.statusCode).toBe(409);expect(r.json().error.code).toBe('INVALID_SOURCE');expect(compose).not.toHaveBeenCalled();expect(await h.counts(g)).toEqual(before);
 });
 it('事件限于当前空间管理员的明确模拟输入，外部服务未配置不会降级成功',async()=>{
  const{guest:g}=await h.locked(p),input=await h.input(g),viewer=await h.colleague(p,'viewer'),other=await h.person();
  expect((await h.post(viewer,'/sessions/'+g.id+'/speaker-events',input)).statusCode).toBe(403);expect((await h.post(other,'/sessions/'+g.id+'/speaker-events',input)).statusCode).toBe(404);
  expect((await x.app.inject({method:'POST',url:'/api/v1/sessions/'+g.id+'/speaker-events',headers:{...g.headers,'idempotency-key':randomUUID()},payload:input})).statusCode).toBe(401);
  for(const change of [{source:'real_audio'},{accepted:true},{attribution:'target'}])expect((await h.post(p,'/sessions/'+g.id+'/speaker-events',{...input,...change})).statusCode).toBe(400);
  const external=(await h.focusGuest(p,'external-focus')).guest;expect((await h.post(p,'/sessions/'+external.id+'/speaker-events',await h.input(external))).json().error.code).toBe('PROVIDER_NOT_CONFIGURED');
 });
 it('声音参考撤回停止新音频，历史发言证明和本人另行确认的事实仍然有效',async()=>{
  const ref=await h.enroll(p),{guest:g}=await h.focusGuest(p);await h.startEnrolled(g,(await h.authorize(p,ref,g)).useCode);await h.focusOp(g,'reference',{fixture:'clear'});
  let memory=await h.goodGuest<MemoryView>(g,'/memory',{displayName:'原创自愿登记对象',roles:['visitor'],consent:true,noticeVersion:'memory-v1',retentionDays:30,focusVersion:1});
  await h.event(p,g,'target_final','本人偏爱原创森林主题。');const question=(await h.current(g)).session.messages.find(m=>m.role==='visitor')!;
  const proposal={key:'like',value:'原创森林主题',visibility:'reception',expiresAt:memory.person!.expiresAt,sourceMessageId:question.id,focusVersion:1};memory=await h.goodGuest<MemoryView>(g,'/memory/facts',proposal);
  memory=await h.goodGuest<MemoryView>(g,'/memory/facts/decide',{factId:memory.facts[0].id,version:1,action:'confirm',confirmed:true,focusVersion:1});
  await h.good(p,'/speaker-references/'+ref.id+'/delete',{version:1,confirmed:true});expect((await h.focus(g)).state).toBe('ended');
  expect((await h.guestGet(g,'/memory')).json().data.facts[0]).toMatchObject({value:'原创森林主题',status:'confirmed'});
  expect(await x.owner(async db=>(await db.query('SELECT dg_native_speaker_message_valid(m) valid FROM reception_messages m WHERE id=$1',[question.id])).rows[0].valid)).toBe(true);
  const compose=vi.spyOn(NativeReception.prototype,'composeReply');expect((await h.post(p,'/sessions/'+g.id+'/speaker-events',await h.input(g))).json().error.code).toBe('FOCUS_NOT_ACTIVE');expect(compose).not.toHaveBeenCalled();
  expect((await h.guestPost(g,'/memory/facts',{...proposal,focusVersion:2})).json().error.code).toBe('INVALID_SOURCE');
 });
 it('已确认目标声音问记忆时只使用明确开放的已确认偏好，私人和候选值不进入回复',async()=>{
  const{guest:g}=await h.locked(p);let memory=await h.goodGuest<MemoryView>(g,'/memory',{displayName:'原创模拟记忆主体',roles:['visitor'],consent:true,noticeVersion:'memory-v1',retentionDays:30,focusVersion:1});
  await h.event(p,g,'target_final','本人喜欢原创公开主题，也有原创私人主题与原创候选主题。');const sourceMessageId=(await h.current(g)).session.messages.find(m=>m.role==='visitor')!.id;
  for(const[value,visibility,confirmed]of [['原创公开主题','reception',true],['原创私人主题','private',true],['原创候选主题','reception',false]]as const){memory=await h.goodGuest<MemoryView>(g,'/memory/facts',{key:'like',value,visibility,expiresAt:memory.person!.expiresAt,sourceMessageId,focusVersion:1});const fact=memory.facts.find(f=>f.value===value)!;if(confirmed)memory=await h.goodGuest<MemoryView>(g,'/memory/facts/decide',{factId:fact.id,version:fact.version,action:'confirm',confirmed:true,focusVersion:1});}
  await h.goodGuest(g,'/memory/settings',{version:memory.person!.version,displayName:memory.person!.displayName,roles:['visitor'],personalization:true,doNotDisturb:true,quietStart:'00:00',quietEnd:'00:01',cooldownMinutes:5,focusVersion:1});
  await h.event(p,g,'target_final','我的接待偏好是什么？');const reply=(await h.current(g)).session.messages.at(-1)!;expect(reply.text).toContain('原创公开主题');expect(reply.text).not.toContain('原创私人主题');expect(reply.text).not.toContain('原创候选主题');
 });
 it('达到文字消息频率上限时音频先被过滤，PTT许可不被消耗且不调用模型',async()=>{
  const{guest:g}=await h.locked(p);for(let i=0;i<20;i++)await h.message(g,'原创明确文字 '+i,await h.current(g));
  await h.focusOp(g,'fallback',{mode:'ptt',confirmed:true});await h.focusOp(g,'ptt',{confirmed:true});const before=(await h.current(g)).session,compose=vi.spyOn(NativeReception.prototype,'composeReply');
  expect(await h.event(p,g,'ptt_target_final')).toMatchObject({accepted:false,reason:'rate_limited'});expect(compose).not.toHaveBeenCalled();expect((await h.focus(g)).pttReady).toBe(true);expect((await h.current(g)).session).toEqual(before);
 });
 it('失锁或回退清除缓冲，重新确认不复活同一目标中已结束的片段',async()=>{
  const{guest:g}=await h.locked(p,'mock-focus-early'),segmentId=randomUUID();await h.event(p,g,'target_partial','仅短期元数据',{segmentId,sequence:1});expect((await h.focus(g)).counts.buffered).toBe(1);
  await h.event(p,g,'tracking_lost');expect(await h.focus(g)).toMatchObject({state:'uncertain',counts:{buffered:0}});await h.focusOp(g,'reference',{fixture:'clear'});
  expect(await h.event(p,g,'target_partial','重复部分',{segmentId,sequence:1})).toMatchObject({accepted:false,reason:'duplicate_or_out_of_order'});expect((await h.event(p,g,'target_final','真正最终',{segmentId,sequence:2})).accepted).toBe(true);
  await h.event(p,g,'target_partial','另一段');await h.focusOp(g,'fallback',{mode:'ptt',confirmed:true});expect((await h.focus(g)).counts.buffered).toBe(0);
  expect(await h.event(p,g,'ptt_target_final','已结束片段',{segmentId,sequence:3})).toMatchObject({accepted:false,reason:'duplicate_or_out_of_order'});
 });
});
