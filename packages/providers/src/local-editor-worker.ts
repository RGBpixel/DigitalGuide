import {AppError} from '@digitalguide/domain';
import {localEditorEngine} from '@digitalguide/contracts';
import {runLocalEditorNative} from './local-editor-native.js';
import {localEditorRequest,type LocalEditorRunInput} from './local-editor-protocol.js';
const controller=new AbortController();let started=false;
process.on('disconnect',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
process.on('message',async(input:LocalEditorRunInput&{cancel?:boolean})=>{if(input.cancel){controller.abort();return;}if(started)return;started=true;try{input.request=localEditorRequest.parse(input.request);input.engine=localEditorEngine.parse(input.engine);const result=await runLocalEditorNative(input,controller.signal,progress=>{if(process.connected)process.send?.({progress});});if(process.connected)process.send?.({result});}catch(error){if(process.connected)process.send?.({code:error instanceof AppError?error.code:'LOCAL_EDITOR_FAILED',error:controller.signal.aborted?'本机语义编辑已停止。':error instanceof AppError?error.message:'本机编辑未完成，请检查固定模型或缩短文字后重试。'});}finally{if(process.connected)process.disconnect();}});
