import {inspectCollectionFile,type CollectionInspectionInput} from './collection-inspection.js';
const controller=new AbortController();let started=false;
process.on('disconnect',()=>controller.abort());
process.on('message',async(input:CollectionInspectionInput&{cancel?:boolean})=>{
  if(input.cancel){controller.abort();return;}if(started)return;started=true;
  try{const result=await inspectCollectionFile(input,controller.signal,progress=>{if(process.connected)process.send?.({progress});});if(process.connected)process.send?.({result});}
  catch{if(process.connected)process.send?.({error:controller.signal.aborted?'检查已停止，文件没有进入素材库。':'文件内容与登记类型不符、无法完整解码或超过支持范围；请转换为说明中支持的格式后重新提交。'});}
  finally{if(process.connected)process.disconnect();}
});
