import path from 'node:path';
import { existsSync } from 'node:fs';
import { fork } from 'node:child_process';
import type { DeliveryInput,DeliveryResult } from './delivery-worker.js';
export function runDelivery(input: DeliveryInput,signal: AbortSignal,onProgress: (fraction: number) => void): Promise<DeliveryResult> {
  const source = path.join(input.root,'packages/media/src/delivery-worker.ts'),development = process.env.APP_ENV !== 'production' && existsSync(source),entry = development ? source : path.join(input.root,'dist/studio-delivery.mjs');
  return new Promise((resolve,reject) => {
    const child = fork(entry,[],{ execArgv: ['--max-old-space-size=512',...(development ? ['--import','tsx'] : [])],windowsHide: true,stdio: ['ignore','ignore','ignore','ipc'] });
    let settled = false,killTimer: ReturnType<typeof setTimeout>|undefined;
    const finish = (error?: Error,result?: DeliveryResult) => { if (settled) return;settled = true;clearTimeout(timer);clearTimeout(killTimer);signal.removeEventListener('abort',cancel);if (error) reject(error);else resolve(result!); };
    const cancel = () => { if (child.connected) child.send({ cancel: true });killTimer = setTimeout(() => { child.kill();finish(new Error('导出已取消。')); },2000); };
    const timer = setTimeout(() => { child.kill();finish(new Error('本地导出超过六小时，请分段输出。')); },6*3600000+5000);
    signal.addEventListener('abort',cancel,{ once: true });child.once('error',error => finish(error));child.once('close',(code,endedBySignal) => { if (!settled) finish(new Error('导出进程提前退出（代码'+String(code ?? '无')+'，信号'+String(endedBySignal ?? '无')+'），请检查素材或分段后重试。')); });
    child.on('message',(message: { progress?: number;result?: DeliveryResult;error?: string }) => {
      if (message.progress !== undefined) { if (Number.isFinite(message.progress) && message.progress >= 0 && message.progress <= 1) try { onProgress(message.progress); } catch { child.kill();finish(new Error('导出进度无法保存，请稍后重试。')); }return; }
      if (message.error) finish(new Error(message.error));else if (message.result) finish(undefined,message.result);
    });
    child.send(input);if (signal.aborted) cancel();
  });
}
