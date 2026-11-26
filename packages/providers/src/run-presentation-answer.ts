import path from 'node:path';
import {existsSync} from 'node:fs';
import {fork} from 'node:child_process';
import {AppError} from '@digitalguide/domain';
import {presentationAnswerNativeResult,type PresentationAnswerNativeResult} from '@digitalguide/contracts';
import type {PresentationAnswerRunInput} from './presentation-answer-native.js';
import {runOwnedPresentationAnswer} from './run-owned-presentation-answer.js';
export function runPresentationAnswer(input:PresentationAnswerRunInput,signal:AbortSignal,onProgress:(fraction:number)=>void):Promise<PresentationAnswerNativeResult>{
 if(input.engine.policy==='ppt-question-parts-v2')return runOwnedPresentationAnswer(input,signal,onProgress);
 const source=path.join(input.root,'packages/providers/src/presentation-answer-worker.ts'),compiled=path.resolve(process.argv[1]||'')===path.join(input.root,'dist/worker.mjs'),development=!compiled&&process.env.APP_ENV!=='production'&&existsSync(source),entry=development?source:path.join(input.root,'dist/presentation-answer.mjs');
 return new Promise((resolve,reject)=>{const child=fork(entry,[],{execArgv:['--max-old-space-size=512',...(development?['--import','tsx']:[])],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});let result:PresentationAnswerNativeResult|undefined,error:Error|undefined;
  const cancel=()=>{if(child.connected)child.send({cancel:true});},timer=setTimeout(()=>{error=new AppError('PRESENTATION_ANSWER_TIMEOUT','本机答疑超过十分钟，已请求停止，请转人工或缩短问题。',409);cancel();},600000);signal.addEventListener('abort',cancel,{once:true});
  child.once('error',()=>{error=new AppError('PRESENTATION_ANSWER_START_FAILED','本机答疑进程未启动，请检查当前安装。',409);});child.on('message',(message:{progress?:number;result?:unknown;code?:string;error?:string})=>{if(message.progress!==undefined){try{if(Number.isFinite(message.progress)&&message.progress>=0&&message.progress<=1)onProgress(message.progress);}catch{error=new AppError('PRESENTATION_ANSWER_PROGRESS','场次或任务状态已变化，停止旧答复。',409);cancel();}return;}if(message.error)error=error||new AppError(message.code||'PRESENTATION_ANSWER_FAILED',message.error,409);else if(message.result){const parsed=presentationAnswerNativeResult.safeParse(message.result);if(parsed.success)result=parsed.data;else error=new AppError('PRESENTATION_ANSWER_RESULT','本机答复格式无效，未保存。',409);}});
  child.once('close',()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);if(signal.aborted)reject(new AppError('PRESENTATION_ANSWER_CANCELLED','自动答疑已停止，未保存部分结果。',409));else if(error)reject(error);else if(result)resolve(result);else reject(new AppError('PRESENTATION_ANSWER_PROCESS_EXIT','自动答疑进程提前结束，请转人工或重试原任务。',409));});child.send(input);if(signal.aborted)cancel();
 });
}
