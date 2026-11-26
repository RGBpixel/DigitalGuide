import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createApp} from '../../apps/api/src/app.js';
import {NativeSpeaker} from '../../packages/postgres/src/runtime-speaker.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeSpeakerHandoffHelpers} from './postgres-speaker-handoff-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,h:ReturnType<typeof nativeSpeakerHandoffHelpers>;
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
describe.skipIf(!nativePostgresAvailable)('原生访客交接原六十秒期限与领取隔离',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture();h=nativeSpeakerHandoffHelpers(x);},60000);afterAll(async()=>{await x?.close();});
 it('API关闭时worker自然清理准备和未领取交接，不续旧或新时钟；已送出的新凭证独立有效',async()=>{
  const p=await h.person(),a=await h.locked(p),b=await h.locked(p),pa=await h.prepareHandoff(a.guest),pb=await h.prepareHandoff(b.guest),committed=await h.commitHandoff(b.guest,pb);expect(committed.statusCode,committed.payload).toBe(200);const nextId=committed.json().data.sessionId as string,cookie=committed.cookies.find(c=>c.name.startsWith('dg_native_guest_')&&c.value.startsWith('RG1.'))!;expect(cookie).toBeDefined();
  const ids=[a.guest.id,b.guest.id,nextId],before=await x.owner(async db=>({sessions:(await db.query('SELECT id,activity_at,expires_at,focus_version,version FROM reception_sessions WHERE id=ANY($1::text[]) ORDER BY id',[ids])).rows,origins:(await db.query('SELECT id,created_at,expires_at FROM _dg_native_speaker_handoff_origins WHERE id=ANY($1::text[]) ORDER BY id',[[pa.intentId,pb.intentId]])).rows}));for(const o of before.origins)expect(Date.parse(o.expires_at)-Date.parse(o.created_at)).toBe(60000);
  const keys=Object.fromEntries(['.session-secret','.provenance-secret'].map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(x.result.api.dataDir,n))).digest('hex')]));await x.app.close();const speaker=new NativeSpeaker(x.repo,x.config.sessionSecret),last=Math.max(...before.origins.map(o=>Date.parse(o.expires_at)));
  while(Date.now()<=last+150){await x.workerDb.transaction(()=>speaker.sweep());await pause(Math.min(300,Math.max(1,last+200-Date.now())));}await x.workerDb.transaction(()=>speaker.sweep());
  const after=await x.owner(async db=>({sessions:(await db.query('SELECT id,activity_at,expires_at,focus_version,version FROM reception_sessions WHERE id=ANY($1::text[]) ORDER BY id',[ids])).rows,origins:(await db.query('SELECT id,created_at,expires_at FROM _dg_native_speaker_handoff_origins WHERE id=ANY($1::text[]) ORDER BY id',[[pa.intentId,pb.intentId]])).rows,states:(await db.query('SELECT state,token_hash FROM _dg_native_speaker_handoffs WHERE id=ANY($1::text[]) ORDER BY id',[[pa.intentId,pb.intentId]])).rows}));expect(after.sessions).toEqual(before.sessions);expect(after.origins).toEqual(before.origins);expect(after.states).toEqual([{state:'expired',token_hash:''},{state:'expired',token_hash:''}]);
  const reopened=await createApp(x.config);try{for(const[g,intent]of [[a.guest,pa],[b.guest,pb]]as const){const r=await h.commitHandoff(g,intent,intent.operationKey,reopened);expect(r.json().error.code).toBe('HANDOFF_UNAVAILABLE');}
   const claimed=await reopened.inject({url:'/api/v1/guest/sessions/'+nextId,headers:{cookie:cookie.name+'='+encodeURIComponent(cookie.value)}});expect(claimed.statusCode,claimed.payload).toBe(200);expect(claimed.json().data.session.focusVersion).toBe(0);
  }finally{await reopened.close();}
  for(const[n,sha]of Object.entries(keys))expect(createHash('sha256').update(fs.readFileSync(path.join(x.result.api.dataDir,n))).digest('hex')).toBe(sha);
 },80000);
});
