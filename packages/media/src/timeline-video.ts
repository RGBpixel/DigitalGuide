import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { StudioDocument,DeliverySettings } from '@digitalguide/contracts';
import { AppError } from '@digitalguide/domain';
import { createTimelineRenderer,type TimelineImageReference } from './timeline-frame.js';
import { mixTimelineAudio,writeTimelineAudio } from './timeline-audio.js';
import { mediaTools,probeLocalMedia } from './media-tools.js';
import { validateTimeline,timelineDuration } from '../../domain/src/timeline.js';
import { fileDigest } from './files.js';
import { deliveryDimensions } from '../../domain/src/delivery.js';
import { TimelineVideoFrames,TimelinePcmSources } from './timeline-video-sources.js';
import type { VideoFiles } from './video-source.js';
interface TimelineRenderInput { document: StudioDocument;getImage: (ref: TimelineImageReference) => Buffer;getAudio: (assetId: string) => Buffer;videos?: VideoFiles;startMs: number;durationMs: number;directory: string;root: string;signal?: AbortSignal;onProgress?: (fraction: number) => void;delivery?: DeliverySettings }
export async function renderTimelineVideo(input: TimelineRenderInput) {
  fs.mkdirSync(input.directory,{ recursive: true });const dimensions = input.delivery ? deliveryDimensions(input.document,input.delivery) : { width: 640,height: 640 },frames = new TimelineVideoFrames(input.videos || {},input.root,dimensions.width,dimensions.height,input.delivery?.fps || 15,input.signal),pcm = new TimelinePcmSources(input.videos || {},input.directory,input.root,input.signal);
  try { return await renderControlled(input,frames,pcm); } finally { await frames.dispose();await pcm.dispose(); }
}
async function renderControlled(input: TimelineRenderInput,frames: TimelineVideoFrames,pcm: TimelinePcmSources) {
  const { startMs,durationMs,signal,delivery } = input,doc = delivery ? structuredClone(input.document) : input.document;validateTimeline(doc);
  if (!doc.timeline || startMs < 0 || !Number.isInteger(startMs) || !Number.isInteger(durationMs) || durationMs < 100 || durationMs > (delivery ? 10800000 : 30000) || startMs+durationMs > timelineDuration(doc)) throw new AppError('INVALID_PREVIEW_RANGE','请选择工程内的有效输出区间；预览至多30秒，正式输出至多三小时。',409);
  if (delivery && (!['hd','uhd'].includes(delivery.preset) || ![24,25,30,60].includes(delivery.fps))) throw new AppError('INVALID_EXPORT_SETTINGS','输出规格不受支持。',409);
  if (delivery?.transparent) doc.canvas.transparent = true;
  if (delivery) for (const t of doc.timeline.tracks) if ((delivery.omitBackground && t.type === 'background') || (!delivery.burnSubtitles && t.type === 'subtitle')) t.muted = true;
  const size = delivery ? deliveryDimensions(doc,delivery) : null,tools = mediaTools(input.root),renderer = await createTimelineRenderer(doc,input.getImage,640,startMs,startMs+durationMs,size ? { ...size,flatten: !delivery!.transparent,referenceLabels: false } : undefined,frames),id = randomUUID(),videoFile = path.join(input.directory,id+(delivery?.transparent ? '.mov' : '.mp4')),audioFile = path.join(input.directory,id+'.wav');fs.mkdirSync(input.directory,{ recursive: true });
  let audio: { missingClipIds: string[];limitedSamples: number };
  try { if (delivery) audio = await writeTimelineAudio(doc,input.getAudio,startMs,durationMs,audioFile,signal,p => input.onProgress?.(p*0.1),pcm);else { await pcm.prepare(doc,startMs,durationMs);const mixed = mixTimelineAudio(doc,input.getAudio,startMs,durationMs,48000,pcm.get);fs.writeFileSync(audioFile,mixed.bytes,{ flag: 'wx' });audio = mixed; } } catch (e) { if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);throw e; }
  const fps = delivery?.fps || 15,total = Math.ceil(durationMs/1000*fps),alpha = !!delivery?.transparent,videoCodec = alpha ? 'prores_ks' : 'libx264',args = ['-hide_banner','-loglevel','error','-nostdin','-n','-protocol_whitelist','file,pipe','-f','rawvideo','-pixel_format','rgba','-video_size',renderer.width+'x'+renderer.height,'-framerate',String(fps),'-i','pipe:0','-protocol_whitelist','file,pipe','-i',audioFile,'-map','0:v:0','-map','1:a:0','-c:v',videoCodec,'-threads','2',...(alpha ? ['-profile:v','4','-alpha_bits','16','-pix_fmt','yuva444p10le','-c:a','pcm_s16le'] : ['-preset','ultrafast','-crf',delivery ? '20' : '23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k']),'-t',String(durationMs/1000),'-movflags','+faststart',videoFile];
  const child = spawn(tools.ffmpeg,args,{ windowsHide: true,stdio: ['pipe','ignore','pipe'],signal });let stderr = 0;
  child.stderr.on('data',(b: Buffer) => { stderr += b.length;if (stderr > 65536) child.kill(); });child.stdin.on('error',() => { /* Error is reported by process completion/write callback. */ });
  const completed = new Promise<void>((resolve,reject) => { child.once('error',reject);child.once('close',code => code === 0 ? resolve() : reject(new AppError('TIMELINE_ENCODE_FAILED','时间线编码失败，请缩短区间并检查本地工具。',409))); });void completed.catch(() => {});
  const timer = setTimeout(() => child.kill(),delivery ? 6*3600000 : 120000);
  try {
    for (let frame = 0;frame < total;frame++) {
      if (signal?.aborted) throw new AppError('CANCELLED','输出已取消。',409);const { canvas } = await renderer.renderAsync(startMs+frame/fps*1000,!delivery),pixels = Buffer.from(canvas.getContext('2d').getImageData(0,0,renderer.width,renderer.height).data);
      if (!child.stdin.write(pixels)) await Promise.race([once(child.stdin,'drain'),completed.then(() => { throw new Error('编码输入提前结束。'); })]);input.onProgress?.(delivery ? 0.1+(frame+1)/total*0.88 : (frame+1)/total);
      if (delivery && frame%fps === 0 && fs.existsSync(videoFile) && fs.statSync(videoFile).size > 32*1024*1024*1024) throw new AppError('OUTPUT_TOO_LARGE','输出已超过本地单文件32GB限制，请分段导出。',409);
      if (frame % 5 === 0) await new Promise<void>(resolve => setTimeout(resolve,0));
    }
    child.stdin.end();await completed;const probe = await probeLocalMedia(videoFile,input.root,signal),video = probe.streams.find(s => s.codec_type === 'video'),sound = probe.streams.find(s => s.codec_type === 'audio');
    if (video?.codec_name !== (alpha ? 'prores' : 'h264') || (alpha && !video.pix_fmt?.startsWith('yuva444p')) || video.width !== renderer.width || video.height !== renderer.height || sound?.codec_name !== (alpha ? 'pcm_s16le' : 'aac') || sound.channels !== 2 || Math.abs(Number(probe.format.duration)*1000-durationMs) > 160) throw new Error('输出文件探测与目标规格不一致。');
    const digest = await fileDigest(videoFile,signal);input.onProgress?.(1);return { videoFile,audioFile,width: renderer.width,height: renderer.height,fps,durationMs,...digest,missingAudioClipIds: audio.missingClipIds,limitedSamples: audio.limitedSamples,probe };
  } catch (e) {
    child.kill();await completed.catch(() => {});for (const file of [videoFile,audioFile]) if (path.resolve(file).startsWith(path.resolve(input.directory)+path.sep) && fs.existsSync(file)) fs.unlinkSync(file);throw e;
  } finally { clearTimeout(timer); }
}
