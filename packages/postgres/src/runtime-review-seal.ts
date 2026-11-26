import fs from 'node:fs/promises';
import path from 'node:path';
import {AppError} from '../../domain/src/index.js';
import {NativeMediaFiles,type NativeMediaArtifact} from './runtime-media-files.js';
import type {NativeRuntimeConfig} from './runtime-config.js';

// Keep verified handles alive until the outer authentication transaction commits or rolls back.
export async function sealNativeReviewFiles(config:NativeRuntimeConfig,files:NativeMediaArtifact[],finalCheck?:()=>Promise<void>){
 const opened:{file:NativeMediaArtifact;handle:fs.FileHandle;stat:NonNullable<Awaited<ReturnType<fs.FileHandle['stat']>>>}[]=[];
 try{
  const unique=new Map<string,NativeMediaArtifact>();for(const file of files){const old=unique.get(file.storage_key);if(old&&(old.sha256!==file.sha256||Number(old.size)!==Number(file.size)))throw new AppError('REVIEW_FILE_CHANGED','同一原件出现不同摘要，请重新生成并审核。',409);unique.set(file.storage_key,file);}
  for(const file of unique.values()){const {handle}=await new NativeMediaFiles(config).open(file);try{opened.push({file,handle,stat:await handle.stat()});}catch(e){await handle.close();throw e;}}
  return{async unchanged(){for(const item of opened){try{const a=await item.handle.stat(),b=await fs.lstat(path.join(config.dataDir,'objects',item.file.storage_key));if(!b.isFile()||b.isSymbolicLink()||[a,b].some(s=>s.ino!==item.stat.ino||s.dev!==item.stat.dev||s.size!==item.stat.size||s.mtimeMs!==item.stat.mtimeMs||s.ctimeMs!==item.stat.ctimeMs))throw new Error('changed');}catch{throw new AppError('REVIEW_FILE_CHANGED','审核期间原件或成品发生变化，本次结果未确认，请重新核对。',409);}}await finalCheck?.();},async close(){await Promise.allSettled(opened.map(v=>v.handle.close()));}};
 }catch(e){await Promise.allSettled(opened.map(v=>v.handle.close()));throw e;}
}
