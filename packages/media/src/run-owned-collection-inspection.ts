import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {AppError} from '@digitalguide/domain';
import {collectionInspectionOutput,type CollectionInspectionInput} from './collection-inspection.js';
export async function runOwnedCollectionInspection(input:CollectionInspectionInput,signal:AbortSignal,onProgress:(value:number)=>void){
 if(process.platform!=='win32')throw new AppError('AE_MEDIA_PLATFORM_UNAVAILABLE','当前AE采用检查使用Windows进程看护；此主机尚未配置等效的进程树隔离。',503);
 const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),source=path.join(input.root,'packages/media/src/collection-native-worker.ts'),bundled=['worker.mjs','api.mjs'].includes(path.basename(fileURLToPath(import.meta.url))),development=process.env.APP_ENV!=='production'&&!bundled&&fs.existsSync(source),entry=development?source:path.join(input.root,'dist/collection-native.mjs'),supervisor=path.join(input.root,'scripts/native-process-job.ps1');
 const runtime={kind:development?'source' as const:'compiled' as const,entrySHA256:hash(entry),supervisorSHA256:hash(supervisor)};
 fs.mkdirSync(input.directory,{recursive:true});const requestFile=path.join(input.directory,'inspection-request.json'),resultFile=path.join(input.directory,'inspection-result.json'),progressFile=path.join(input.directory,'inspection-progress.jsonl'),nativeRequest=path.join(input.directory,'native-request.json'),cancelFile=path.join(input.directory,'cancel'),marker=path.join(input.directory,'inspection-process.json');
 fs.writeFileSync(requestFile,JSON.stringify({input,resultFile,progressFile}),{flag:'wx',mode:0o600});fs.writeFileSync(nativeRequest,JSON.stringify({executable:process.execPath,arguments:['--max-old-space-size=256',...(development?['--import','tsx']:[]),entry,requestFile],directory:input.root,cancelFile,marker}),{flag:'wx',mode:0o600});
 const environment:NodeJS.ProcessEnv={};for(const key of ['SystemRoot','WINDIR','SystemDrive','TEMP','TMP'])if(process.env[key])environment[key]=process.env[key];environment.PATH=path.join(process.env.SystemRoot||'C:/Windows','System32');
 await new Promise<void>((resolve,reject)=>{
  signal.throwIfAborted();const child=spawn(path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',supervisor,'-ParentProcessId',String(process.pid),'-InputPath',nativeRequest],{cwd:input.root,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let cancelling=false,timedOut=false,spawnFailed=false,callbackError:unknown,killTimer:ReturnType<typeof setTimeout>|undefined,last=-1;
  const cancel=()=>{if(cancelling)return;cancelling=true;try{fs.writeFileSync(cancelFile,'cancel',{flag:'wx'});}catch{/* Cancellation is idempotent within this private directory. */}killTimer=setTimeout(()=>child.kill(),6000);};
  function progress(){try{if(!fs.existsSync(progressFile))return;const stat=fs.statSync(progressFile);if(stat.size>32768){callbackError=new Error('Inspection progress exceeds its bound');cancel();return;}const lines=fs.readFileSync(progressFile,'utf8').trim().split('\n'),line=lines.at(-1);if(!line)return;let value:unknown;try{value=JSON.parse(line).progress;}catch{return;}if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1){callbackError=new Error('Invalid inspection progress');cancel();return;}if(value>last){last=value;onProgress(value);}}catch(error){callbackError=error;cancel();}}
  const timer=setTimeout(()=>{timedOut=true;cancel();},1810000),poll=setInterval(progress,100);child.stdout.resume();child.stderr.resume();child.on('error',()=>{spawnFailed=true;});signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  child.once('close',code=>{clearTimeout(timer);clearTimeout(killTimer);clearInterval(poll);signal.removeEventListener('abort',cancel);if(signal.aborted||cancelling||callbackError||code!==0||spawnFailed||timedOut){reject(callbackError instanceof Error?callbackError:new AppError('AE_MEDIA_INSPECTION_FAILED','受控媒体检查中断或失败，未登记部分文件；请核对格式后明确重试。',409));return;}progress();if(callbackError)reject(callbackError);else resolve();});
 });
 signal.throwIfAborted();if(fs.statSync(resultFile).size>32768)throw new AppError('AE_MEDIA_INSPECTION_RESULT','检查回执超过范围，未采用结果。',409);
 return{...collectionInspectionOutput.parse(JSON.parse(fs.readFileSync(resultFile,'utf8'))),runtime};
}
