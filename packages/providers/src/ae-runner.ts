import fs from 'node:fs';
import path from 'node:path';
import {performAeRender,AeRenderError,type AeRenderInput} from './ae-render.js';
const abort=new AbortController();let started=false;
process.on('disconnect',()=>abort.abort());process.on('SIGTERM',()=>abort.abort());
process.on('message',async(input:AeRenderInput&{cancel?:boolean})=>{
 if(input.cancel){abort.abort();return;}if(started)return;started=true;let succeeded=false;
 try{const result=await performAeRender(input,abort.signal,stage=>{if(process.connected)process.send?.({stage});});succeeded=true;if(process.connected)await new Promise<void>(resolve=>process.send?.({result},()=>resolve()));}
 catch(e){if(process.connected)await new Promise<void>(resolve=>process.send?.({error:{code:e instanceof AeRenderError?e.code:'AE_RENDER_FAILED',message:e instanceof AeRenderError?e.message:'AE工程处理或规格检查失败，请管理员检查授权素材和配置。'}},()=>resolve()));}
 finally{
  const directory=path.resolve(input.directory),parent=path.dirname(directory);
  if(path.basename(parent)==='ae-work'&&/^[a-f0-9-]{73}$/.test(path.basename(directory))&&directory.startsWith(parent+path.sep)&&fs.existsSync(directory)&&!fs.lstatSync(directory).isSymbolicLink()&&!fs.lstatSync(parent).isSymbolicLink()){
   const packet=path.join(directory,'packet');await fs.promises.rm(packet,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});
   if(!succeeded||abort.signal.aborted)await fs.promises.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});
  }
  if(process.connected)process.disconnect();
 }
});
