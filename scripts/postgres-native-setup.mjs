import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawnSync} from 'node:child_process';
import yauzl from 'yauzl';

// Optional, private Windows validation runtime. No installer, service or PATH changes.
const root=path.resolve('storage/tools/postgresql/18.7-2'),archive=root+'.zip';
const url='https://get.enterprisedb.com/postgresql/postgresql-18.7-2-windows-x64-binaries.zip';
const officialLink='https://sbp.enterprisedb.com/getfile.jsp?fileid=1260725';
const expectedSHA256='74f3740a2e7844118857f297c2067d226f8f2b0652de96022ce54bb27cd60a79';
const hashFile=async file=>{const h=createHash('sha256');for await(const c of fs.createReadStream(file))h.update(c);return h.digest('hex');};
async function pinRuntime(){
  if(await hashFile(archive)!==expectedSHA256)throw new Error('Pinned PostgreSQL archive digest changed.');
  const licenseNames=['pgsql/server_license.txt','pgsql/commandlinetools_3rd_party_licenses.txt'];
  if(licenseNames.some(n=>!fs.existsSync(path.join(root,n)))){
    const z=await new Promise((r,j)=>yauzl.open(archive,{lazyEntries:true},(e,v)=>e?j(e):r(v)));
    await new Promise((r,j)=>{z.on('error',j);z.on('end',r);z.on('entry',e=>{void(async()=>{if(licenseNames.includes(e.fileName)&&!fs.existsSync(path.join(root,e.fileName))){const s=await new Promise((r,j)=>z.openReadStream(e,(err,v)=>err?j(err):r(v)));await pipeline(s,fs.createWriteStream(path.join(root,e.fileName),{flags:'wx'}));}z.readEntry();})().catch(j);});z.readEntry();});
  }
  const entries=[];async function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const f=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Linked native runtime is not supported.');if(e.isDirectory())await walk(f);else if(e.isFile())entries.push({file:path.relative(root,f).replaceAll('\\','/'),bytes:fs.statSync(f).size,sha256:await hashFile(f)});else throw new Error('Unexpected native runtime file.');}}await walk(path.join(root,'pgsql'));
  const file=path.join(root,'pinned-files.json');if(fs.existsSync(file)){if(JSON.stringify(JSON.parse(fs.readFileSync(file,'utf8')).files)!==JSON.stringify(entries))throw new Error('Pinned native runtime files changed.');}else fs.writeFileSync(file,JSON.stringify({archiveSHA256:expectedSHA256,files:entries,source:'official HTTPS binary archive; observed hash pinned after first verification',vendorPublishedChecksum:false},null,2)+'\n',{flag:'wx'});
  return entries.length;
}
if(process.platform!=='win32')throw new Error('This bootstrap only supports Windows x64.');
if(fs.existsSync(root+'/verified.json')){const files=await pinRuntime();console.log(JSON.stringify({result:'PASS',version:'18.7',runtimeFilesRehashed:files,archiveSHA256:expectedSHA256,installedService:false}));process.exit(0);}
fs.mkdirSync(path.dirname(root),{recursive:true});
if(!fs.existsSync(archive)){
  const r=await fetch(url,{signal:AbortSignal.timeout(1200000)});if(!r.ok||r.url!==url)throw new Error('Official PostgreSQL download failed.');
  let bytes=0;const meter=new Transform({transform(c,_,next){bytes+=c.length;next(null,c);}});
  try{await pipeline(Readable.fromWeb(r.body),meter,fs.createWriteStream(archive+'.partial',{flags:'wx'}));if(bytes!==389514869)throw new Error('PostgreSQL archive size changed.');fs.renameSync(archive+'.partial',archive);}catch(e){fs.rmSync(archive+'.partial',{force:true});throw e;}
}
const h=createHash('sha256');for await(const c of fs.createReadStream(archive))h.update(c);const sha256=h.digest('hex');
if(sha256!==expectedSHA256)throw new Error('Pinned PostgreSQL archive digest changed.');
// EDB does not publish a checksum for this archive. This is an observed hash, not a vendor signature.
const zip=await new Promise((resolve,reject)=>yauzl.open(archive,{lazyEntries:true,strictFileNames:true},(e,z)=>e?reject(e):resolve(z)));
fs.mkdirSync(root,{recursive:false});let files=0,bytes=0;
try{await new Promise((resolve,reject)=>{
  zip.on('error',reject);zip.on('end',resolve);zip.on('entry',entry=>{void(async()=>{
    const n=entry.fileName,mode=(entry.externalFileAttributes>>>16)&0o170000;
    if(!n.startsWith('pgsql/')||n.includes('\\')||n.split('/').some(x=>x==='..')||(mode&&mode!==0o100000&&mode!==0o040000))throw new Error('Unsafe PostgreSQL archive entry.');
    if(!/^(pgsql\/(bin|lib|share)\/|pgsql\/(COPYRIGHT|LICENSE|README)[^/]*)/.test(n)||n.endsWith('/')){zip.readEntry();return;}
    bytes+=entry.uncompressedSize;if(bytes>1200*1024**2||++files>50000)throw new Error('PostgreSQL extraction limit exceeded.');
    const target=path.join(root,n);fs.mkdirSync(path.dirname(target),{recursive:true});
    const s=await new Promise((res,rej)=>zip.openReadStream(entry,(e,v)=>e?rej(e):res(v)));await pipeline(s,fs.createWriteStream(target,{flags:'wx'}));zip.readEntry();
  })().catch(reject);});zip.readEntry();});}finally{zip.close();}
const result=spawnSync(path.join(root,'pgsql/bin/postgres.exe'),['--version'],{windowsHide:true,encoding:'utf8'});
if(result.status!==0||!/^postgres \(PostgreSQL\) 18\.7\s*$/.test(result.stdout))throw new Error('Unexpected native PostgreSQL version.');
await pinRuntime();
const receipt={result:'PASS',officialPage:'https://www.enterprisedb.com/download-postgresql-binaries',officialLink,url,observedSHA256:sha256,vendorPublishedChecksum:false,version:result.stdout.trim(),files,uncompressedBytes:bytes,privateRuntime:true,installedService:false,networkBinding:'not_started'};
fs.writeFileSync(root+'/verified.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));
