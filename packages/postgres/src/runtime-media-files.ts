import fs,{type ReadStream} from 'node:fs';
import type {FileHandle} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {AppError} from '../../domain/src/index.js';
import {assertNoLinks} from '../../recovery/src/files.js';
import {assertNativeRuntimeDirectory,type NativeRuntimeConfig} from './runtime-config.js';
import {nativeBusinessInteger as integer} from './runtime-repository.js';
import {fileDigest} from '../../media/src/files.js';

export interface NativeMediaArtifact {storage_key:string;size:string|number;sha256:string;media_type:string;name?:string}
export class NativeMediaFiles {
 constructor(readonly config:NativeRuntimeConfig){}
 file(key:string,allowMissing=false){assertNativeRuntimeDirectory(this.config);if(!/^[a-f0-9-]{36}\.(?:bin|mp4|mov|wav|srt|vtt|json|zip)$/.test(key))throw new AppError('MEDIA_INTEGRITY','私有输出文件编号不符合要求，请重新生成。',409);const file=path.join(this.config.dataDir,'objects',key);assertNoLinks(path.dirname(file));assertNoLinks(file,allowMissing);return file;}
 async open(a:NativeMediaArtifact):Promise<{handle:FileHandle;size:number}>{let handle:FileHandle|undefined;try{const size=integer(a.size);if(size<0||size>32*1024*1024*1024||!/^[a-f0-9]{64}$/.test(a.sha256))throw new Error('invalid metadata');handle=await fs.promises.open(this.file(a.storage_key),'r');const before=await handle.stat();if(!before.isFile()||before.size!==size)throw new Error('invalid size');const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);let read=0;for(;;){const result=await handle.read(buffer,0,Math.min(buffer.length,size-read+1),read);if(!result.bytesRead)break;read+=result.bytesRead;if(read>size)throw new Error('grew');hash.update(buffer.subarray(0,result.bytesRead));}const after=await handle.stat();if(read!==size||after.size!==size||after.mtimeMs!==before.mtimeMs||hash.digest('hex')!==a.sha256)throw new Error('digest');this.file(a.storage_key);return{handle,size};}catch{await handle?.close().catch(()=>{});throw new AppError('MEDIA_INTEGRITY','输出文件缺失、大小或摘要不符，请重新审阅并生成。',409);}}
 async verify(a:NativeMediaArtifact){const opened=await this.open(a);await opened.handle.close();}
 async install(file:string,directory:string,mediaType:string,signal?:AbortSignal):Promise<NativeMediaArtifact>{const resolved=path.resolve(file),base=path.basename(file);if(!resolved.startsWith(path.resolve(directory)+path.sep)||!/^([a-f0-9-]{36})\.(mp4|mov|wav|srt|vtt|json|zip)$/.test(base))throw new AppError('MEDIA_INTEGRITY','渲染器返回的输出位置不符合约定。',409);assertNoLinks(resolved);const before=await fileDigest(resolved,signal);if(before.size>32*1024*1024*1024)throw new AppError('OUTPUT_TOO_LARGE','单文件超过32GB，请分段输出。',409);const key=randomUUID()+path.extname(base);await fs.promises.copyFile(resolved,this.file(key,true),fs.constants.COPYFILE_EXCL);const artifact={storage_key:key,media_type:mediaType,...before};await this.verify(artifact);return artifact;}
 stream(handle:FileHandle,start:number,end:number):ReadStream{return handle.createReadStream({start,end,autoClose:true});}
}
