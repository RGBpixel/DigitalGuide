import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createApp} from '../../apps/api/src/app.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {NativeSpeaker,type NativeSpeakerUse} from '../../packages/postgres/src/runtime-speaker.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeSpeakerReferenceHelpers} from './postgres-speaker-reference-helpers.js';
let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,reopened:Awaited<ReturnType<typeof createApp>>|undefined;
describe.skipIf(!nativePostgresAvailable)('登记声音单次使用码原期限自然清理',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture();},60000);afterAll(async()=>{await reopened?.close();await x?.close();});
 it('API关闭后实际等待原六十秒，worker清理未消费码；不延长会话、母参考或活动时间',async()=>{
  const h=nativeSpeakerReferenceHelpers(x),p=await h.person(),r=await h.enroll(p),{guest:g}=await h.focusGuest(p),key=randomUUID(),input={referenceVersion:r.version,sessionId:g.id,confirmed:true},issued=await h.good<NativeSpeakerUse>(p,'/speaker-references/'+r.id+'/authorize-use',input,key),start=await h.enrolledInput(g,issued.useCode),before=(await h.current(g)).session;
  await x.app.close();const worker=new NativeSpeaker(new NativeCoreRepository(x.workerDb),x.config.sessionSecret);
  while(Date.now()<=Date.parse(issued.expiresAt)+100){await x.workerDb.transaction(()=>worker.sweep());await new Promise(resolve=>setTimeout(resolve,Math.min(1000,Math.max(1,Date.parse(issued.expiresAt)+110-Date.now()))));}
  await x.workerDb.transaction(()=>worker.sweep());reopened=await createApp(x.config);
  const reply=await reopened.inject({method:'POST',url:'/api/v1/guest/sessions/'+g.id+'/speaker-focus',headers:{...g.headers,'idempotency-key':randomUUID()},payload:start});expect(reply.statusCode).toBe(409);expect(reply.json().error.code).toBe('REFERENCE_USE_DENIED');
  expect((await h.post(p,'/speaker-references/'+r.id+'/authorize-use',input,key,reopened)).statusCode).toBe(409);
  const rows=await x.owner(async db=>({ticket:(await db.query('SELECT expires_at,token_hash,used_at,revoked_at FROM speaker_use_tickets WHERE id=$1',[issued.id])).rows[0],reference:(await db.query('SELECT expires_at,status,version FROM speaker_references WHERE id=$1',[r.id])).rows[0],session:(await db.query('SELECT expires_at,activity_at,focus_version FROM reception_sessions WHERE id=$1',[g.id])).rows[0]}));
  expect(rows.ticket).toMatchObject({expires_at:issued.expiresAt,token_hash:'',used_at:null});expect(rows.ticket.revoked_at).not.toBeNull();expect(rows.reference).toEqual({expires_at:r.expiresAt,status:'active',version:'1'});expect(rows.session).toEqual({expires_at:before.expiresAt,activity_at:before.activityAt,focus_version:'0'});
 },80000);
});
