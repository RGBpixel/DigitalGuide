import path from 'node:path';
import {existsSync} from 'node:fs';
import {fork} from 'node:child_process';
import {AppError} from '@digitalguide/domain';
import {contentWritingNativeResult,type ContentWritingNativeResult} from '@digitalguide/contracts';
import type {ContentWritingRunInput} from './content-writing-native.js';
export function runContentWriting(input:ContentWritingRunInput,signal:AbortSignal,onProgress:(fraction:number)=>void):Promise<ContentWritingNativeResult>{
 const source=path.join(input.root,'packages/providers/src/content-writing-worker.ts'),compiled=path.resolve(process.argv[1]||'')===path.join(input.root,'dist/worker.mjs'),development=!compiled&&process.env.APP_ENV!=='production'&&existsSync(source),entry=development?source:path.join(input.root,'dist/content-writing.mjs');
 return new Promise((resolve,reject)=>{const child=fork(entry,[],{execArgv:['--max-old-space-size=512',...(development?['--import','tsx']:[])],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});let result:ContentWritingNativeResult|undefined,error:Error|undefined;
  const cancel=()=>{if(child.connected)child.send({cancel:true});},timer=setTimeout(()=>{error=new AppError('CONTENT_WRITING_TIMEOUT','本机资料脚本超过十分钟，已请求停止，请减少候选数量或缩短资料。',409);cancel();},600000);signal.addEventListener('abort',cancel,{once:true});
  child.once('error',()=>{error=new AppError('CONTENT_WRITING_START_FAILED','本机资料脚本进程未启动，请检查当前安装。',409);});child.on('message',(message:{progress?:number;result?:unknown;code?:string;error?:string})=>{if(message.progress!==undefined){try{if(Number.isFinite(message.progress)&&message.progress>=0&&message.progress<=1)onProgress(message.progress);}catch{error=new AppError('CONTENT_WRITING_PROGRESS','来源或任务状态已变化，停止旧脚本候选。',409);cancel();}return;}if(message.error)error=error||new AppError(message.code||'CONTENT_WRITING_FAILED',message.error,409);else if(message.result){const parsed=contentWritingNativeResult.safeParse(message.result);if(parsed.success)result=parsed.data;else error=new AppError('CONTENT_WRITING_RESULT','本机脚本候选格式无效，未保存。',409);}});
  child.once('close',()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);if(signal.aborted)reject(new AppError('CONTENT_WRITING_CANCELLED','资料脚本生成已停止，未保存部分结果。',409));else if(error)reject(error);else if(result)resolve(result);else reject(new AppError('CONTENT_WRITING_PROCESS_EXIT','资料脚本生成进程提前结束，请转人工或重试原任务。',409));});child.send(input);if(signal.aborted)cancel();
 });
}
