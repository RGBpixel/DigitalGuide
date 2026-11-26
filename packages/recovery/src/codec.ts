import fs from 'node:fs';
import path from 'node:path';
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {Transform,Writable,type Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';
import {RecoveryError} from './guard.js';
import {assertNoLinks,checkCancelled,type RecoveryLimits} from './files.js';
import {validateManifest,type RecoveryManifest} from './manifest.js';

const magic=Buffer.from('DGRBK001'),headerBytes=20,tagBytes=16,maxManifestBytes=32*1024**2;
export interface ArchiveInventory {files:{path:string;bytes:number;sha256:string}[];directories:string[]}
export function readRecoveryKey(file:string){
  assertNoLinks(file);const s=fs.lstatSync(file);if(!s.isFile()||s.size>1024)throw new RecoveryError('RECOVERY_KEY_INVALID','备份密钥必须是独立文件中的32字节或64位十六进制值。');
  const key=fs.readFileSync(file),trimmed=key.toString('utf8').trim();
  if(/^[a-f0-9]{64}$/i.test(trimmed)){const result=Buffer.from(trimmed,'hex');key.fill(0);return result;}
  if(key.length===32)return key;key.fill(0);throw new RecoveryError('RECOVERY_KEY_INVALID','备份密钥必须是独立文件中的32字节或64位十六进制值。');
}
export async function encryptArchive(manifest:ArchiveInventory,dataDir:string,target:string,key:Buffer,signal?:AbortSignal){
  const header=Buffer.concat([magic,randomBytes(12)]),cipher=createCipheriv('aes-256-gcm',key,header.subarray(8));cipher.setAAD(header);
  const zip=new yazl.ZipFile();zip.once('error',e=>(zip.outputStream as Readable).destroy(e));const metadata=Buffer.from(JSON.stringify(manifest));if(metadata.length>maxManifestBytes)throw new RecoveryError('RECOVERY_LIMIT_EXCEEDED','备份清单超过格式限制。');
  const options={compress:false,mtime:new Date('2000-01-01T00:00:00Z'),mode:0o100600};zip.addBuffer(metadata,'manifest.json',options);
  for(const f of manifest.files)zip.addFile(path.join(dataDir,...f.path.split('/')),'payload/'+f.path,options);
  const output=fs.createWriteStream(target,{flags:'wx',mode:0o600,flush:true});output.write(header);zip.end();
  await pipeline(zip.outputStream,cipher,output,{signal});checkCancelled(signal);fs.appendFileSync(target,cipher.getAuthTag());const fd=fs.openSync(target,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export async function decryptArchive(archive:string,target:string,key:Buffer,cap:RecoveryLimits,signal?:AbortSignal){
  assertNoLinks(archive);const fd=fs.openSync(archive,'r');
  try{
    const before=fs.fstatSync(fd),maxArchiveBytes=cap.maxBytes+cap.maxFiles*2048+maxManifestBytes+1024;
    if(!before.isFile()||before.size<headerBytes+tagBytes||!Number.isSafeInteger(maxArchiveBytes)||before.size>maxArchiveBytes)throw new RecoveryError('RECOVERY_ARCHIVE_INVALID','加密备份长度或容量不符合限制。');
    const header=Buffer.alloc(headerBytes),tag=Buffer.alloc(tagBytes);fs.readSync(fd,header,0,header.length,0);fs.readSync(fd,tag,0,tag.length,before.size-tagBytes);
    if(!header.subarray(0,8).equals(magic))throw new RecoveryError('RECOVERY_ARCHIVE_INVALID','不是当前支持的加密备份格式。');
    const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(8));decipher.setAAD(header);decipher.setAuthTag(tag);const hash=createHash('sha256');hash.update(header);
    const meter=new Transform({transform(chunk,_,done){hash.update(chunk);done(null,chunk);}});
    try{await pipeline(fs.createReadStream(archive,{fd,autoClose:false,start:headerBytes,end:before.size-tagBytes-1}),meter,decipher,fs.createWriteStream(target,{flags:'wx',mode:0o600,flush:true}),{signal});}catch{checkCancelled(signal);throw new RecoveryError('RECOVERY_AUTH_FAILED','备份认证解密失败。请核对密钥和文件完整性，不能恢复此文件。');}
    hash.update(tag);const after=fs.fstatSync(fd);assertNoLinks(archive);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new RecoveryError('RECOVERY_SOURCE_CHANGED','检查期间备份文件发生变化，请固定原文件后重试。');
    return{archiveSHA256:hash.digest('hex'),archiveBytes:before.size};
  }finally{fs.closeSync(fd);}
}
async function stream(zip:yauzl.ZipFile,entry:yauzl.Entry){return new Promise<Readable>((resolve,reject)=>zip.openReadStream(entry,(e,s)=>e||!s?reject(e||new Error('Missing ZIP stream')):resolve(s)));}
export function inspectZip(file:string,dataDir:string,cap:RecoveryLimits,materialize:boolean,signal?:AbortSignal):Promise<RecoveryManifest>{return inspectArchiveZip(file,dataDir,cap,materialize,validateManifest,signal,['digitalguide.sqlite']);}
export async function inspectArchiveZip<T extends ArchiveInventory>(file:string,dataDir:string,cap:RecoveryLimits,materialize:boolean,validate:(input:unknown,cap:RecoveryLimits)=>T,signal?:AbortSignal,selected:string[]=[]):Promise<T>{
  const zip=await new Promise<yauzl.ZipFile>((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:true,validateEntrySizes:true,strictFileNames:true},(e,z)=>e||!z?reject(e||new Error('Missing ZIP')):resolve(z)));
  return new Promise((resolve,reject)=>{
    let manifest:T|undefined,active:Readable|undefined,done=false,totalBytes=0;const seen=new Set<string>();
    function fail(e:unknown){if(done)return;done=true;active?.destroy();zip.close();reject(signal?.aborted?new RecoveryError('RECOVERY_CANCELLED','操作已取消，未发布的文件会清理。'):e instanceof RecoveryError?e:new RecoveryError('RECOVERY_ARCHIVE_INVALID','备份归档结构、路径或内容校验失败。'));}
    zip.on('error',fail);zip.once('end',()=>{if(done)return;if(!manifest||seen.size!==manifest.files.length) return fail(new RecoveryError('RECOVERY_ARCHIVE_INVALID','备份缺少清单中的文件。'));done=true;resolve(manifest);});
    zip.on('entry',entry=>{void(async()=>{
      checkCancelled(signal);const mode=(entry.externalFileAttributes>>>16)&0o170000;
      if(entry.compressionMethod!==0||(mode!==0&&mode!==0o100000)||entry.generalPurposeBitFlag&1)throw new RecoveryError('RECOVERY_ARCHIVE_INVALID','备份包含不支持的压缩、文件类型或嵌套加密。');
      active=await stream(zip,entry);
      if(!manifest){
        if(entry.fileName!=='manifest.json'||entry.uncompressedSize>maxManifestBytes)throw new RecoveryError('RECOVERY_MANIFEST_INVALID','备份必须首先包含有界清单。');
        const chunks:Buffer[]=[];let size=0;for await(const chunk of active){checkCancelled(signal);size+=chunk.length;if(size>maxManifestBytes)throw new RecoveryError('RECOVERY_LIMIT_EXCEEDED','备份清单超过限制。');chunks.push(chunk as Buffer);}
        manifest=validate(JSON.parse(Buffer.concat(chunks).toString('utf8')),cap);if(materialize)for(const d of manifest.directories)fs.mkdirSync(path.join(dataDir,...d.split('/')),{recursive:true,mode:0o700});
      }else{
        const rel=entry.fileName.startsWith('payload/')?entry.fileName.slice(8):'',expected=manifest.files.find(f=>f.path===rel);if(!expected||seen.has(rel)||entry.uncompressedSize!==expected.bytes)throw new RecoveryError('RECOVERY_ARCHIVE_INVALID','备份文件不在清单中、重复或长度不符。');seen.add(rel);const h=createHash('sha256');let size=0;
        const meter=new Transform({transform(chunk,_,next){size+=chunk.length;totalBytes+=chunk.length;if(size>expected.bytes||totalBytes>cap.maxBytes)return next(new RecoveryError('RECOVERY_LIMIT_EXCEEDED','备份解码内容超过限制。'));h.update(chunk);next(null,chunk);}});
        const target=path.join(dataDir,...rel.split('/')),write=materialize||selected.includes(rel);if(write)fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
        await pipeline(active,meter,write?fs.createWriteStream(target,{flags:'wx',mode:0o600,flush:true}):new Writable({write(_chunk,_encoding,next){next();}}),{signal});
        if(size!==expected.bytes||h.digest('hex')!==expected.sha256)throw new RecoveryError('RECOVERY_CONTENT_CHANGED','备份文件摘要不符，不能发布恢复目录。');
      }
      active=undefined;zip.readEntry();
    })().catch(fail);});
    zip.readEntry();
  });
}
