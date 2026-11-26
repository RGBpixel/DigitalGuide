import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { AppError } from '@digitalguide/domain';
const verified = new Map<string,string>();
export function mediaTools(root = process.cwd()) {
  const directory = path.join(root,'storage','tools','ffmpeg-9.0.2'),overrides = [process.env.FFMPEG_PATH,process.env.FFPROBE_PATH];
  if (overrides.some(Boolean) && !overrides.every(Boolean)) throw new AppError('MEDIA_TOOLS_NOT_CONFIGURED','请同时配置 FFMPEG_PATH 和 FFPROBE_PATH。',409);
  const result = { ffmpeg: overrides[0] || path.join(directory,'ffmpeg.exe'),ffprobe: overrides[1] || path.join(directory,'ffprobe.exe') };
  for (const file of Object.values(result)) if (!path.isAbsolute(file) || !fs.existsSync(file)) throw new AppError('MEDIA_TOOLS_NOT_CONFIGURED','本地编码工具未就绪，请运行 pnpm setup:media，或配置服务端工具绝对路径。',409);
  if (!overrides[0]) {
    const metadataFile = path.join(directory,'media-tools.json');if (!fs.existsSync(metadataFile)) throw new AppError('MEDIA_TOOLS_NOT_CONFIGURED','编码工具尚未完成完整性校验，请运行 pnpm setup:media。',409);
    const metadata = JSON.parse(fs.readFileSync(metadataFile,'utf8')) as { archiveSha256: string;files: Record<string,{sha256: string}> };
    if (metadata.archiveSha256 !== '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba') throw new AppError('MEDIA_TOOLS_INVALID','编码工具包校验记录异常，未执行。',409);
    for (const file of Object.values(result)) { const stat = fs.statSync(file),stamp = `${stat.size}:${stat.mtimeMs}:${metadata.files[path.basename(file)]?.sha256}`;if (verified.get(file) === stamp) continue;
      if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== metadata.files[path.basename(file)]?.sha256) throw new AppError('MEDIA_TOOLS_INVALID','编码工具文件已变化，未执行，请重新核对安装。',409);verified.set(file,stamp);
    }
  }
  return result;
}
export function runMediaTool(file: string,args: string[],signal?: AbortSignal,timeoutMs = 15000) {
  return new Promise<string>((resolve,reject) => { const child = spawn(file,args,{ windowsHide: true,stdio: ['ignore','pipe','pipe'],signal }),chunks: Buffer[] = [],errors: Buffer[] = [];let bytes = 0;
    const timer = setTimeout(() => { child.kill(); },timeoutMs);child.stdout.on('data',(b: Buffer) => { bytes += b.length;if (bytes > 1048576) child.kill();else chunks.push(b); });child.stderr.on('data',(b: Buffer) => { if (errors.reduce((n,v) => n+v.length,0) < 8192) errors.push(b); });
    let failure:Error|undefined;child.once('error',e => { failure=e; });child.once('close',code => { clearTimeout(timer);if(failure)reject(failure);else if (code !== 0) reject(new AppError('MEDIA_TOOL_FAILED','本地媒体工具执行失败或超时，请重试或缩短区间。',409));else resolve(Buffer.concat(chunks).toString('utf8')); });
  });
}
export async function probeLocalMedia(file: string,root = process.cwd(),signal?: AbortSignal) {
  const raw = await runMediaTool(mediaTools(root).ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',file],signal);
  return JSON.parse(raw) as { streams: { codec_name: string;codec_type: string;profile?: string;pix_fmt?: string;width?: number;height?: number;sample_rate?: string;channels?: number;r_frame_rate?: string;avg_frame_rate?: string;duration?: string }[];format: { duration: string;size: string;format_name: string } };
}
