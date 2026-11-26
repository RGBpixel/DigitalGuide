import {AppError} from '@digitalguide/domain';
import {contentWritingEngine,contentWritingRequest} from '@digitalguide/contracts';
import {runContentWritingNative,type ContentWritingRunInput} from './content-writing-native.js';
const controller=new AbortController();let started=false;
process.on('disconnect',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
const send=(value:unknown)=>new Promise<void>(resolve=>{if(!process.connected)return resolve();process.send?.(value as object,()=>resolve());});
process.on('message',async(input:ContentWritingRunInput&{cancel?:boolean})=>{if(input.cancel){controller.abort();return;}if(started)return;started=true;
 try{input.request=contentWritingRequest.parse(input.request);input.engine=contentWritingEngine.parse(input.engine);const result=await runContentWritingNative(input,controller.signal,progress=>{if(process.connected)process.send?.({progress});});await send({result});}
 catch(error){await send({code:error instanceof AppError?error.code:'CONTENT_WRITING_FAILED',error:controller.signal.aborted?'资料脚本生成已停止。':error instanceof AppError?error.message:'资料脚本生成未完成，请转人工或重试。'});}
 finally{if(process.connected)process.disconnect();}
});
