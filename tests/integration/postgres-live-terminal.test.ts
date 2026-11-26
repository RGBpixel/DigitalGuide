import {beforeAll,beforeEach,afterEach,afterAll,describe,it,expect} from 'vitest';
import {canonical} from '@digitalguide/domain';
import type {LiveSession} from '@digitalguide/contracts';
import {newLiveClock,type LiveSegment} from '../../packages/domain/src/live.js';
import {nativeLiveDigest as digest} from '../../packages/postgres/src/runtime-live-shapes.js';
import {nativeTimelineSnapshot} from '../../packages/postgres/src/runtime-live-timeline-state.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeLibraryHelpers,type NativeTestPerson} from './postgres-library-helpers.js';
import {nativeOutputHelpers} from './postgres-live-output-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';

describe.skipIf(!nativePostgresAvailable)('R-058/R-093/R-097 时间轴容量终止',()=>{
 let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,p:NativeTestPerson,a:ReturnType<typeof nativeOutputHelpers>;
 const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 // Synthetic historical fixture only. A compiled proof separately produces 600 rows through the original API/worker.
 async function fixture(count:number,pendingMs=0,cueDuration=180000){
  const d={...a.definition(),recordingEnabled:true,loop:true,maxDurationMs:1800000,products:[]};d.cues[0].durationMs=cueDuration;
  const r=await a.ready(d);await a.start(r.session);const segments:LiveSegment[]=Array.from({length:count},(_,seq)=>({seq,startMs:seq*2,durationMs:2,cueId:d.cues[0].id,kind:'card',sourceInMs:0,frozen:false,muted:false,text:'虚构历史片段',label:'历史合成容量夹具',backgroundColor:d.backup.color,answerId:null}));
  const clock=newLiveClock();clock.clockAt=Date.now();clock.elapsedMs=count*2+pendingMs;clock.segmentStartMs=count*2;clock.offsetMs=clock.elapsedMs;clock.epoch=2;
  await x.owner(async c=>{await c.query('BEGIN');for(const s of segments)await c.query('INSERT INTO live_segments VALUES($1,$2,$3,$4,dg_utc_now())',[r.session.id,s.seq,canonical(s),digest(s)]);await c.query('UPDATE live_sessions SET state=$1,state_hash=$2 WHERE id=$3',[canonical(clock),digest(clock),r.session.id]);await c.query('COMMIT');});
  return{...r,segments,clock};
 }
 const count=(id:string)=>x.owner(async c=>Number((await c.query('SELECT count(*) AS n FROM live_segments WHERE session_id=$1',[id])).rows[0].n));
 const rows=(id:string)=>x.owner(async c=>(await c.query('SELECT segment,segment_hash FROM live_segments WHERE session_id=$1 ORDER BY seq',[id])).rows);
 beforeAll(async()=>{x=await nativeRuntimeFixture();a=nativeOutputHelpers(x,()=>p);},120000);
 beforeEach(async()=>{p=await nativeLibraryHelpers(x).person();});
 afterEach(async()=>{await a.stopAll();await x.owner(async c=>{await c.query("UPDATE live_recordings SET status='cancelled',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE tenant_id=$1 AND status IN('queued','rendering')",[p.tenant]);await c.query("UPDATE live_sessions SET status='failed',ended_at=dg_utc_now(),version=version+1,error_message='虚构容量用例结束' WHERE tenant_id=$1 AND status IN('ready','scheduled','live','preview')",[p.tenant]);});});
 afterAll(async()=>{await x?.close();},120000);
 it('旧600段场次仍可停止，固定有效前缀且不改原片段',async()=>{
  const f=await fixture(600,700),before=await rows(f.session.id),s=await a.control(f.session.id,'stop');expect(s.status).toBe('ended');expect(s.terminalReason).toContain('600段');expect(s.available).toBe(true);expect(s.unavailableReason).toBeNull();expect(s.playhead.elapsedMs).toBe(1200);expect(s.recording?.durationMs).toBe(1200);expect(s.recording?.status).toBe('queued');expect(await rows(s.id)).toEqual(before);
  const raw=await x.owner(async c=>(await c.query('SELECT snapshot FROM live_recordings WHERE session_id=$1',[s.id])).rows[0]),snapshot=nativeTimelineSnapshot.parse(JSON.parse(raw.snapshot));expect(snapshot.segments).toHaveLength(600);expect(snapshot.durationMs).toBe(snapshot.segments.reduce((n,v)=>n+v.durationMs,0));
 });
 it('第600段由控制命令收尾时直接结束，不再启动下一状态',async()=>{
  const f=await fixture(599);await pause(30);const s=await a.control(f.session.id,'mute');expect(s.status).toBe('ended');expect(s.playhead.muted).toBe(false);expect(await count(s.id)).toBe(600);expect(s.recording?.status).toBe('queued');expect(s.terminalReason).toContain('新建场次');
 });
 it('worker在最后节目边界自动结束，一次归档且后续扫描不追加',async()=>{
  const f=await fixture(599,0,1200);await pause(50);await a.tick();await a.tick();const s=await a.session(f.session.id);expect(s.status).toBe('ended');expect(await count(s.id)).toBe(600);expect(s.recording?.status).toBe('queued');expect(s.terminalReason).toContain('600段');expect(await x.owner(async c=>Number((await c.query('SELECT count(*) AS n FROM live_recordings WHERE session_id=$1',[s.id])).rows[0].n))).toBe(1);
 });
 it('来源失效时也能保存终态，不把失败场次伪装为可用成片',async()=>{
  const f=await fixture(600,200);await x.owner(c=>c.query("UPDATE live_sessions SET invalidated_at=dg_utc_now() WHERE id=$1",[f.session.id]));await a.tick();const s=await a.session(f.session.id);expect(s.status).toBe('failed');expect(s.available).toBe(false);expect(s.recording).toBeNull();expect(await count(s.id)).toBe(600);
 });
 it('只读、跨空间的容量满额不会变成停止权限',async()=>{
  const f=await fixture(600),viewer=await a.member(),privateMember=await a.member('admin',p.privateWorkspace),body={version:2,epoch:2,action:'stop',confirmed:true};expect((await a.post('/live-sessions/'+f.session.id+'/control',body,viewer)).statusCode).toBe(403);expect((await a.post('/live-sessions/'+f.session.id+'/control',body,privateMember)).statusCode).toBe(404);expect((await a.session(f.session.id)).status).toBe('live');
 });
 it('同键停止只保留一个终态、归档及审计',async()=>{
  const f=await fixture(600),key=crypto.randomUUID(),body={version:2,epoch:2,action:'stop',confirmed:true},s=await a.good<LiveSession>('/live-sessions/'+f.session.id+'/control',body,p,key);const replay=await a.good<LiveSession>('/live-sessions/'+f.session.id+'/control',body,p,key);expect(replay.version).toBe(s.version);expect(replay.recording?.id).toBe(s.recording?.id);expect(await x.owner(async c=>Number((await c.query("SELECT count(*) AS n FROM audit_events WHERE resource_id=$1 AND action='live.ended'",[s.id])).rows[0].n))).toBe(1);
 });
 it('显式插播在填满最后片段时结束并取消待播答复',async()=>{
  const f=await fixture(599);const s=await a.session(f.session.id);let q=await a.good<{id:string;version:number}>('/live-sessions/'+s.id+'/audience-events',{destinationId:s.destinations[0].id,eventId:crypto.randomUUID(),participantRef:crypto.randomUUID(),nickname:'虚构观众',kind:'question',text:'虚构问题',mediaOptIn:'none',synthetic:true});q=await a.good('/audience-questions/'+q.id+'/moderate',{version:q.version,decision:'queue',priority:1,confirmed:true});q=await a.good('/audience-questions/'+q.id+'/answer',{version:q.version,kind:'manual',text:'主持已确认的待播答复',confirmed:true});const current=await a.session(s.id);const result=await a.good<LiveSession>('/audience-questions/'+q.id+'/play',{version:q.version,sessionVersion:current.version,epoch:current.epoch,durationMs:1000,confirmed:true});expect(result.status).toBe('ended');expect(result.questions.find(v=>v.id===q.id)?.status).toBe('cancelled');expect(await count(s.id)).toBe(600);
 });
});
