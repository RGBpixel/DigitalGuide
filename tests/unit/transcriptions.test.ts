import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {transcriptionSubtitles,validateTranscriptionReview} from '../../packages/domain/src/transcriptions.js';
import type {TranscriptionSnapshot} from '@digitalguide/contracts';
describe('文件转写校对与开放字幕',()=>{
  it('字幕沿原视频时间轴，转义标签与额外空行不改变已保存正文',()=>{const review={segments:[{id:randomUUID(),startMs:3100,endMs:4520,text:'<script>测试</script>\n\n下一句 --> 继续 & 完成'}],note:''};expect(transcriptionSubtitles(review,'vtt')).toContain('00:00:03.100 --> 00:00:04.520');expect(transcriptionSubtitles(review,'vtt')).toContain('&lt;script&gt;');expect(transcriptionSubtitles(review,'srt')).toContain('00:00:03,100 --> 00:00:04,520');expect(transcriptionSubtitles(review,'srt')).not.toContain('\n\n下一句');expect(review.segments[0].text).toContain('<script>');});
  it('拒绝重复、乱序、重叠和超出确认区间的校对时间',()=>{const snapshot={configuration:{startMs:3000,durationMs:4000}} as TranscriptionSnapshot,id=randomUUID(),segment={id,startMs:3100,endMs:4500,text:'校对正文'};expect(validateTranscriptionReview({segments:[segment],note:''},snapshot).text).toBe('校对正文');for(const segments of [[segment,{...segment}],[{...segment,startMs:2000}],[{...segment,endMs:8000}],[segment,{...segment,id:randomUUID(),startMs:4000,endMs:5000}]])expect(()=>validateTranscriptionReview({segments,note:''},snapshot)).toThrow('校对片段');});
});
