import path from 'node:path';
import { existsSync } from 'node:fs';
import { fork } from 'node:child_process';
import type { VideoInspection } from './video-source.js';
export function runVideoInspection(input: { file: string;directory: string;root: string;recording?:boolean;recordingDurationMs?:number|null;alphaVideo?:boolean },signal: AbortSignal,onProgress: (fraction: number) => void): Promise<VideoInspection> {
  const source = path.join(input.root,'packages/media/src/video-inspect-worker.ts'),runningCompiled=path.resolve(process.argv[1]??'')===path.join(input.root,'dist/worker.mjs'),development = !runningCompiled&&process.env.APP_ENV !== 'production' && existsSync(source),entry = development ? source : path.join(input.root,'dist/video-inspect.mjs');
  return new Promise((resolve,reject) => {
    const child = fork(entry,[],{ execArgv: ['--max-old-space-size=256',...(development ? ['--import','tsx'] : [])],windowsHide: true,stdio: ['ignore','ignore','ignore','ipc'] });let result:VideoInspection|undefined,failure:Error|undefined,killTimer: ReturnType<typeof setTimeout>|undefined;
    const fail=(error:Error)=>{failure??=error;child.kill();};
    const cancel=()=>{if(child.connected)child.send({cancel:true},e=>{if(e)fail(e);});clearTimeout(killTimer);killTimer=setTimeout(()=>fail(new Error('视频检查已取消。')),2000);};
    const timer=setTimeout(()=>fail(new Error('视频检查超时，请拆分素材后重试。')),1810000);
    child.once('error',error=>{failure??=error;});child.once('close',(code,endedBySignal)=>{clearTimeout(timer);clearTimeout(killTimer);signal.removeEventListener('abort',cancel);if(signal.aborted)reject(new Error('视频检查已取消。'));else if(failure)reject(failure);else if(code!==0||!result)reject(new Error('视频检查进程提前退出（代码'+String(code??'无')+'，信号'+String(endedBySignal??'无')+'），请检查素材或分段后重试。'));else resolve(result);});
    child.on('message',(message:{progress?:number;result?:VideoInspection;error?:string})=>{if(message.progress!==undefined){if(Number.isFinite(message.progress)&&message.progress>=0&&message.progress<=1)try{onProgress(message.progress);}catch{fail(new Error('视频进度保存失败。'));}return;}if(message.error)failure??=new Error(message.error);else if(message.result)result=message.result;clearTimeout(killTimer);killTimer=setTimeout(()=>fail(new Error('视频检查结果已返回，但实际辅助进程未结束，未采用输出。')),10000);});signal.addEventListener('abort',cancel,{once:true});child.send(input,e=>{if(e)fail(e);});if(signal.aborted)cancel();
  });
}
