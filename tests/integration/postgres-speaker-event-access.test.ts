import {createHash,randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {NativeSpeaker} from '../../packages/postgres/src/runtime-speaker.js';
import {nativeVisitHash} from '../../packages/postgres/src/runtime-visit-hash.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeSpeakerEventHelpers} from './postgres-speaker-event-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,api:NativePostgresDatabase,h:ReturnType<typeof nativeSpeakerEventHelpers>,speaker:NativeSpeaker;

describe.skipIf(!nativePostgresAvailable)('原生声音事件受控SQL、来源完整性与失败原子性',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture();h=nativeSpeakerEventHelpers(x);api=await NativePostgresDatabase.open(x.result.api,'api');speaker=new NativeSpeaker(new NativeCoreRepository(api),x.config.sessionSecret);},60000);
 afterAll(async()=>{await api?.close();await x?.close();});
 async function denied(db:NativePostgresDatabase,sql:string,args:unknown[]=[]){let code:string|undefined;await expect(db.transaction(async()=>{try{await db.query(sql,args);}catch(e){code=(e as{code:string}).code;throw e;}})).rejects.toThrow();expect(code).toBe('42501');}
 it('API和worker不能读取或改写六张来源及缓冲表，worker不能调用事件入口',async()=>{
  for(const db of [api,x.workerDb])for(const table of ['_dg_native_speaker_ingress','_dg_native_speaker_event_origins','_dg_native_speaker_event_signatures','_dg_native_speaker_message_sources','_dg_native_speaker_streams','_dg_native_speaker_pending']){await denied(db,'SELECT * FROM '+table);await denied(db,'DELETE FROM '+table);}
  for(const db of [api,x.workerDb])for(const fn of ['dg_native_speaker_event_current($1)','dg_native_speaker_event_actor($1)','dg_native_speaker_sweep_before_events()'])await denied(db,'SELECT '+fn,fn.includes('$1')?[randomUUID()]:[]);
  await denied(x.workerDb,'SELECT dg_native_speaker_event_prepare($1,$2,$3)',[randomUUID(),{},{}]);await denied(x.workerDb,'SELECT dg_native_speaker_event_receipt($1,$2)',[randomUUID(),randomUUID()]);
 });
 it('SQL入口仍要求当前管理员、明确模拟来源与有效字段',async()=>{
  const p=await h.person(),viewer=await h.colleague(p,'viewer'),{guest:g}=await h.locked(p),input=await h.input(g),before=await h.counts(g);
  for(const actor of [null,viewer.user])await expect(api.transaction(async()=>{if(actor)await api.query("SELECT set_config('digitalguide.actor_id',$1,true)",[actor]);const hint=await speaker.prelock(g.id,null);await speaker.event(g.id,input,hint);})).rejects.toThrow();
  for(const change of [{source:'real_audio'},{sequence:32},{focusVersion:'1'},{fixture:'unknown'},{accepted:true}])await expect(api.transaction(async()=>{await api.query("SELECT set_config('digitalguide.actor_id',$1,true)",[p.user]);const hint=await speaker.prelock(g.id,null);await speaker.call('dg_native_speaker_event_prepare',[g.id,{...input,...change},hint]);})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  expect(await h.counts(g)).toEqual(before);
 });
 it('有签名的已接受决定缺少最终问题或回复时不能提交',async()=>{
  const p=await h.person(),{guest:g}=await h.locked(p),input=await h.input(g),before=await h.counts(g);
  await expect(api.transaction(async()=>{
   await api.query("SELECT set_config('digitalguide.actor_id',$1,true)",[p.user]);const hint=await speaker.prelock(g.id,null),prepared=await speaker.call<{descriptor:Parameters<NativeSpeaker['eventSignature']>[0]}>('dg_native_speaker_event_prepare',[g.id,input,hint]);
   await speaker.call('dg_native_speaker_event_bind',[prepared.descriptor.decisionId,nativeVisitHash(prepared.descriptor),speaker.eventSignature(prepared.descriptor)]);
  })).rejects.toThrow();expect(await h.counts(g)).toEqual(before);
 });
 it('被替换的描述摘要、最终正文以及跨事务上下文都不能冒充原来源',async()=>{
  const p=await h.person(),{guest:g}=await h.locked(p),input=await h.input(g),before=await h.counts(g);
  for(const kind of ['descriptor','text'])await expect(api.transaction(async()=>{
   await api.query("SELECT set_config('digitalguide.actor_id',$1,true)",[p.user]);const hint=await speaker.prelock(g.id,null),prepared=await speaker.call<{descriptor:Parameters<NativeSpeaker['eventSignature']>[0]}>('dg_native_speaker_event_prepare',[g.id,input,hint]),d=prepared.descriptor;
   await speaker.call('dg_native_speaker_event_bind',[d.decisionId,kind==='descriptor'?'0'.repeat(64):nativeVisitHash(d),speaker.eventSignature(d)]);
   await speaker.call('dg_native_speaker_event_finish',[d.decisionId,{text:'被替换的最终正文',reply:'【模拟回复】不可采用。',citations:[],memory:null}]);
  })).rejects.toMatchObject({code:'INVALID_SOURCE'});
  expect(await h.counts(g)).toEqual(before);const result=await h.event(p,g);
  await expect(api.transaction(async()=>{await api.query("SELECT set_config('digitalguide.actor_id',$1,true)",[p.user]);return speaker.call('dg_native_speaker_event_context',[result.decisionId]);})).rejects.toMatchObject({code:'INVALID_SOURCE'});
 });
 it('直接写入未证明音频、改写已接受正文、来源或签名都会失败',async()=>{
  const p=await h.person(),{guest:g}=await h.locked(p),result=await h.event(p,g),before=await h.counts(g),question=(await h.current(g)).session.messages.find(m=>m.role==='visitor')!;
  await expect(x.owner(db=>db.query("INSERT INTO reception_messages(id,session_id,tenant_id,workspace_id,role,text,status,reply_epoch,focus_version,created_at,input_source,speaker_decision_id) SELECT $1,id,tenant_id,workspace_id,'visitor','伪造来源','received',reply_epoch,focus_version,dg_utc_now(),'verified_mock_audio',$2 FROM reception_sessions WHERE id=$3",[randomUUID(),result.decisionId,g.id]))).rejects.toThrow();
  for(const [sql,args]of [
   ["UPDATE reception_messages SET text='改写后的内容' WHERE id=$1",[question.id]],
   ["UPDATE _dg_native_speaker_event_origins SET descriptor='{}' WHERE decision_id=$1",[result.decisionId]],
   ["UPDATE _dg_native_speaker_event_signatures SET signature_hash=$1 WHERE decision_id=$2",[createHash('sha256').update('wrong').digest('hex'),result.decisionId]],
   ["DELETE FROM speaker_segment_decisions WHERE id=$1",[result.decisionId]]
  ]as [string,unknown[]][])await expect(x.owner(db=>db.query(sql,args))).rejects.toThrow();
  expect(await h.counts(g)).toEqual(before);
 });
});
