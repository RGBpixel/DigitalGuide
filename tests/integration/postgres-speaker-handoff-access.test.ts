import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {NativeSpeakerHandoff} from '../../packages/postgres/src/runtime-speaker-handoff.js';
import {NativeReception} from '../../packages/postgres/src/runtime-reception.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeSpeakerHandoffHelpers} from './postgres-speaker-handoff-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,api:NativePostgresDatabase,h:ReturnType<typeof nativeSpeakerHandoffHelpers>,service:NativeSpeakerHandoff;
describe.skipIf(!nativePostgresAvailable)('原生访客交接受控SQL与原子绑定',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture();h=nativeSpeakerHandoffHelpers(x);api=await NativePostgresDatabase.open(x.result.api,'api');service=new NativeSpeakerHandoff(new NativeCoreRepository(api),x.config.sessionSecret);},60000);afterAll(async()=>{await api?.close();await x?.close();});
 async function denied(db:NativePostgresDatabase,sql:string,args:unknown[]=[]){let code:string|undefined;await expect(db.transaction(async()=>{try{await db.query(sql,args);}catch(e){code=(e as{code:string}).code;throw e;}})).rejects.toThrow();expect(code).toBe('42501');}
 it('API和worker不能直接读取或改写交接表，内部恢复/授权助手不对运行角色开放',async()=>{
  for(const db of [api,x.workerDb]){for(const table of ['_dg_native_speaker_handoffs','_dg_native_speaker_handoff_origins']){await denied(db,'SELECT * FROM '+table);await denied(db,'DELETE FROM '+table);}
   await denied(db,'SELECT dg_native_speaker_handoff_scope($1,$2,$3,$4,$5)',[randomUUID(),'0'.repeat(64),'0'.repeat(64),randomUUID(),'0'.repeat(64)]);await denied(db,'SELECT dg_native_speaker_handoff_lock($1,$2,$3,$4,$5)',[randomUUID(),'0'.repeat(64),'0'.repeat(64),randomUUID(),'0'.repeat(64)]);await denied(db,'SELECT dg_native_reception_authorize_before_handoff($1,$2,$3,$4)',[randomUUID(),'0'.repeat(64),null,false]);await denied(db,'SELECT dg_native_speaker_sweep_before_handoff()');
  }await denied(x.workerDb,'SELECT dg_native_speaker_handoff_descriptor($1,$2,$3,$4)',[randomUUID(),'0'.repeat(64),randomUUID(),'0'.repeat(64)]);
 });
 it('绕过HTTP也不能跳过预锁定或漏掉新访问绑定，失败不留下旧结束或孤立新会话',async()=>{
  const p=await h.person(),{guest:g}=await h.locked(p),prepared=await h.prepareHandoff(g),raw=decodeURIComponent(g.cookie.slice(g.cookie.indexOf('=')+1)),reception=new NativeReception(service.core),proof=reception.credentials(x.config.sessionSecret,x.result.api.runtimeId,g.id,raw),intent=service.credentials(g.id,decodeURIComponent(prepared.cookie.slice(prepared.cookie.indexOf('=')+1))),before=await h.handoffCount(g),session=(await h.current(g)).session;
  const args=[g.id,proof.tokenHash,proof.csrfHash,intent.id,intent.hash,prepared.body];
  await expect(api.transaction(()=>service.speaker.call('dg_native_speaker_handoff_apply',args))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(api.transaction(async()=>{await service.prelock(g.id,proof,intent);return service.speaker.call('dg_native_speaker_handoff_apply',args);})).rejects.toThrow();
  expect(await h.handoffCount(g)).toEqual(before);expect((await h.current(g)).session).toEqual(session);expect((await h.commitHandoff(g,prepared)).statusCode).toBe(200);
 });
 it('意图不能修改原授权、期限、下一对象或复活已领取的凭证',async()=>{
  const p=await h.person(),{guest:g}=await h.locked(p),prepared=await h.prepareHandoff(g),r=await h.commitHandoff(g,prepared);expect(r.statusCode,r.payload).toBe(200);await h.claimHandoff(r);
  for(const[sql,args]of [
   ['UPDATE _dg_native_speaker_handoff_origins SET expires_at=$1 WHERE id=$2',[new Date(Date.now()+120000).toISOString(),prepared.intentId]],
   ['UPDATE _dg_native_speaker_handoffs SET next_session_id=$1 WHERE id=$2',[g.id,prepared.intentId]],
   ["UPDATE _dg_native_speaker_handoffs SET state='committed',token_hash=$1 WHERE id=$2",['0'.repeat(64),prepared.intentId]],
   ['DELETE FROM _dg_native_speaker_handoff_origins WHERE id=$1',[prepared.intentId]]
  ]as[string,unknown[]][])await expect(x.owner(db=>db.query(sql,args))).rejects.toThrow();
  const state=await x.owner(async db=>(await db.query('SELECT state,token_hash FROM _dg_native_speaker_handoffs WHERE id=$1',[prepared.intentId])).rows[0]);expect(state).toEqual({state:'claimed',token_hash:''});
 });
 it('孤立的伪造准备或越权管理员样例不能通过数据库最终约束',async()=>{
  const p=await h.person(),{guest:g}=await h.locked(p);await expect(x.owner(db=>db.query("INSERT INTO _dg_native_speaker_handoffs SELECT $1,id,(SELECT id FROM _dg_native_reception_access WHERE session_id=$2 ORDER BY created_at DESC LIMIT 1),'prepared',$3,NULL,NULL,NULL,NULL,dg_utc_now(),pg_current_xact_id()::text FROM reception_sessions WHERE id=$2",[randomUUID(),g.id,'0'.repeat(64)]))).rejects.toThrow();
  await expect(api.transaction(()=>service.speaker.call('dg_native_speaker_staff_sample',[g.id,{version:1,focusVersion:1,fixture:'clear'},{}]))).rejects.toThrow();expect((await h.handoffCount(g)).intents).toBe(0);
 });
});
