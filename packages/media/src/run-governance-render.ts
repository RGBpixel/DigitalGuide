import path from 'node:path';
import {fork} from 'node:child_process';
import type {GovernanceRenderInput,GovernanceRenderResult} from './governance-render.js';
export function runGovernanceRender(input:GovernanceRenderInput,signal:AbortSignal):Promise<GovernanceRenderResult>{
 const compiled=/^(?:api|worker)\.mjs$/.test(path.basename(process.argv[1]||'')),entry=path.join(input.root,compiled?'dist/governance-render.mjs':'packages/media/src/governance-worker.ts');
 return new Promise((resolve,reject)=>{const child=fork(entry,[],{execArgv:['--max-old-space-size=512',...(compiled?[]:['--import','tsx'])],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});let settled=false,timer:ReturnType<typeof setTimeout>|undefined,received:GovernanceRenderResult|undefined,receivedError:Error|undefined;
  const finish=(error?:Error,result?:GovernanceRenderResult)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);if(error)reject(error);else resolve(result!);};
  const cancel=()=>{if(child.connected)child.send({cancel:true});timer=setTimeout(()=>{child.kill();finish(new Error('标识制作已取消。'));},3000);};
  signal.addEventListener('abort',cancel,{once:true});child.once('error',e=>finish(e));child.once('close',()=>{if(!settled)finish(receivedError||(signal.aborted?new Error('标识制作已取消。'):received?undefined:new Error('标识制作进程提前退出，请重试或检查素材。')),received);});child.on('message',(message:{result?:GovernanceRenderResult;error?:string})=>{if(message.error)receivedError=new Error(message.error);else if(message.result)received=message.result;});child.send(input);if(signal.aborted)cancel();
 });
}
