import fs from 'node:fs';
import path from 'node:path';
import {AppError} from '@digitalguide/domain';
import {presentationAnswerEngine,presentationAnswerRequest} from '@digitalguide/contracts';
import {runPresentationComposedNative} from './presentation-composed-native.js';
import type {PresentationAnswerRunInput} from './presentation-answer-native.js';
const requestFile=path.resolve(process.argv[2]||''),directory=path.dirname(requestFile),controller=new AbortController();process.on('SIGTERM',()=>controller.abort());
try{
 if(fs.statSync(requestFile).size>2097152)throw new Error('Request exceeds bound');const task=JSON.parse(fs.readFileSync(requestFile,'utf8')) as{input:PresentationAnswerRunInput;resultFile:string;progressFile:string};if(task.input.directory!==directory||task.resultFile!==path.join(directory,'composed-result.json')||task.progressFile!==path.join(directory,'composed-progress.jsonl'))throw new Error('Private task paths differ');task.input.engine=presentationAnswerEngine.parse(task.input.engine);task.input.request=presentationAnswerRequest.parse(task.input.request);let last=-1;
 try{const result=await runPresentationComposedNative(task.input,controller.signal,value=>{if(value<1&&value-last<.005)return;last=value;fs.appendFileSync(task.progressFile,JSON.stringify({progress:value})+'\n',{mode:0o600});});fs.writeFileSync(task.resultFile,JSON.stringify({result}),{flag:'wx',mode:0o600});}
 catch(error){fs.writeFileSync(task.resultFile,JSON.stringify({error:{code:error instanceof AppError?error.code:'PRESENTATION_PARTS_FAILED',message:error instanceof AppError?error.message:'逐子问答疑未完成，请转人工或重试。'}}),{flag:'wx',mode:0o600});}
}catch{process.exitCode=1;}
