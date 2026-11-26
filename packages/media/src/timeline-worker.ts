import fs from 'node:fs';
import path from 'node:path';
import { renderTimelineVideo } from './timeline-video.js';
import type { StudioDocument } from '@digitalguide/contracts';
import type { VideoKeySource } from './video-source.js';
import { ownedFile } from './files.js';
interface RenderInput { document: StudioDocument;images: Record<string,string>;audio: Record<string,string>;videos?: Record<string,VideoKeySource>;objects: string;directory: string;root: string;startMs: number;durationMs: number;cancel?: boolean }
const abort = new AbortController();let started = false;
process.on('disconnect',() => abort.abort());
process.on('message',async (input: RenderInput) => {
  if (input.cancel) { abort.abort();return; }if (started) return;started = true;
  const read = (key: string|undefined) => { if (!key || path.basename(key) !== key) throw Error('Uncontrolled media key');const file = path.resolve(input.objects,key);if (!file.startsWith(path.resolve(input.objects)+path.sep)) throw Error('Uncontrolled media file');return fs.readFileSync(file); };
  let progress = -1;
  try { const result = await renderTimelineVideo({ document: input.document,videos: Object.fromEntries(Object.entries(input.videos || {}).map(([id,v]) => [id,{ file: ownedFile(input.objects,v.key),specs: v.specs }])),getImage: ref => read(input.images[(ref.assetId ? 'a:'+ref.assetId : 'm:'+ref.importMediaId)]),getAudio: id => read(input.audio[id]),startMs: input.startMs,durationMs: input.durationMs,directory: input.directory,root: input.root,signal: abort.signal,onProgress: fraction => { const next = Math.floor(fraction*20);if (next !== progress && process.connected) { progress = next;process.send?.({ progress: next/20 }); } } });if (process.connected) process.send?.({ result }); }
  catch { if (process.connected) process.send?.({ error: abort.signal.aborted ? '预览已取消。' : '本地时间线预览失败，请检查素材、编码工具或缩短区间。' }); }
  finally { if (process.connected) process.disconnect(); }
});
