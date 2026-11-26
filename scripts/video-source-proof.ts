// Compiled media workers, original fixtures only. No provider or external channel calls.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { blankStudioDocument } from '@digitalguide/contracts';
import { enableTimeline,newTimelineClip } from '../packages/domain/src/timeline.js';
import { originalVideoFixture } from '../packages/test-fixtures/src/video.js';
import { runVideoInspection } from '../packages/media/src/run-video-inspection.js';
import { runDelivery } from '../packages/media/src/run-delivery.js';
import { fileDigest } from '../packages/media/src/files.js';
import { mediaTools,probeLocalMedia,runMediaTool } from '../packages/media/src/media-tools.js';
const root = process.cwd(),base = path.resolve('storage/validation/video-'+randomUUID()),evidence = path.resolve(process.argv[2] || 'docs/evidence/T10/video-compiled'),objects = path.join(base,'objects');
if (!evidence.startsWith(path.resolve(root,'docs/evidence')+path.sep)) throw new Error('Evidence output must remain inside docs/evidence.');
fs.mkdirSync(objects,{ recursive: true });fs.mkdirSync(evidence,{ recursive: true });
const previous = process.env.APP_ENV;process.env.APP_ENV = 'production';
try {
  const original = await originalVideoFixture(path.join(base,'original'),root,{ width: 3840,height: 2160,fps: 60,durationMs: 500 }),inspection = await runVideoInspection({ file: original,directory: path.join(base,'inspection'),root },new AbortController().signal,() => {});
  if (inspection.specs.width !== 3840 || inspection.specs.height !== 2160 || inspection.specs.fps !== 60) throw new Error('Actual source specs mismatch');
  const assetId = randomUUID(),key = randomUUID()+'.mp4';fs.copyFileSync(original,path.join(objects,key));
  const doc = blankStudioDocument();doc.canvas.width = 3840;doc.canvas.height = 2160;doc.segments[0].durationMs = 1000;doc.segments[0].speakerId = null;doc.segments[0].elements = [];doc.segments[0].text = '';enableTimeline(doc);doc.timeline!.tracks.forEach(t => { t.clips = []; });const clip = newTimelineClip({ type: 'asset',assetId },{ durationMs: 250,playbackRate: 1.5,voiceRole: 'narration' });clip.crop.right = 0.5;doc.timeline!.tracks.find(t => t.type === 'overlay')!.clips.push(clip);
  const result = await runDelivery({ document: doc,images: {},audio: {},videos: { [assetId]: { key,specs: inspection.specs } },objects,directory: path.join(base,'delivery'),root,startMs: 0,durationMs: 250,delivery: { preset: 'uhd',fps: 25,transparent: false,omitBackground: false,burnSubtitles: false },kind: 'video' },new AbortController().signal,() => {}),video = result.files.find(f => f.kind === 'video')!,audio = result.files.find(f => f.kind === 'audio')!,probe = await probeLocalMedia(video.file,root),stream = probe.streams.find(s => s.codec_type === 'video');
  if (stream?.width !== 3840 || stream.height !== 2160 || stream.r_frame_rate !== '25/1') throw new Error('Compiled video output specs mismatch');
  const pngFile = path.join(evidence,'actual-4k-frame.png');if (fs.existsSync(pngFile)) fs.unlinkSync(pngFile);await runMediaTool(mediaTools(root).ffmpeg,['-v','error','-nostdin','-n','-i',video.file,'-frames:v','1','-update','1',pngFile],undefined,30000);const frame = PNG.sync.read(fs.readFileSync(pngFile)),pixel = [...frame.data.subarray((800*frame.width+3000)*4,(800*frame.width+3000)*4+3)];if (pixel.some((v,i) => Math.abs(v-[192,32,32][i]) > 8)) throw new Error('Actual source crop not preserved');
  const wav = fs.readFileSync(audio.file),energy = (hz: number) => { let re = 0,im = 0;for (let i = 2400;i < 9600;i++) { const value = wav.readInt16LE(44+i*4);re += value*Math.cos(i*hz*Math.PI*2/48000);im += value*Math.sin(i*hz*Math.PI*2/48000); }return Math.hypot(re,im); },ratio = energy(600)/energy(400);if (ratio < 10) throw new Error('Compiled original audio playback rate mismatch');
  const outputFile = path.join(evidence,'actual-4k-video-cut.mp4'),sourceFile = path.join(evidence,'original-4k-60fps.mp4');fs.copyFileSync(video.file,outputFile);fs.copyFileSync(original,sourceFile);
  fs.writeFileSync(path.join(evidence,'compiled-video-proof.json'),JSON.stringify({ result: 'PASS',createdAt: new Date().toISOString(),originalSyntheticOnly: true,source: { ...inspection.specs,...await fileDigest(sourceFile) },output: { width: frame.width,height: frame.height,fps: 25,...await fileDigest(outputFile),codec: stream.codec_name,pixelAfterRightHalfCrop: pixel },audio: { expectedHz: 600,originalHz: 400,energyRatio: ratio,frames: (wav.length-44)/4 },compiled: { inspection: (await fileDigest('dist/video-inspect.mjs')).sha256,delivery: (await fileDigest('dist/studio-delivery.mjs')).sha256 },realCloneOrLipSyncClaim: false },null,2));console.log(JSON.stringify({ result: 'PASS',source: [inspection.specs.width,inspection.specs.height,inspection.specs.fps],output: [frame.width,frame.height,25],audioRatio: ratio }));
} finally { if (previous === undefined) delete process.env.APP_ENV;else process.env.APP_ENV = previous; }
