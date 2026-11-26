import {AppError} from '@digitalguide/domain';
import {liveAnswerEngine,liveAnswerRequest} from '@digitalguide/contracts';
import {runLiveAnswerNative,type LiveAnswerRunInput} from './live-answer-native.js';
const controller=new AbortController();let started=false;
process.on('disconnect',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
const send=(value:unknown)=>new Promise<void>(resolve=>{if(!process.connected)return resolve();process.send?.(value as object,()=>resolve());});
process.on('message',async(input:LiveAnswerRunInput&{cancel?:boolean})=>{if(input.cancel){controller.abort();return;}if(started)return;started=true;
 try{input.request=liveAnswerRequest.parse(input.request);input.engine=liveAnswerEngine.parse(input.engine);const result=await runLiveAnswerNative(input,controller.signal,progress=>{if(process.connected)process.send?.({progress});});await send({result});}
 catch(error){await send({code:error instanceof AppError?error.code:'LIVE_ANSWER_FAILED',error:controller.signal.aborted?'自动答疑已停止。':error instanceof AppError?error.message:'自动答疑未完成，请转人工或重试。'});}
 finally{if(process.connected)process.disconnect();}
});
