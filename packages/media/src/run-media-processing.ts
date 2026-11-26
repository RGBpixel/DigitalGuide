import path from 'node:path';
import {existsSync} from 'node:fs';
import {fork} from 'node:child_process';
import {AppError} from '@digitalguide/domain';
import type {MediaProcessingInput,MediaProcessingResult} from './media-processing.js';
import {restorationWork} from '../../domain/src/restoration.js';
export function runMediaProcessing(input:MediaProcessingInput,signal:AbortSignal,onProgress:(fraction:number)=>void):Promise<MediaProcessingResult>{
 const source=path.join(input.root,'packages/media/src/media-process-worker.ts'),runningCompiled=path.resolve(process.argv[1]||'')===path.join(input.root,'dist/worker.mjs'),development=!runningCompiled&&process.env.APP_ENV!=='production'&&existsSync(source),entry=development?source:path.join(input.root,'dist/media-process.mjs');
 return new Promise((resolve,reject)=>{
  const child=fork(entry,[],{execArgv:[input.payload.configuration.operation==='semantic_split'?'--max-old-space-size=768':'--max-old-space-size=256',...(development?['--import','tsx']:[])],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});let result:MediaProcessingResult|undefined,failure:Error|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
  const fail=(error:Error)=>{failure??=error;child.kill();};
  const cancel=()=>{if(child.connected)child.send({cancel:true},error=>{if(error)fail(error);});killTimer=setTimeout(()=>fail(new AppError('MEDIA_PROCESS_CANCELLED','媒体加工已取消。',409)),input.payload.configuration.operation==='gaze'?8000:2000);};
  const duration=input.payload.configuration.operation==='restore'?Math.min(86400000,Math.max(1810000,restorationWork(input.payload).tiles*15000+120000)):input.payload.engine?Math.min(86400000,Math.max(1810000,(['segmentation','subject_tracking'].includes(input.payload.configuration.operation)&&'durationMs'in input.payload.configuration?(input.payload.configuration.durationMs??input.payload.source.specs.durationMs??0):0)*Math.min(60,input.payload.source.specs.fps||1)/1000*5000+120000)):1810000;
  const timer=setTimeout(()=>fail(new AppError('MEDIA_PROCESS_TIMEOUT','媒体加工超时，请拆分后重试。',409)),duration);
  child.once('error',()=>{failure??=new AppError('MEDIA_PROCESS_START_FAILED','媒体加工辅助进程无法启动，请检查本机构建和运行环境。',409);});
  child.on('message',(m:{progress?:number;result?:MediaProcessingResult;error?:string})=>{
   if(m.progress!==undefined){if(Number.isFinite(m.progress)&&m.progress>=0&&m.progress<=1)try{onProgress(m.progress);}catch(e){fail(e instanceof AppError?e:new AppError('MEDIA_PROGRESS_FAILED','媒体加工进度保存失败，请检查数据存储后重试。',409));}return;}
   if(m.error)failure??=new AppError('MEDIA_PROCESS_FAILED',m.error,409);else if(m.result)result=m.result;
   // Terminal IPC is not proof that the actual process exited.
   clearTimeout(killTimer);killTimer=setTimeout(()=>fail(new AppError('MEDIA_PROCESS_EXIT_TIMEOUT','媒体完成消息已收到，但辅助进程没有结束，未提交输出。',409)),10000);
  });
  child.once('close',code=>{clearTimeout(timer);clearTimeout(killTimer);signal.removeEventListener('abort',cancel);if(signal.aborted)reject(new AppError('MEDIA_PROCESS_CANCELLED','媒体加工已取消。',409));else if(failure)reject(failure);else if(code!==0||!result)reject(new AppError('MEDIA_PROCESS_EXITED','媒体加工辅助进程提前退出，请检查内存或缩短区间。',409));else resolve(result);});
  signal.addEventListener('abort',cancel,{once:true});child.send(input,error=>{if(error)fail(error);});if(signal.aborted)cancel();
 });
}
