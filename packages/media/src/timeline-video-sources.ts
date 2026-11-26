import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn,type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createCanvas,ImageData,type Canvas } from '@napi-rs/canvas';
import type { StudioDocument,TimelineClip } from '@digitalguide/contracts';
import { AppError } from '@digitalguide/domain';
import { mediaTools,runMediaTool } from './media-tools.js';
import { mp4InputOptions,type VideoFiles } from './video-source.js';
import type { PcmFileSource } from './timeline-audio.js';

class FrameStream {
  child: ChildProcessWithoutNullStreams;iterator: AsyncIterator<Buffer>;remainder: Buffer = Buffer.alloc(0);closed: Promise<void>;exitCode: number|null = null;error: Error|null = null;
  canvas: Canvas;lastTime = -1;lastFrame = false;timer: ReturnType<typeof setTimeout>;
  constructor(file: string,width: number,height: number,sourceMs: number,sourceFps: number,root: string,signal?: AbortSignal) {
    this.canvas = createCanvas(width,height);
    this.child = spawn(mediaTools(root).ffmpeg,['-v','error','-nostdin','-max_alloc','67108864','-threads','2','-ss',(sourceMs/1000).toFixed(6),...mp4InputOptions,'-i',file,'-map','0:v:0','-an','-vf',`fps=${sourceFps.toFixed(8)}:start_time=0:round=near,scale=${width}:${height}`,'-pix_fmt','rgba','-f','rawvideo','pipe:1'],{ windowsHide: true,stdio: ['pipe','pipe','pipe'],signal });
    this.child.stdin.end();this.iterator = this.child.stdout[Symbol.asyncIterator]();this.child.once('error',e => { this.error = e; });this.closed = new Promise(resolve => this.child.once('close',code => { this.exitCode = code;resolve(); }));
    let errors = 0;this.child.stderr.on('data',(b: Buffer) => { errors += b.length;if (errors > 32768) this.child.kill(); });this.timer = setTimeout(() => this.child.kill(),30000);
  }
  async next(timeMs: number) {
    clearTimeout(this.timer);this.timer = setTimeout(() => this.child.kill(),30000);const bytes = Buffer.alloc(this.canvas.width*this.canvas.height*4);let offset = 0;
    while (offset < bytes.length) {
      if (this.remainder.length) { const length = Math.min(bytes.length-offset,this.remainder.length);this.remainder.copy(bytes,offset,0,length);offset += length;this.remainder = this.remainder.subarray(length);continue; }
      const result = await this.iterator.next();if (result.done) { await this.closed;if (this.error || this.exitCode !== 0 || offset) throw new AppError('VIDEO_FRAME_FAILED','视频帧读取失败，请检查素材或缩短输出区间。',409);this.lastTime = timeMs;return this.lastFrame ? this.canvas : null; }this.remainder = result.value;
    }
    this.canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer,bytes.byteOffset,bytes.byteLength),this.canvas.width,this.canvas.height),0,0);this.lastFrame = true;this.lastTime = timeMs;return this.canvas;
  }
  async close() { clearTimeout(this.timer);this.child.stdout.destroy();this.child.kill();await this.closed; }
}

export class TimelineVideoFrames {
  streams = new Map<string,FrameStream>();
  constructor(public sources: VideoFiles,public root: string,public maxWidth: number,public maxHeight: number,public fps: number,public signal?: AbortSignal) {}
  has(id: string) { return !!this.sources[id]; }
  async frame(clip: TimelineClip,timeMs: number) {
    if (clip.source.type !== 'asset') return null;const source = this.sources[clip.source.assetId];if (!source) return null;
    const duration = source.specs.durationMs,position = clip.sourceInMs+(timeMs-clip.startMs)*clip.playbackRate,target = clip.loop ? position%duration : position;
    if (target < 0 || target >= duration) { await this.drop(clip.id);return null; }
    let stream = this.streams.get(clip.id);const step = 1000/this.fps*clip.playbackRate;
    if (stream && Math.abs(target-stream.lastTime) < 0.001) return stream.lastFrame ? stream.canvas : null;
    if (stream && (stream.lastTime < 0 || Math.abs(target-stream.lastTime-step) > 0.1)) { await this.drop(clip.id);stream = undefined; }
    if (!stream) { const scale = Math.min(1,this.maxWidth/source.specs.width,this.maxHeight/source.specs.height),width = Math.max(2,Math.round(source.specs.width*scale/2)*2),height = Math.max(2,Math.round(source.specs.height*scale/2)*2);stream = new FrameStream(source.file,width,height,target,this.fps/clip.playbackRate,this.root,this.signal);this.streams.set(clip.id,stream); }
    return stream.next(target);
  }
  async drop(id: string) { const stream = this.streams.get(id);if (stream) { this.streams.delete(id);await stream.close(); } }
  async releaseExcept(ids: Set<string>) { await Promise.all([...this.streams.keys()].filter(id => !ids.has(id)).map(id => this.drop(id))); }
  async dispose() { await this.releaseExcept(new Set()); }
}

