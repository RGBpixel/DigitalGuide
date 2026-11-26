import type { StudioDocument,TimelineClip } from '@digitalguide/contracts';
import { gainAt } from '../../domain/src/timeline.js';
import { inspectMedia } from './index.js';
import fs from 'node:fs';
interface AudioSource { channels: number;sampleRate: number;frames: number;read: (frame: number,channel: number) => number;close?: () => void }
export interface PcmFileSource { channels: number;sampleRate: number;frames: number;windows: { file: string;startFrame: number;endFrame: number }[] }
export interface AudioPreparation { get: (id: string) => PcmFileSource|undefined;prepare: (doc: StudioDocument,startMs: number,durationMs: number) => Promise<void> }
function diskSource(source: PcmFileSource): AudioSource {
  const open: {fd: number;start: number;end: number;buffer: Buffer;position: number;length: number}[] = [];
  try { for (const window of source.windows) open.push({ fd: fs.openSync(window.file,'r'),start: window.startFrame,end: window.endFrame,buffer: Buffer.alloc(65536),position: -1,length: 0 }); }
  catch (e) { for (const item of open) fs.closeSync(item.fd);throw e; }
  return { channels: source.channels,sampleRate: source.sampleRate,frames: source.frames,read: (frame,channel) => {
    const w = open.find(w => frame >= w.start && frame < w.end);if (!w) return 0;const offset = ((frame-w.start)*source.channels+channel)*2;
    if (offset < w.position || offset+2 > w.position+w.length) { w.position = Math.floor(offset/(source.channels*2))*source.channels*2;w.length = fs.readSync(w.fd,w.buffer,0,Math.min(w.buffer.length,(w.end-w.start)*source.channels*2-w.position),w.position); }
    return offset+2 <= w.position+w.length ? w.buffer.readInt16LE(offset-w.position)/32768 : 0;
  },close: () => { for (const w of open) fs.closeSync(w.fd); } };
}
export function timelineAudioAsset(doc: StudioDocument,clip: TimelineClip) { return clip.source.type === 'asset' ? clip.source.assetId : clip.source.type === 'segment_narration' ? doc.speakers.find(s => s.id === clip.speakerId)?.voiceAssetId || null : null; }
function decode(buffer: Buffer): AudioSource {
  const result = inspectMedia(buffer);if (result.mediaType !== 'audio/wav') throw new Error('音频片段需要已验证的 PCM WAV。');const blocks: Buffer[] = [];
  for (let offset = 12;offset+8 <= buffer.length;) { const size = buffer.readUInt32LE(offset+4);if (buffer.toString('ascii',offset,offset+4) === 'data') blocks.push(buffer.subarray(offset+8,offset+8+size));offset += 8+size+(size%2); }
  const data = Buffer.concat(blocks),{ channels,sampleRate } = result.specs;return { channels,sampleRate,frames: data.length/2/channels,read: (frame,channel) => data.readInt16LE((frame*channels+channel)*2)/32768 };
}
export function encodePcmWav(samples: Float32Array,sampleRate: number,channels = 2) {
  const wav = Buffer.alloc(44+samples.length*2);pcmWavHeader(samples.length/channels,sampleRate,channels).copy(wav);
  for (let i = 0;i < samples.length;i++) wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),44+i*2);return wav;
}
export function pcmWavHeader(frames: number,sampleRate = 48000,channels = 2) { const size = frames*channels*2;if (!Number.isSafeInteger(size) || size > 0xffffffff-36) throw new Error('PCM WAV 超过 RIFF 文件容量。');const h = Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(size+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(channels,22);h.writeUInt32LE(sampleRate,24);h.writeUInt32LE(sampleRate*channels*2,28);h.writeUInt16LE(channels*2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(size,40);return h; }
export async function writeTimelineAudio(doc: StudioDocument,getAudio: (assetId: string) => Buffer,startMs: number,durationMs: number,file: string,signal?: AbortSignal,onProgress?: (fraction: number) => void,prepared?: AudioPreparation) {
  if (durationMs < 1 || durationMs > 10800000 || !Number.isInteger(durationMs)) throw new Error('音频输出时长应在三小时内。');const rate = 48000,frames = Math.ceil(durationMs/1000*rate),fd = fs.openSync(file,'wx'),missing = new Set<string>();let written = 0,limitedSamples = 0,peak = 0;
  try { fs.writeSync(fd,pcmWavHeader(frames,rate));for (let offset = 0;offset < durationMs;offset += 30000) { if (signal?.aborted) throw new Error('音频输出已取消。');const length = Math.min(30000,durationMs-offset);await prepared?.prepare(doc,startMs+offset,length);const part = mixTimelineAudio(doc,getAudio,startMs+offset,length,rate,prepared?.get);fs.writeSync(fd,part.bytes,44,part.bytes.length-44);written += (part.bytes.length-44)/4;for (const id of part.missingClipIds) missing.add(id);limitedSamples += part.limitedSamples;peak = Math.max(peak,part.peak);onProgress?.((offset+length)/durationMs);await new Promise<void>(r => setTimeout(r,0)); }if (written !== frames) throw new Error('分块音频样本计数不一致。');return { sampleRate: rate,channels: 2,frames,missingClipIds: [...missing],limitedSamples,peak }; } finally { fs.closeSync(fd); }
}
export function mixTimelineAudio(doc: StudioDocument,getAudio: (assetId: string) => Buffer,startMs: number,durationMs: number,sampleRate = 48000,getPcm?: (assetId: string) => PcmFileSource|undefined) {
  if (!doc.timeline || durationMs <= 0 || durationMs > 30000 || startMs < 0 || ![16000,48000].includes(sampleRate)) throw new Error('本地预览音频需选择不超过三十秒的有效区间。');
  const samples = new Float32Array(Math.ceil(durationMs/1000*sampleRate)*2),sources = new Map<string,AudioSource>(),missingClipIds: string[] = [];let sourceBytes = 0;
  try { for (const track of doc.timeline.tracks.filter(t => !t.muted)) for (const c of track.clips.filter(c => !c.muted && c.volume > 0 && c.startMs < startMs+durationMs && c.startMs+c.durationMs > startMs)) {
    const id = timelineAudioAsset(doc,c);if (!id) { if (['voice','music'].includes(track.type)) missingClipIds.push(c.id);continue; }
    const pcm = getPcm?.(id);if (!['voice','music'].includes(track.type) && !(c.source.type === 'asset' && pcm)) continue;
    let source = sources.get(id);if (!source) { if (pcm) source = diskSource(pcm);else { const bytes = getAudio(id);sourceBytes += bytes.length;if (sourceBytes > 32*1024*1024) throw new Error('所选区间音频源超过三十二 MB，请拆分预览。');source = decode(bytes); }sources.set(id,source); }
    const first = Math.max(0,Math.ceil((c.startMs-startMs)*sampleRate/1000)),last = Math.min(samples.length/2,Math.ceil((c.startMs+c.durationMs-startMs)*sampleRate/1000));
    for (let i = first;i < last;i++) {
      const local = startMs+i/sampleRate*1000-c.startMs,sourceTime = (c.sourceInMs+local*c.playbackRate)/1000*source.sampleRate,position = c.loop ? sourceTime%source.frames : sourceTime;if (position < 0 || position >= source.frames) continue;
      const frame = Math.floor(position),next = Math.min(frame+1,source.frames-1),mix = position-frame,gain = gainAt(c,local);
      for (let channel = 0;channel < 2;channel++) { const sourceChannel = Math.min(channel,source.channels-1),a = source.read(frame,sourceChannel),b = source.read(next,sourceChannel);samples[i*2+channel] += (a+(b-a)*mix)*gain; }
    }
  } } finally { for (const source of sources.values()) source.close?.(); }
  let peak = 0,limitedSamples = 0;for (const v of samples) { peak = Math.max(peak,Math.abs(v));if (Math.abs(v) > 1) limitedSamples++; }
  return { samples,sampleRate,channels: 2,peak,limitedSamples,missingClipIds,bytes: encodePcmWav(samples,sampleRate) };
}
