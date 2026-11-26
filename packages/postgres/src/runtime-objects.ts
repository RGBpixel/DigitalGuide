import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {AppError} from '../../domain/src/index.js';
import {assertNoLinks} from '../../recovery/src/files.js';
import {assertNativeRuntimeDirectory,type NativeRuntimeConfig} from './runtime-config.js';
import {nativeBusinessInteger} from './runtime-repository.js';
import {NativeMediaFiles} from './runtime-media-files.js';
import {fileDigest} from '../../media/src/files.js';
import {pipeline} from 'node:stream/promises';
import {createWriteStream,constants} from 'node:fs';

export interface NativeObject {storage_key:string;size:string|number;sha256:string}
export class NativePrivateObjects {
 constructor(public readonly config:NativeRuntimeConfig){}
 private file(key:string,allowMissing=false){assertNativeRuntimeDirectory(this.config);if(!/^[a-f0-9-]{36}\.bin$/.test(key))throw new Error('Invalid private object key');const dir=path.join(this.config.dataDir,'objects');assertNoLinks(dir);const file=path.join(dir,key);assertNoLinks(file,allowMissing);return file;}
 async read(row:NativeObject,maximum=8*1024*1024){
  const size=nativeBusinessInteger(row.size);if(size<=0||size>maximum)throw new AppError('MEDIA_INTEGRITY','私有原件大小超出范围，请管理员核对。',409);
  try{const file=this.file(row.storage_key),handle=await fs.open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==size)throw new Error('size');const buffer=Buffer.alloc(size+1);let offset=0;while(offset<buffer.length){const r=await handle.read(buffer,offset,buffer.length-offset,offset);if(!r.bytesRead)break;offset+=r.bytesRead;}if(offset!==size||createHash('sha256').update(buffer.subarray(0,size)).digest('hex')!==row.sha256)throw new Error('digest');this.file(row.storage_key);return buffer.subarray(0,size);}finally{await handle.close();}}
  catch{throw new AppError('MEDIA_INTEGRITY','素材原件缺失、大小或摘要不符，请重新上传并明确采用新版本。',409);}
 }
 async write(buffer:Buffer):Promise<NativeObject>{const key=randomUUID()+'.bin';try{const file=this.file(key,true);await fs.writeFile(file,buffer,{flag:'wx',mode:0o600});}catch{throw new AppError('MEDIA_WRITE_FAILED','无法保存私有文件，请核对本机存储空间与权限后重试。',503,true);}return{storage_key:key,size:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')};}
 async verify(row:NativeObject,maximum:number,signal?:AbortSignal){signal?.throwIfAborted();if(nativeBusinessInteger(row.size)<=0||nativeBusinessInteger(row.size)>maximum)throw new AppError('MEDIA_INTEGRITY','原件大小超过当前格式限制。',409);const opened=await new NativeMediaFiles(this.config).open({...row,media_type:'application/octet-stream'});await opened.handle.close();signal?.throwIfAborted();}
 async install(source:string,maximum:number,signal?:AbortSignal):Promise<NativeObject>{assertNoLinks(source);const actual=await fileDigest(source,signal);if(actual.size<=0||actual.size>maximum)throw new AppError('MEDIA_INTEGRITY','原件大小超过当前格式限制。',409);const key=randomUUID()+'.bin',file=this.file(key,true);await fs.copyFile(source,file,constants.COPYFILE_EXCL);const object={storage_key:key,...actual};await this.verify(object,maximum,signal);return object;}
 async materialize(row:NativeObject,destination:string,maximum:number,signal?:AbortSignal){if(!path.resolve(destination).startsWith(path.resolve(this.config.dataDir)+path.sep))throw new AppError('MEDIA_INTEGRITY','工作副本位置不在当前私有目录。',409);if(nativeBusinessInteger(row.size)<=0||nativeBusinessInteger(row.size)>maximum)throw new AppError('MEDIA_INTEGRITY','原件大小超过当前格式限制。',409);assertNoLinks(destination,true);const files=new NativeMediaFiles(this.config),opened=await files.open({...row,media_type:'application/octet-stream'});try{await pipeline(files.stream(opened.handle,0,opened.size-1),createWriteStream(destination,{flags:'wx',mode:0o600}),{signal});}finally{await opened.handle.close().catch(()=>{});}const copied=await fileDigest(destination,signal);if(copied.size!==opened.size||copied.sha256!==row.sha256)throw new AppError('MEDIA_INTEGRITY','工作副本与固定来源不一致，未执行制作。',409);}
}
