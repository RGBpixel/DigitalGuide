import {it,expect} from 'vitest';
import {newLiveClock,advanceLiveClock,openLiveSegment} from '../../packages/domain/src/live.js';
import {advanceProducedFrame} from '../../packages/domain/src/live-output.js';
import {liveDefinitionFixture} from '../../packages/test-fixtures/src/live.js';

it('第600段自然闭合时立即终止，不继续跨越循环补造第601段',()=>{
 const d=liveDefinitionFixture();d.loop=true;d.maxDurationMs=1800000;d.cues[0].durationMs=1000;
 const s=newLiveClock();s.clockAt=100;openLiveSegment(d,s);const r=advanceLiveClock(d,s,5100,599);
 expect(r.segments.map(v=>v.seq)).toEqual([599]);expect(r.state.stopped).toBe(true);expect(r.state.elapsedMs).toBe(1000);expect(r.state.clockAt).toBeNull();expect(s.elapsedMs).toBe(0);
});
it('旧满额场次只保留已记录时间轴，不将未记录尾段伪称已归档',()=>{
 const d=liveDefinitionFixture(),s=newLiveClock();s.clockAt=100;s.elapsedMs=1700;s.segmentStartMs=1200;s.offsetMs=1700;
 const r=advanceLiveClock(d,s,9000,600);expect(r.segments).toEqual([]);expect(r.state.elapsedMs).toBe(1200);expect(r.state.offsetMs).toBe(1200);expect(r.state.stopped).toBe(true);expect(r.state.clockAt).toBeNull();
});
it('第600段是已完成答复时只确认该答复，不继续播放主线',()=>{
 const d=liveDefinitionFixture(),s=newLiveClock();s.clockAt=100;s.surface='answer';s.answerId=crypto.randomUUID();s.answerText='已确认答复';s.answerRemainingMs=1000;s.offsetMs=2100;
 const r=advanceLiveClock(d,s,4100,599);expect(r.segments).toHaveLength(1);expect(r.answered).toEqual([s.answerId]);expect(r.state.stopped).toBe(true);expect(r.state.elapsedMs).toBe(1000);expect(r.state.offsetMs).toBe(2100);
});
it('实际输出帧在最后时间轴边界终止，不再推进后续帧时钟',()=>{
 const d=liveDefinitionFixture();d.loop=true;d.cues[0].durationMs=1000;const s=newLiveClock();s.elapsedMs=958;s.offsetMs=958;openLiveSegment(d,s);
 const r=advanceProducedFrame(d,s,23,true,true,599);expect(r.state.stopped).toBe(true);expect(r.segments).toHaveLength(1);expect(r.state.elapsedMs).toBe(1000);
 const later=advanceProducedFrame(d,r.state,24,true,true,600);expect(later.state.elapsedMs).toBe(1000);expect(later.segments).toEqual([]);
});
