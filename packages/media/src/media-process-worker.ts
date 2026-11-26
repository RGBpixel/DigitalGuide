import {AppError} from '@digitalguide/domain';
import path from 'node:path';
import {mediaProcessingPayload} from '@digitalguide/contracts';
import {processLocalMedia,type MediaProcessingInput} from './media-processing.js';
const controller=new AbortController();let started=false;
// Wait until a large final report has left the IPC write queue before disconnecting.
async function finalMessage(message:object){if(!process.connected||!process.send)return;await new Promise<void>(resolve=>{try{process.send!(message,()=>resolve());}catch{resolve();}});}
process.on('disconnect',()=>{controller.abort();setTimeout(()=>process.exit(1),10000).unref();});
process.on('message',async(input:MediaProcessingInput&{cancel?:boolean})=>{if(input.cancel){controller.abort();return;}if(started)return;started=true;try{input.payload=mediaProcessingPayload.parse(input.payload);const result=await processLocalMedia(input,controller.signal,progress=>{if(process.connected)process.send?.({progress});});result.report.metrics.compiledWorkerEntry=path.resolve(process.argv[1]||'')===path.join(input.root,'dist/media-process.mjs')?1:0;await finalMessage({result});}catch(error){await finalMessage({error:controller.signal.aborted?'媒体加工已取消。':error instanceof AppError?error.message:'媒体加工未完成，请检查原片、区间或处理工具后重试。'});}finally{if(process.connected)process.disconnect();}});