// Decode only the audio windows needed by the current mixing block. PCM stays on disk;
// the mixer reads small seekable buffers and uses the exact same source clock as video.
export class TimelinePcmSources {
  cache = new Map<string,{ file: string;startFrame: number;endFrame: number }>();current = new Map<string,PcmFileSource>();
  constructor(public sources: VideoFiles,public directory: string,public root: string,public signal?: AbortSignal) {}
  get = (id: string) => this.current.get(id);
  async prepare(doc: StudioDocument,startMs: number,durationMs: number) {
    const requests = new Map<string,{ start: number;end: number }[]>();
    for (const track of doc.timeline?.tracks || []) if (!track.muted) for (const clip of track.clips) {
      if (clip.muted || !clip.volume || clip.source.type !== 'asset' || clip.startMs >= startMs+durationMs || clip.startMs+clip.durationMs <= startMs) continue;
      const id = clip.source.assetId,source = this.sources[id];if (!source?.specs.hasAudio) continue;
      const duration = source.specs.durationMs,begin = clip.sourceInMs+(Math.max(startMs,clip.startMs)-clip.startMs)*clip.playbackRate,span = (Math.min(startMs+durationMs,clip.startMs+clip.durationMs)-Math.max(startMs,clip.startMs))*clip.playbackRate,ranges = requests.get(id) || [];
      const add = (from: number,to: number) => { const start = Math.max(0,Math.floor(from*48)-2),end = Math.min(Math.round(duration*48),Math.ceil(to*48)+2);if (end > start) ranges.push({ start,end }); };
      if (!clip.loop) add(begin,Math.min(duration,begin+span));else if (span >= duration) add(0,duration);else { const offset = begin%duration;add(offset,Math.min(duration,offset+span));if (offset+span > duration) add(0,offset+span-duration); }
      requests.set(id,ranges);
    }
    const used = new Set<string>();this.current.clear();fs.mkdirSync(this.directory,{ recursive: true });
    for (const [id,ranges] of requests) {
      const merged: {start: number;end: number}[] = [];for (const r of ranges.sort((a,b) => a.start-b.start)) { const prev = merged.at(-1);if (prev && r.start <= prev.end) prev.end = Math.max(prev.end,r.end);else merged.push({ ...r }); }
      const windows: PcmFileSource['windows'] = [];
      for (const range of merged) {
        if (this.signal?.aborted) throw new Error('视频原声读取已取消。');const key = `${id}:${range.start}:${range.end}`;used.add(key);let cached = this.cache.get(key);
        if (!cached) { const file = path.join(this.directory,randomUUID()+'.pcm'),source = this.sources[id];
          await runMediaTool(mediaTools(this.root).ffmpeg,['-v','error','-nostdin','-n','-max_alloc','67108864','-threads','2','-ss',(range.start/48000).toFixed(8),...mp4InputOptions,'-i',source.file,'-map','0:a:0','-vn','-t',((range.end-range.start)/48000).toFixed(8),'-af','aresample=48000:async=1:first_pts=0','-ac','2','-ar','48000','-c:a','pcm_s16le','-f','s16le',file],this.signal,180000);
          fs.truncateSync(file,(range.end-range.start)*4);cached = { file,startFrame: range.start,endFrame: range.end };this.cache.set(key,cached);
        }
        windows.push({ ...cached });
      }
      this.current.set(id,{ sampleRate: 48000,channels: 2,frames: Math.round(this.sources[id].specs.durationMs*48),windows });
    }
    for (const [key,item] of this.cache) if (!used.has(key)) { fs.unlinkSync(item.file);this.cache.delete(key); }
  }
  async dispose() { for (const item of this.cache.values()) try { await fs.promises.unlink(item.file); } catch { /* Parent staging cleanup will retry. */ }this.cache.clear();this.current.clear(); }
}
