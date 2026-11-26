import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable,Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yazl from 'yazl';
import { AppError } from '@digitalguide/domain';
export interface PublishingPackageFile {file:string;name:string;size:number;sha256:string}
export async function writePublishingPackage(files:PublishingPackageFile[],metadata:object,destination:string,signal:AbortSignal){
 const zip=new yazl.ZipFile(),abort=new AbortController(),combined=AbortSignal.any([signal,abort.signal]);zip.on('error',e=>(zip.outputStream as Readable).destroy(e));
 const meta=Buffer.from(JSON.stringify(metadata,null,2)+'\n'),instructions=Buffer.from('人工发布包\n\n本文件不会自动上传或发布。请核对metadata.json中的目标平台、标题、正文、标签和AI标识，选择video.mp4、cover.png及字幕。平台的实时规格、账号权限和内容规则须由发布人员另行核对。\n\n本包不包含渠道账号凭据或供应商模型。\n');
 zip.addBuffer(meta,'metadata.json');zip.addBuffer(instructions,'发布说明.txt');zip.addBuffer(Buffer.from(files.map(f=>f.sha256+'  '+f.name).concat(createHash('sha256').update(meta).digest('hex')+'  metadata.json').join('\n')+'\n'),'checksums.sha256');
 const names=new Set<string>();for(const f of files){if(!/^(video\.mp4|audio\.wav|subtitles\.(srt|vtt)|cover\.png)$/.test(f.name)||names.has(f.name))throw new AppError('INVALID_PUBLISH_PACKAGE','发布包文件名无效或重复。',409);names.add(f.name);zip.addReadStreamLazy(f.name,{size:f.size,compress:false},callback=>{
  const checked=Readable.from((async function*(){let size=0;const hash=createHash('sha256');for await(const chunk of fs.createReadStream(f.file,{signal:combined})){size+=chunk.length;if(size>f.size)throw new AppError('PUBLISH_FILE_CHANGED','视频、封面或字幕大小已变化，请重新生成。',409);hash.update(chunk);yield chunk;}if(size!==f.size||hash.digest('hex')!==f.sha256)throw new AppError('PUBLISH_FILE_CHANGED','视频、封面或字幕字节校验失败，请重新生成。',409);})());checked.once('error',e=>(zip.outputStream as Readable).destroy(e));callback(null,checked);
 });}
 let written=0;const cap=new Transform({transform(chunk:Buffer,_encoding,done){written+=chunk.length;done(written>1073741824?new AppError('PUBLISH_PACKAGE_LIMIT','发布包超过1 GB，请拆分内容。',409):null,chunk);}});
 try{zip.end();await pipeline(zip.outputStream,cap,fs.createWriteStream(destination,{flags:'wx'}),{signal:combined});}finally{abort.abort();}
}
