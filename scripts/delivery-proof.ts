// Repeatable, original synthetic fixtures for the compiled local delivery worker.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { blankStudioDocument,type DeliverySettings } from '@digitalguide/contracts';
import { enableTimeline,newTimelineClip,fullTransform } from '../packages/domain/src/timeline.js';
import { syntheticToneWav } from '@digitalguide/media';
import { runDelivery } from '../packages/media/src/run-delivery.js';
import { fileDigest } from '../packages/media/src/files.js';
import { probeLocalMedia,mediaTools,runMediaTool } from '../packages/media/src/media-tools.js';
const root = process.cwd(),base = path.resolve(root,'storage/validation/delivery-'+randomUUID()),objects = path.join(base,'objects'),evidence = path.resolve(root,process.argv[2] || 'docs/evidence/T10');
if (!evidence.startsWith(path.resolve(root,'docs/evidence')+path.sep)) throw new Error('Proof output must stay under docs/evidence.');
fs.mkdirSync(objects,{ recursive: true });fs.mkdirSync(evidence,{ recursive: true });
const audioId = randomUUID(),audioKey = randomUUID()+'.wav';fs.writeFileSync(path.join(objects,audioKey),syntheticToneWav(1000,700),{ flag: 'wx' });
const document = blankStudioDocument();document.canvas.width = 720;document.canvas.height = 1280;document.segments[0].durationMs = 1000;document.segments[0].speakerId = null;document.segments[0].elements = [];document.segments[0].text = '原创编译版输出验证';enableTimeline(document);for (const track of document.timeline!.tracks) track.clips = [];
document.timeline!.tracks.find(t => t.type === 'overlay')!.clips.push(newTimelineClip({ type: 'shape',shape: 'ellipse',color: '#237E66' },{ durationMs: 1000,transform: { ...fullTransform(),x: 0.2,y: 0.1,width: 0.6,height: 0.6 } }));
document.timeline!.tracks.find(t => t.type === 'subtitle')!.clips.push(newTimelineClip({ type: 'segment_subtitle' },{ durationMs: 1000,segmentId: document.segments[0].id,transform: { ...fullTransform(),x: 0.1,y: 0.8,width: 0.8,height: 0.12 } }));
document.timeline!.tracks.find(t => t.type === 'music')!.clips.push(newTimelineClip({ type: 'asset',assetId: audioId },{ durationMs: 1000,loop: true,volume: 0.5 }));
const settings: DeliverySettings = { preset: 'hd',fps: 25,transparent: false,omitBackground: false,burnSubtitles: true },previous = process.env.APP_ENV,results: unknown[] = [];
process.env.APP_ENV = 'production';
try {
  for (const test of [
    { name: 'portrait',kind: 'video' as const,durationMs: 1000,settings,expected: { width: 1080,height: 1920,codec: 'h264' } },
    { name: '4k-alpha',kind: 'video' as const,durationMs: 250,settings: { ...settings,preset: 'uhd' as const,fps: 24 as const,transparent: true,omitBackground: true,burnSubtitles: false },expected: { width: 3840,height: 2160,codec: 'prores' } },
    { name: 'long-audio',kind: 'audio' as const,durationMs: 31000,settings,expected: null }
  ]) {
    const doc = structuredClone(document);if (test.name !== 'portrait') { doc.canvas.width = 1280;doc.canvas.height = 720; }if (test.kind === 'audio') doc.timeline!.tracks.find(t => t.type === 'music')!.clips[0].durationMs = 31000;
    const rendered = await runDelivery({ document: doc,images: {},audio: { [audioId]: audioKey },objects,directory: path.join(base,test.name),root,startMs: 0,durationMs: test.durationMs,delivery: test.settings,kind: test.kind },new AbortController().signal,() => {}),primary = rendered.files.find(f => f.kind === test.kind)!,probe = await probeLocalMedia(primary.file,root),video = probe.streams.find(s => s.codec_type === 'video'),audio = probe.streams.find(s => s.codec_type === 'audio');
    if (audio?.sample_rate !== '48000' || audio.channels !== 2 || Math.abs(Number(probe.format.duration)*1000-test.durationMs) > 100 || (test.expected && (video?.width !== test.expected.width || video.height !== test.expected.height || video.codec_name !== test.expected.codec))) throw new Error('Compiled delivery specs mismatch');
    let alpha: { min: number;max: number;partialPixels: number }|null = null;
    if (test.settings.transparent) {
      const frameFile = path.join(evidence,'compiled-4k-alpha-frame.png');if (fs.existsSync(frameFile)) fs.unlinkSync(frameFile);
      await runMediaTool(mediaTools(root).ffmpeg,['-v','error','-nostdin','-n','-i',primary.file,'-frames:v','1','-vf','format=rgba','-update','1',frameFile],undefined,30000);
      const frame = PNG.sync.read(fs.readFileSync(frameFile));let min = 255,max = 0,partialPixels = 0;for (let i = 3;i < frame.data.length;i += 4) { const a = frame.data[i];min = Math.min(min,a);max = Math.max(max,a);if (a > 0 && a < 255) partialPixels++; }alpha = { min,max,partialPixels };
      if (min !== 0 || max !== 255 || partialPixels < 100 || !video?.pix_fmt?.startsWith('yuva444p')) throw new Error('Compiled Alpha channel missing');
    }
    const file = test.kind === 'video' ? path.join(evidence,'compiled-'+test.name+path.extname(primary.file)) : primary.file;
    if (test.kind === 'video') fs.copyFileSync(primary.file,file);
    const result = { name: test.name,entry: 'dist/studio-delivery.mjs',settings: test.settings,kind: test.kind,file: path.relative(root,file).replace(/\\/g,'/'),...await fileDigest(file),streams: probe.streams,formatDurationMs: Math.round(Number(probe.format.duration)*1000),alpha,originalSyntheticOnly: true };results.push(result);console.log(JSON.stringify({ name: test.name,result: 'PASS',width: video?.width,height: video?.height,alpha }));
  }
  fs.writeFileSync(path.join(evidence,'compiled-delivery-proof.json'),JSON.stringify({ result: 'PASS',createdAt: new Date().toISOString(),entrySha256: (await fileDigest(path.join(root,'dist/studio-delivery.mjs'))).sha256,mode: 'compiled production entry, original local fixtures; no real clone/provider claim',results },null,2));
} finally { if (previous === undefined) delete process.env.APP_ENV;else process.env.APP_ENV = previous; }
