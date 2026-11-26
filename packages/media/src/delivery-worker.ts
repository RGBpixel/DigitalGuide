import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StudioDocument,DeliverySettings } from '@digitalguide/contracts';
import { renderTimelineVideo } from './timeline-video.js';
import { writeTimelineAudio } from './timeline-audio.js';
import { subtitleFiles,timelineSubtitles } from './timeline-subtitles.js';
import { ownedFile,fileDigest } from './files.js';
import { probeLocalMedia } from './media-tools.js';
import type { VideoKeySource,VideoFiles } from './video-source.js';
import { TimelinePcmSources } from './timeline-video-sources.js';

export interface DeliveryInput { document: StudioDocument;images: Record<string,string>;audio: Record<string,string>;videos?: Record<string,VideoKeySource>;objects: string;directory: string;root: string;startMs: number;durationMs: number;delivery: DeliverySettings;kind: 'video'|'audio' }
export interface DeliveryResult { files: { file: string;kind: 'video'|'audio'|'srt'|'vtt';mediaType: string }[];probe: Awaited<ReturnType<typeof probeLocalMedia>>;missingAudioClipIds: string[];limitedSamples: number }
const abort = new AbortController();let started = false;
process.on('disconnect',() => abort.abort());
process.on('message',async (input: DeliveryInput & { cancel?: boolean }) => {
  if (input.cancel) { abort.abort();return; }if (started) return;started = true;
  const read = (key: string|undefined) => { if (!key) throw new Error('缺少源素材。');return fs.readFileSync(ownedFile(input.objects,key)); };
  let last = -1;
  const progress = (fraction: number) => { const step = Math.floor(fraction*100);if (step !== last && process.connected) { last = step;process.send?.({ progress: step/100 }); } };
  try {
    fs.mkdirSync(input.directory,{ recursive: true });
    const videos: VideoFiles = Object.fromEntries(Object.entries(input.videos || {}).map(([id,v]) => [id,{ file: ownedFile(input.objects,v.key),specs: v.specs }]));
    const result: DeliveryResult = { files: [],probe: { streams: [],format: { duration: '',size: '',format_name: '' } },missingAudioClipIds: [],limitedSamples: 0 };
    if (input.kind === 'video') {
      const rendered = await renderTimelineVideo({ ...input,videos,getImage: r => read(input.images[(r.assetId ? 'a:'+r.assetId : 'm:'+r.importMediaId)]),getAudio: id => read(input.audio[id]),signal: abort.signal,onProgress: progress });
      result.files.push({ file: rendered.videoFile,kind: 'video',mediaType: input.delivery.transparent ? 'video/quicktime' : 'video/mp4' },{ file: rendered.audioFile,kind: 'audio',mediaType: 'audio/wav' });
      result.probe = rendered.probe;result.missingAudioClipIds = rendered.missingAudioClipIds;result.limitedSamples = rendered.limitedSamples;
    } else {
      const file = path.join(input.directory,randomUUID()+'.wav'),pcm = new TimelinePcmSources(videos,input.directory,input.root,abort.signal);let rendered;
      try { rendered = await writeTimelineAudio(input.document,id => read(input.audio[id]),input.startMs,input.durationMs,file,abort.signal,progress,pcm); } finally { await pcm.dispose(); }
      result.files.push({ file,kind: 'audio',mediaType: 'audio/wav' });result.probe = await probeLocalMedia(file,input.root,abort.signal);result.missingAudioClipIds = rendered.missingClipIds;result.limitedSamples = rendered.limitedSamples;
    }
    const captions = subtitleFiles(timelineSubtitles(input.document,input.startMs,input.durationMs));
    for (const kind of ['srt','vtt'] as const) { const file = path.join(input.directory,randomUUID()+'.'+kind);fs.writeFileSync(file,captions[kind],{ flag: 'wx' });result.files.push({ file,kind,mediaType: kind === 'srt' ? 'application/x-subrip' : 'text/vtt' }); }
    // Force each staging file to be readable before returning trusted paths to the parent.
    for (const file of result.files) await fileDigest(file.file,abort.signal);
    if (process.connected) process.send?.({ result });
  } catch { if (process.connected) process.send?.({ error: abort.signal.aborted ? '导出已取消。' : '媒体导出失败，请检查源素材、输出范围与编码工具后重试。' }); }
  finally { if (process.connected) process.disconnect(); }
});
