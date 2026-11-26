import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {aeContractFixture} from './ae-templates.js';
// Own synthetic material only. This deliberately does not produce a valid Adobe AEP.
export function aeSourceFixture(directory:string,options:{revision?:number;allowed?:boolean;expiresAt?:string|null;largeBytes?:number}={}){
 const fixture=aeContractFixture(directory,{revision:options.revision}),manifest=fixture.manifest;
 manifest.catalogId='original-source-export';manifest.name='原创源文件契约示例（非Adobe）';manifest.license={note:'原创合成契约夹具，允许在开发环境打包/下载源文件；假AEP不是有效Adobe工程。',sourceExportAllowed:options.allowed??true,expiresAt:options.expiresAt??null};
 if(options.largeBytes){
  const file=path.join(fixture.folder,'assets','original-data.bin'),fd=fs.openSync(file,'wx'),hash=createHash('sha256'),chunk=Buffer.alloc(1024*1024);for(let i=0;i<chunk.length;i++)chunk[i]=(i*31+17)%251;
  try{let left=options.largeBytes;while(left>0){const bytes=chunk.subarray(0,Math.min(left,chunk.length));fs.writeSync(fd,bytes);hash.update(bytes);left-=bytes.length;}}finally{fs.closeSync(fd);}manifest.files.push({path:'assets/original-data.bin',size:options.largeBytes,sha256:hash.digest('hex')});
 }
 const manifestFile=path.join(fixture.folder,fixture.runtime.catalog[0].manifestFile),raw=Buffer.from(JSON.stringify(manifest,null,2));fs.writeFileSync(manifestFile,raw);Object.assign(fixture.runtime.catalog[0],{catalogId:manifest.catalogId,manifestSHA256:createHash('sha256').update(raw).digest('hex')});fs.writeFileSync(fixture.configFile,JSON.stringify(fixture.runtime,null,2));
 return{...fixture,manifestFile,rawManifest:raw};
}
