import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AppError } from '@digitalguide/domain';
import { mediaTools,runMediaTool } from './media-tools.js';
import { inspectMedia } from './index.js';
export const mp4InputOptions = ['-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-f','mov'];
export interface VideoInspection { specs: Record<string,number>;posterFile: string;warnings: string[];normalizedFile?:string;sourceContainer?:'webm'|'mp4';sourceSpecs?:Record<string,number> }
export interface VideoFileSource { file: string;specs: Record<string,number> }
export type VideoFiles = Record<string,VideoFileSource>;
export interface VideoKeySource { key: string;specs: Record<string,number> }
export async function inspectVideoSource(file: string,directory: string,root: string,signal: AbortSignal,onProgress: (fraction: number) => void): Promise<VideoInspection> {
  const stat = fs.statSync(file),fd = fs.openSync(file,'r'),head = Buffer.alloc(12);try { fs.readSync(fd,head,0,12,0); } finally { fs.closeSync(fd); }
  if (stat.size > 128*1024*1024 || stat.size < 32 || head.toString('ascii',4,8) !== 'ftyp') throw new AppError('INVALID_VIDEO','文件不是受支持的MP4或超过128 MB，请转换后重试。',422);
  const tools = mediaTools(root),raw = await runMediaTool(tools.ffprobe,['-v','error','-max_alloc','67108864',...mp4InputOptions,'-show_entries','stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,avg_frame_rate,duration,sample_rate,channels:stream_side_data=rotation:format=duration,format_name','-of','json',file],signal,20000);
  const probe = JSON.parse(raw) as { streams: { codec_type: string;codec_name: string;profile?: string;pix_fmt?: string;width?: number;height?: number;r_frame_rate?: string;avg_frame_rate?: string;duration?: string;sample_rate?: string;channels?: number;side_data_list?: {rotation?: number}[] }[];format: { duration: string } };
  const videos = probe.streams.filter(s => s.codec_type === 'video'),audios = probe.streams.filter(s => s.codec_type === 'audio'),video = videos[0],audio = audios[0],durationMs = Math.round(Number(probe.format.duration)*1000),fps = (value: string|undefined) => { const [a,b] = (value || '').split('/').map(Number);return a/b; },rate = fps(video?.avg_frame_rate) || fps(video?.r_frame_rate);
  if (videos.length !== 1 || audios.length > 1 || probe.streams.length !== videos.length+audios.length || video?.codec_name !== 'h264' || !['yuv420p','yuvj420p'].includes(video.pix_fmt || '') || (audio && (audio.codec_name !== 'aac' || ![1,2].includes(audio.channels || 0) || Number(audio.sample_rate) < 8000 || Number(audio.sample_rate) > 96000))) throw new AppError('UNSUPPORTED_VIDEO_CODEC','当前视频需包含一条8位H.264画面及至多一条单/双声道AAC原声，请转换后上传。',422);
  if (!video.width || !video.height || video.width < 16 || video.height < 16 || video.width > 4096 || video.height > 4096 || video.width*video.height > 16777216 || !Number.isFinite(rate) || rate < 1 || rate > 60.1 || !Number.isFinite(durationMs) || durationMs < 100 || durationMs > 600000 || probe.streams.some(s => s.duration && (!Number.isFinite(+s.duration) || +s.duration > 601))) throw new AppError('VIDEO_LIMIT','当前视频最多10分钟、60帧/秒及4096像素单边，请裁剪或转换后上传。',422);
  const rotation = video.side_data_list?.find(s => s.rotation !== undefined)?.rotation || 0;if (![0,90,180,270].includes((rotation%360+360)%360)) throw new AppError('VIDEO_ROTATION','视频旋转信息不受支持，请转为直立画面后上传。',422);
  const swapped = Math.abs(rotation)%180 === 90,width = swapped ? video.height : video.width,height = swapped ? video.width : video.height;
  await new Promise<void>((resolve,reject) => {
    const child = spawn(tools.ffmpeg,['-v','error','-nostdin','-max_alloc','67108864','-threads','2','-xerror',...mp4InputOptions,'-i',file,'-map','0:v:0',...(audio ? ['-map','0:a:0'] : []),'-stats_period','0.5','-progress','pipe:1','-f','null','-'],{ windowsHide: true,stdio: ['ignore','pipe','pipe'],signal });
    let tail = '',bytes = 0,frames = 0,invalid = false;const timer = setTimeout(() => { invalid = true;child.kill(); },1800000);
    child.stdout.on('data',(chunk: Buffer) => { tail += chunk.toString('ascii');if (tail.length > 16384) { invalid = true;child.kill();return; }const lines = tail.split('\n');tail = lines.pop() || '';for (const line of lines) { const [key,value] = line.trim().split('=');if (key === 'frame') { frames = +value;if (!Number.isFinite(frames) || frames > 36060) { invalid = true;child.kill(); } }if (key === 'out_time_us') { const ms = +value/1000;if (Number.isFinite(ms)) { if (ms > 602000) { invalid = true;child.kill(); }onProgress(Math.min(0.92,Math.max(0,ms/durationMs)*0.92)); } } } });
    child.stderr.on('data',(chunk: Buffer) => { bytes += chunk.length;if (bytes > 65536) { invalid = true;child.kill(); } });
    child.once('error',e => { clearTimeout(timer);reject(e); });child.once('close',code => { clearTimeout(timer);if (code !== 0 || invalid || frames < 1) reject(new AppError('VIDEO_DECODE_FAILED','视频未能完整解码或超过处理限制，请转换或拆分后重试。',422));else resolve(); });
  });
  fs.mkdirSync(directory,{ recursive: true });const posterFile = path.join(directory,'poster.png');
  await runMediaTool(tools.ffmpeg,['-v','error','-nostdin','-n','-threads','2',...mp4InputOptions,'-i',file,'-map','0:v:0','-an','-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease','-update','1',posterFile],signal,30000);const poster = inspectMedia(fs.readFileSync(posterFile));if (poster.mediaType !== 'image/png') throw new Error('Invalid video poster');onProgress(1);
  return { specs: { width,height,codedWidth: video.width,codedHeight: video.height,durationMs,fps: rate,rotation,hasAudio: audio ? 1 : 0,sampleRate: audio ? +audio.sample_rate! : 0,channels: audio?.channels || 0 },posterFile,warnings: ['保留上传的原始MP4；封面为实际视频帧。此视频素材不代表已训练数字人或完成声音克隆。',...(audio ? [] : ['此视频没有原声；时间线不会自动生成配音。'])] };
}
