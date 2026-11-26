import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const base='docs/evidence/T20/postgres-video',root=base+'/checks-final';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const proof=read(base+'/compiled-final/proof.json');
assert.equal(proof.result,'PASS');
for(const [file,sha]of Object.entries(proof.entrySHA256))assert.equal(hash(file),sha,file);
for(const [name,sha]of Object.entries(proof.compiledRendererSHA256))assert.equal(hash('dist/'+name),sha,name);
for(const name of ['typecheck','lint'])assert.equal(read(root+'/'+name+'-command.json').exitCode,0,name);
assert.equal(read(root+'/build-command.json').exitCode,0);for(const[file,digest]of Object.entries(read(root+'/build-command.json').compiledEntries))assert.equal(hash(file),digest);
for(const[name,args]of [['docs-build',['scripts/build-docs.mjs']],['docs-check',['scripts/check-docs.mjs']],['api-spec',['--import','tsx','scripts/export-openapi.ts']]]){
 const file=path.join(root,name),fd=fs.openSync(file+'.log','wx');
 const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});
 const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 fs.closeSync(fd);
 fs.writeFileSync(file+'-command.json',JSON.stringify({command:[process.execPath,...args],exitCode},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({name,exitCode}));assert.equal(exitCode,0,name);
}
fs.writeFileSync(root+'/result.json',JSON.stringify({result:'PASS',checks:['build','typecheck','lint','docs-build','docs-check','api-spec'],backendReport:base+'/backend-final.json',compiledReport:base+'/compiled-final/proof.json'},null,2)+'\n',{flag:'wx'});
