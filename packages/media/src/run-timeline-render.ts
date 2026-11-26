import path from 'node:path';
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { StudioDocument } from '@digitalguide/contracts';
import type { renderTimelineVideo } from './timeline-video.js';
import type { VideoKeySource } from './video-source.js';
type Result = Awaited<ReturnType<typeof renderTimelineVideo>>;
export async function runTimelineRender(input: { document: StudioDocument;images: Record<string,string>;audio: Record<string,string>;videos?: Record<string,VideoKeySource>;objects: string;directory: string;root: string;startMs: number;durationMs: number },signal: AbortSignal,onProgress: (fraction: number) => void): Promise<Result> {
  const source = path.join(input.root,'packages/media/src/timeline-worker.ts'),development = process.env.APP_ENV !== 'production' && existsSync(source),entry = development ? source : path.join(input.root,'dist/timeline-render.mjs');
  return new Promise((resolve,reject) => {
    const child = fork(entry,[],{ execArgv: ['--max-old-space-size=512',...(development ? ['--import','tsx'] : [])],windowsHide: true,stdio: ['ignore','ignore','ignore','ipc'] });let settled = false,killTimer: ReturnType<typeof setTimeout>|undefined;
    const finish = (error?: Error,result?: Result) => { if (settled) return;settled = true;clearTimeout(timer);clearTimeout(killTimer);signal.removeEventListener('abort',cancel);if (error) reject(error);else resolve(result!); };
    const cancel = () => { if (child.connected) child.send({ cancel: true });killTimer = setTimeout(() => { child.kill();finish(new Error('预览已取消。')); },1500); };
    const timer = setTimeout(() => { child.kill();finish(new Error('时间线预览超过两分钟，请缩短区间。')); },125000);
    signal.addEventListener('abort',cancel,{ once: true });child.once('error',error => finish(error));child.once('close',(code,endedBySignal) => { if (!settled) finish(new Error('时间线预览子进程提前退出（代码'+String(code ?? '无')+'，信号'+String(endedBySignal ?? '无')+'），请检查素材或分段后重试。')); });
    child.on('message',(message: { progress?: number;result?: Result;error?: string }) => { if (message.progress !== undefined) { if (Number.isFinite(message.progress) && message.progress >= 0 && message.progress <= 1) try { onProgress(message.progress); } catch { child.kill();finish(new Error('预览进度无法持久化，请稍后重试。')); }return; }if (message.error) finish(new Error(message.error));else if (message.result) finish(undefined,message.result); });
    child.send(input);if (signal.aborted) cancel();
  });
}
