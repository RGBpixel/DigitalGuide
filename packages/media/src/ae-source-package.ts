import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {finished,pipeline} from 'node:stream/promises';
import {crc32} from 'node:zlib';
import * as yazl from 'yazl';
import * as yauzl from 'yauzl';
import {aeManifest,aeSourceBundle,type AeManifest,type AeSourceBundle} from '@digitalguide/contracts';
import {AppError,canonical} from '@digitalguide/domain';
export const aeSourceMaxBytes=516*1024*1024;
const sourceMaxBytes=512*1024*1024,metadataMaxBytes=1024*1024;
const invalid=(message:string)=>new AppError('AE_SOURCE_PACKAGE_INVALID','AE源文件包校验失败：'+message,422);
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function validate(bundle:AeSourceBundle,raw:Buffer):AeManifest{
 if(raw.length!==bundle.manifestSize||raw.length>metadataMaxBytes||sha(raw)!==bundle.manifestSHA256)throw invalid('原始工程清单的大小或SHA不一致。');
 let manifest:AeManifest;try{manifest=aeManifest.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));}catch{throw invalid('原始工程清单格式无效。');}
 if(manifest.catalogId!==bundle.catalogId||manifest.revision!==bundle.catalogRevision||manifest.name!==bundle.templateName||canonical(manifest.files)!==canonical(bundle.files)||bundle.simulated!==(bundle.mode==='contract_test')||!manifest.license.sourceExportAllowed)throw invalid('包元数据与原始工程清单不一致。');
 const names=[bundle.manifestFile.toLowerCase(),...manifest.files.map(f=>f.path.toLowerCase())];
 if(new Set(names).size!==names.length||manifest.files.reduce((n,f)=>n+f.size,0)>sourceMaxBytes||!manifest.files.some(f=>f.path===manifest.projectFile)||!manifest.files.some(f=>f.path===manifest.dataFile)||manifest.projectFile===manifest.dataFile||!manifest.projectFile.toLowerCase().endsWith('.aep')||!manifest.dataFile.endsWith('.json')||names.some(n=>/\.(exe|dll|js|jsx|jsxbin|bat|cmd|ps1|mjs|cjs|vbs|scr|com)$/.test(n)))throw invalid('工程路径、文件集合或总大小不符合限制。');
 // Offline integrity is independent of current catalog membership and temporal license checks.
 return manifest;
}
function sourceFile(directory:string,relative:string){
 const base=path.resolve(directory),parts=relative.split('/');let file=base;
 if(fs.lstatSync(base).isSymbolicLink()||!fs.statSync(base).isDirectory())throw invalid('源目录不可使用链接。');
 for(const [i,part]of parts.entries()){file=path.join(file,part);const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||(i<parts.length-1?!stat.isDirectory():!stat.isFile()))throw invalid('源文件不能包含链接或特殊文件。');}
 if(!file.startsWith(base+path.sep))throw invalid('文件路径越界。');return file;
}
export async function writeAeSourcePackage(input:{bundle:AeSourceBundle;rawManifest:Buffer;directory:string;file:string},signal:AbortSignal,onProgress:(progress:number)=>void=()=>{}){
 const bundle=aeSourceBundle.parse(input.bundle);validate(bundle,input.rawManifest);signal.throwIfAborted();
 const metadata=Buffer.from(JSON.stringify(bundle,null,2));if(metadata.length>metadataMaxBytes)throw invalid('包清单超过1MB。');
 const abort=new AbortController(),combined=AbortSignal.any([signal,abort.signal]),zip=new yazl.ZipFile(),streams:Readable[]=[],total=bundle.files.reduce((n,f)=>n+f.size,0);let read=0,written=0;
 zip.on('error',e=>(zip.outputStream as Readable).destroy(e));zip.addBuffer(metadata,'bundle.json',{compress:true});zip.addBuffer(input.rawManifest,'source/'+bundle.manifestFile,{compress:true});
 for(const file of bundle.files)zip.addReadStreamLazy('source/'+file.path,{size:file.size,compress:false},callback=>{
  try{combined.throwIfAborted();const source=sourceFile(input.directory,file.path),checked=Readable.from((async function*(){
   const hash=createHash('sha256');let size=0;
   for await(const bytes of fs.createReadStream(source,{signal:combined})){size+=bytes.length;if(size>file.size)throw invalid('源文件大小已变化。');hash.update(bytes);read+=bytes.length;onProgress(read/total);yield bytes;}
   if(size!==file.size||hash.digest('hex')!==file.sha256)throw invalid('源文件大小或SHA已变化。');
  })(),{signal:combined});streams.push(checked);checked.on('error',e=>(zip.outputStream as Readable).destroy(e));callback(null,checked);
  }catch(e){callback(e as Error,undefined as unknown as Readable);}
 });
 const limit=new Transform({transform(chunk:Buffer,_encoding,callback){written+=chunk.length;callback(written>aeSourceMaxBytes?invalid('ZIP超过516MB。'):null,chunk);}});
 try{zip.end();await pipeline(zip.outputStream,limit,fs.createWriteStream(input.file,{flags:'wx',mode:0o600}),{signal:combined});}
 finally{abort.abort();await Promise.allSettled(streams.map(s=>{s.destroy();return finished(s);}));}
}
// An optional destination must not exist. No AEP, script or plugin is ever executed.
export async function inspectAeSourcePackage(file:string,signal:AbortSignal,onProgress:(progress:number)=>void=()=>{},destination?:string){
 signal.throwIfAborted();const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>aeSourceMaxBytes)throw invalid('ZIP类型或大小无效。');
 const zip=await new Promise<yauzl.ZipFile>((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:false,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?reject(e):resolve(z!)));
 let zipError:Error|null=null,active:Readable|null=null,metadataReject:((e:Error)=>void)|null=null;
 const onError=(e:Error)=>{zipError=e;active?.destroy(e);metadataReject?.(e);},onAbort=()=>{onError(invalid('检查已取消。'));zip.close();};zip.on('error',onError);signal.addEventListener('abort',onAbort,{once:true});
 try{
  if(signal.aborted)onAbort();
  const entries=await new Promise<Map<string,yauzl.Entry>>((resolve,reject)=>{
   metadataReject=reject;if(zipError)return reject(zipError);const result=new Map<string,yauzl.Entry>();let total=0;
   zip.on('entry',(entry:yauzl.Entry)=>{try{
    signal.throwIfAborted();const name=entry.fileName,mode=(entry.externalFileAttributes>>>16)&0xf000;
    if(!(name==='bundle.json'||/^source\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[A-Za-z0-9]{1,8}$/.test(name))||name.length>167||result.has(name.toLowerCase()))throw invalid('路径越界、重复或不受支持。');
    if(entry.isEncrypted()||![0,8].includes(entry.compressionMethod)||(mode&&mode!==0x8000)||(entry.externalFileAttributes&0x10))throw invalid('不接受加密、目录、链接或特殊文件。');
    total+=entry.uncompressedSize;if(!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<=0||entry.uncompressedSize>sourceMaxBytes||total>sourceMaxBytes+2*metadataMaxBytes||result.size>=102||entry.uncompressedSize>Math.max(metadataMaxBytes,entry.compressedSize*200))throw invalid('展开大小、数量或压缩比例越界。');
    result.set(name.toLowerCase(),entry);zip.readEntry();
   }catch(e){reject(e);}});zip.once('end',()=>resolve(result));zip.readEntry();
  });metadataReject=null;
  async function checked(entry:yauzl.Entry,consume:(bytes:Buffer)=>Promise<void>|void){
   signal.throwIfAborted();if(zipError)throw zipError;const source=await new Promise<Readable>((resolve,reject)=>zip.openReadStream(entry,(e,s)=>e?reject(e):resolve(s!)));active=source;
   let size=0,crc=0;try{for await(const buffer of source){signal.throwIfAborted();const bytes=buffer as Buffer;size+=bytes.length;if(size>entry.uncompressedSize)throw invalid('实际展开大小越界。');crc=crc32(bytes,crc);await consume(bytes);}}finally{active=null;source.destroy();}
   if(size!==entry.uncompressedSize||crc!==entry.crc32)throw invalid('实际展开大小或CRC不一致。');
  }
  async function small(name:string){const entry=entries.get(name.toLowerCase());if(!entry||entry.fileName!==name||entry.uncompressedSize>metadataMaxBytes)throw invalid('缺少清单或清单超过1MB。');const chunks:Buffer[]=[];await checked(entry,b=>{chunks.push(b);});return Buffer.concat(chunks);}
  let bundle:AeSourceBundle;try{bundle=aeSourceBundle.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await small('bundle.json'))));}catch(e){if(e instanceof AppError)throw e;throw invalid('包格式或版本无效。');}
  const rawManifest=await small('source/'+bundle.manifestFile),manifest=validate(bundle,rawManifest),expected=['bundle.json','source/'+bundle.manifestFile,...bundle.files.map(f=>'source/'+f.path)];
  if(entries.size!==expected.length||expected.some(n=>entries.get(n.toLowerCase())?.fileName!==n)||bundle.files.some(f=>entries.get(('source/'+f.path).toLowerCase())?.uncompressedSize!==f.size))throw invalid('ZIP内容与固定文件清单不一致。');
  if(destination){fs.mkdirSync(destination,{recursive:false,mode:0o700});fs.mkdirSync(path.join(destination,'source'));const manifestFile=path.join(destination,'source',...bundle.manifestFile.split('/'));fs.mkdirSync(path.dirname(manifestFile),{recursive:true});fs.writeFileSync(manifestFile,rawManifest,{flag:'wx',mode:0o600});fs.writeFileSync(path.join(destination,'bundle.json'),JSON.stringify(bundle,null,2),{flag:'wx',mode:0o600});}
  const total=bundle.files.reduce((n,f)=>n+f.size,0);let done=0;
  for(const f of bundle.files){
   const hash=createHash('sha256'),target=destination?path.join(destination,'source',...f.path.split('/')):null;if(target)fs.mkdirSync(path.dirname(target),{recursive:true});const out=target?await fs.promises.open(target,'wx',0o600):null;
   try{await checked(entries.get(('source/'+f.path).toLowerCase())!,async bytes=>{hash.update(bytes);if(out){let offset=0;while(offset<bytes.length){const r=await out.write(bytes,offset,bytes.length-offset);if(!r.bytesWritten)throw invalid('解包写入失败。');offset+=r.bytesWritten;}}done+=bytes.length;onProgress(done/total);});}finally{await out?.close();}
   if(hash.digest('hex')!==f.sha256)throw invalid('源文件SHA不一致。');
  }
  return{bundle,manifest,rawManifest,integrityVerified:true as const,accessGranted:false as const};
 }finally{signal.removeEventListener('abort',onAbort);(active as Readable|null)?.destroy();zip.close();}
}
