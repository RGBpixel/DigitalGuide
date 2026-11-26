import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { AppError, canonical } from '@digitalguide/domain';
import { assertNoLinks } from '../../../packages/recovery/src/files.js';
import type { DeveloperStudioFile } from './developer-studio-ports.js';
export const developerStudioFileFingerprint=(file:DeveloperStudioFile)=>createHash('sha256').update(canonical(file)).digest('hex');
export function developerStudioRange(size:number,range:string|undefined,ifRange:string|undefined,sha256:string):{start:number;end:number;length:number;status:200|206}|null{
  if(!Number.isSafeInteger(size)||size<0||size>32*1024*1024*1024)throw new AppError('MEDIA_INTEGRITY','输出文件元数据无效，请重新生成。',409);
  if(!range||ifRange&&ifRange!=='"'+sha256+'"')return{start:0,end:Math.max(-1,size-1),length:size,status:200};
  if(range.length>200)return null;const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||!match[1]&&!match[2]||size===0)return null;
  const suffix=match[1]?null:Number(match[2]);if(suffix!==null&&(!Number.isSafeInteger(suffix)||suffix<=0))return null;
  const start=match[1]?Number(match[1]):Math.max(0,size-suffix!),end=match[1]&&match[2]?Math.min(size-1,Number(match[2])):size-1;
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<=end&&start<size?{start,end,length:end-start+1,status:206}:null;
}
export async function openDeveloperStudioFile(dataDir:string,file:DeveloperStudioFile,signal?:AbortSignal):Promise<{handle:FileHandle;size:number}>{
  let handle:FileHandle|undefined;
  try{
    if(!/^[a-f0-9-]{36}\.(mp4|mov|wav|srt|vtt|json|zip)$/.test(file.storageKey)||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0||file.size>32*1024*1024*1024)throw new Error('metadata');
    const target=path.join(dataDir,'objects',file.storageKey);assertNoLinks(target);signal?.throwIfAborted();handle=await fs.promises.open(target,'r');const before=await handle.stat();if(!before.isFile()||before.size!==file.size)throw new Error('size');
    const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);let size=0;
    for(;;){signal?.throwIfAborted();const read=await handle.read(buffer,0,Math.min(buffer.length,file.size-size+1),size);if(!read.bytesRead)break;size+=read.bytesRead;if(size>file.size)throw new Error('grew');hash.update(buffer.subarray(0,read.bytesRead));}
    const after=await handle.stat();if(size!==file.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||hash.digest('hex')!==file.sha256)throw new Error('digest');assertNoLinks(target);return{handle,size};
  }catch(error){await handle?.close().catch(()=>{});if(signal?.aborted)throw error;throw new AppError('MEDIA_INTEGRITY','输出文件缺失、大小或摘要不符，请重新审阅并生成。',409);}
}
