import { describe,it,expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { blankStudioDocument } from '@digitalguide/contracts';
import { enableTimeline,newTimelineClip,fullTransform } from '../../packages/domain/src/timeline.js';
import { remapStudioDocument } from '../../packages/domain/src/studio-project.js';
import { createTimelineRenderer } from '../../packages/media/src/timeline-frame.js';
import { writeTimelineAudio,mixTimelineAudio } from '../../packages/media/src/timeline-audio.js';
import { subtitleFiles,timelineSubtitles } from '../../packages/media/src/timeline-subtitles.js';
import { syntheticToneWav,inspectMedia } from '@digitalguide/media';
import { deliveryDimensions } from '../../packages/domain/src/delivery.js';
import { createCanvas } from '@napi-rs/canvas';
function blank() { const d = blankStudioDocument();d.canvas.width = 640;d.canvas.height = 360;d.segments[0].speakerId = null;d.segments[0].elements = [];d.segments[0].text = '';enableTimeline(d);d.timeline!.tracks.forEach(t => { t.clips = []; });return d; }
describe('T10 输出坐标、音频分块与字幕',() => {
  it('相同起点和层级的重叠片段在工程编号重映射后保持像素一致',async () => {
    const d = blank(),track = d.timeline!.tracks.find(t => t.type === 'overlay')!;
    track.clips = [newTimelineClip({ type: 'shape',shape: 'rectangle',color: '#AA2222' },{ transform: { ...fullTransform(),width: 0.6 } }),newTimelineClip({ type: 'shape',shape: 'rectangle',color: '#22AA22' },{ transform: { ...fullTransform(),x: 0.2,width: 0.6 } })];
    track.clips[0].id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';track.clips[1].id = '00000000-0000-4000-8000-000000000000';
    const sample = async (doc: typeof d) => { const r = await createTimelineRenderer(doc,() => { throw Error('No images'); });return Buffer.from(r.render(200,false).canvas.getContext('2d').getImageData(0,0,r.width,r.height).data); };
    const expected = await sample(d);for (let i = 0;i < 4;i++) expect(await sample(remapStudioDocument(d))).toEqual(expected);
    expect([...expected.subarray((100*640+250)*4,(100*640+250)*4+4)]).toEqual([34,170,34,255]);
  });
  it('31秒分块音频保留帧数和30秒边界的源入点、循环与包络',async () => {
    const d = blank(),id = crypto.randomUUID(),track = d.timeline!.tracks.find(t => t.type === 'voice')!;
    track.clips.push(newTimelineClip({ type: 'asset',assetId: id },{ durationMs: 31000,sourceInMs: 137,playbackRate: 1.3,loop: true,envelope: [{ timeMs: 0,gain: 0.2 },{ timeMs: 31000,gain: 0.9 }] }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'digitalguide-delivery-')),file = path.join(dir,'long.wav'),get = () => syntheticToneWav(1000,700);
    try { const result = await writeTimelineAudio(d,get,0,31000,file);expect(result.frames).toBe(1488000);const wav = fs.readFileSync(file);expect(inspectMedia(wav).specs.durationMs).toBe(31000);const boundary = mixTimelineAudio(d,get,29995,10);expect(wav.subarray(44+29995*48*4,44+30005*48*4)).toEqual(boundary.bytes.subarray(44)); }
    finally { if (fs.existsSync(file)) fs.unlinkSync(file);fs.rmdirSync(dir); }
  });
  it('区间字幕使用裁切后的时间点，不导出静音或控制标记，横竖屏有精确目标规格',() => {
    const d = blank(),track = d.timeline!.tracks.find(t => t.type === 'subtitle')!;track.clips.push(newTimelineClip({ type: 'text',text: '<b>第一句</b>\u0000',fontSize: 40,color: '#FFFFFF',bold: false,align: 'left' },{ startMs: 1000,durationMs: 2000 }),newTimelineClip({ type: 'text',text: '不可见',fontSize: 40,color: '#FFFFFF',bold: false,align: 'left' },{ startMs: 1000,durationMs: 2000,muted: true }));
    const cues = timelineSubtitles(d,1500,1000);expect(cues).toEqual([{ startMs: 0,endMs: 1000,text: '&lt;b&gt;第一句&lt;/b&gt;' }]);const files = subtitleFiles(cues);expect(files.srt).toContain('00:00:00,000 --> 00:00:01,000');expect(files.vtt).toContain('WEBVTT\n\n00:00:00.000 --> 00:00:01.000');
    const settings = { preset: 'uhd' as const,fps: 24 as const,transparent: true,omitBackground: true,burnSubtitles: false };expect(deliveryDimensions(d,settings)).toEqual({ width: 3840,height: 2160 });d.canvas.width = 360;d.canvas.height = 640;expect(deliveryDimensions(d,settings)).toEqual({ width: 2160,height: 3840 });
  });
  it('顺序播放的多张大图按当前画面装载，不因全片源图合计像素而拒绝长工程',async () => {
    const d = blank(),track = d.timeline!.tracks.find(t => t.type === 'overlay')!,source = createCanvas(4000,3000);source.getContext('2d').fillStyle = '#2468AC';source.getContext('2d').fillRect(0,0,4000,3000);const bytes = source.toBuffer('image/png');
    for (let i = 0;i < 3;i++) track.clips.push(newTimelineClip({ type: 'asset',assetId: crypto.randomUUID() },{ startMs: i*1000,durationMs: 1000 }));
    const renderer = await createTimelineRenderer(d,() => bytes,640,0,3000,{ width: 1920,height: 1080,flatten: true });for (const time of [100,1100,2100,100]) { const frame = await renderer.renderAsync(time,false);expect([...frame.canvas.getContext('2d').getImageData(800,500,1,1).data]).toEqual([36,104,172,255]); }
  });
});
