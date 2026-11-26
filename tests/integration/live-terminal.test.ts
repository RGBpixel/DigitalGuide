import {beforeEach,afterEach,it,expect} from 'vitest';
import type {LiveSession} from '@digitalguide/contracts';
import {canonical} from '@digitalguide/domain';
import {harness} from './helpers.js';
import {shareApi} from './share-helpers.js';
import {liveStarted} from './live-helpers.js';
import {liveDefinitionFixture} from '../../packages/test-fixtures/src/live.js';
import {liveDigest} from '../../apps/api/src/live-service.js';
import type {LiveClock,LiveSegment} from '../../packages/domain/src/live.js';
let h:Awaited<ReturnType<typeof harness>>;beforeEach(async()=>{h=await harness();});afterEach(async()=>{await h.close();});
async function fixture(count:number){const d=liveDefinitionFixture();d.recordingEnabled=true;d.loop=true;d.products=[];d.cues[0].durationMs=180000;const {session}=await liveStarted(h,d),row=h.repo.get<{state:string;version:number}>('SELECT state,version FROM live_sessions WHERE id=?',session.id)!,s=JSON.parse(row.state)as LiveClock;
 h.repo.transaction(()=>{for(let seq=0;seq<count;seq++){const v:LiveSegment={seq,startMs:seq*2,durationMs:2,cueId:d.cues[0].id,kind:'card',sourceInMs:0,frozen:false,muted:false,text:'虚构旧片段',label:'历史容量夹具',backgroundColor:d.backup.color,answerId:null};h.repo.run('INSERT INTO live_segments VALUES(?,?,?,?,?)',session.id,seq,canonical(v),liveDigest(v),new Date().toISOString());}s.elapsedMs=count*2+100;s.segmentStartMs=count*2;s.offsetMs=s.elapsedMs;s.clockAt=Date.now();h.repo.run('UPDATE live_sessions SET state=?,state_hash=? WHERE id=?',canonical(s),liveDigest(s),session.id);});return{session,row,s};
}
it('SQLite旧满额停止保留600段与归档范围，容量原因不使授权文件失效',async()=>{const f=await fixture(600),api=shareApi(h),s=await api.good<LiveSession>('/live-sessions/'+f.session.id+'/control',{version:f.row.version,epoch:f.s.epoch,action:'stop',confirmed:true});expect(s.status).toBe('ended');expect(s.terminalReason).toContain('600段');expect(s.available).toBe(true);expect(s.unavailableReason).toBeNull();expect(s.playhead.elapsedMs).toBe(1200);expect(s.recording?.durationMs).toBe(1200);expect(h.repo.get<{n:number}>('SELECT count(*) AS n FROM live_segments WHERE session_id=?',s.id)!.n).toBe(600);});
it('SQLite最后控制片段结束后不再切换静音状态',async()=>{const f=await fixture(599),s=await shareApi(h).good<LiveSession>('/live-sessions/'+f.session.id+'/control',{version:f.row.version,epoch:f.s.epoch,action:'mute',confirmed:true});expect(s.status).toBe('ended');expect(s.playhead.muted).toBe(false);expect(s.terminalReason).toContain('600段');expect(s.available).toBe(true);});
