import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {NativeSpeaker} from '../../packages/postgres/src/runtime-speaker.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeSpeakerEventHelpers} from './postgres-speaker-event-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,h:ReturnType<typeof nativeSpeakerEventHelpers>;
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));

describe.skipIf(!nativePostgresAvailable)('原生声音缓冲与PTT原期限自然失效',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture();h=nativeSpeakerEventHelpers(x);},60000);afterAll(async()=>{await x?.close();});
 it('关闭API后worker按原五秒清理元数据，原十秒PTT许可自然过期且不续活动或绝对期限',async()=>{
  const p=await h.person(),a=await h.locked(p),b=await h.locked(p),speaker=new NativeSpeaker(x.repo,x.config.sessionSecret);
  await h.event(p,a.guest,'target_partial','绝不保存的原始部分字幕');await h.focusOp(b.guest,'fallback',{mode:'ptt',confirmed:true});await h.focusOp(b.guest,'ptt',{confirmed:true});
  const before=await x.owner(async db=>({sessions:(await db.query('SELECT id,activity_at,expires_at,focus_version,version FROM reception_sessions WHERE id=ANY($1::text[]) ORDER BY id',[[a.guest.id,b.guest.id]])).rows,partial:(await db.query('SELECT * FROM _dg_native_speaker_pending WHERE session_id=$1',[a.guest.id])).rows[0],permit:(await db.query('SELECT * FROM speaker_ptt_permits WHERE session_id=$1',[b.guest.id])).rows[0]}));
  const keys=Object.fromEntries(['.session-secret','.provenance-secret'].map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(x.result.api.dataDir,n))).digest('hex')]));
  expect(Date.parse(before.partial.expires_at)-Date.parse(before.partial.created_at)).toBe(5000);expect(Date.parse(before.permit.expires_at)-Date.parse(before.permit.created_at)).toBe(10000);
  await x.app.close();await pause(Math.max(1,Date.parse(before.partial.expires_at)-Date.now()+100));await x.workerDb.transaction(()=>speaker.sweep());
  expect((await x.owner(async db=>(await db.query('SELECT * FROM _dg_native_speaker_pending WHERE session_id=$1',[a.guest.id])).rows))).toEqual([]);
  await pause(Math.max(1,Date.parse(before.permit.expires_at)-Date.now()+100));await x.workerDb.transaction(()=>speaker.sweep());
  const after=await x.owner(async db=>({sessions:(await db.query('SELECT id,activity_at,expires_at,focus_version,version FROM reception_sessions WHERE id=ANY($1::text[]) ORDER BY id',[[a.guest.id,b.guest.id]])).rows,permit:(await db.query('SELECT * FROM speaker_ptt_permits WHERE session_id=$1',[b.guest.id])).rows}));
  expect(after.sessions).toEqual(before.sessions);expect(after.permit).toEqual([]);for(const[name,hash]of Object.entries(keys))expect(createHash('sha256').update(fs.readFileSync(path.join(x.result.api.dataDir,name))).digest('hex')).toBe(hash);
 },25000);
});
