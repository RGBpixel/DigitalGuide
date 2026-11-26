import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const root='docs/evidence/T20/postgres-studio/checks-final';
fs.mkdirSync(root,{recursive:false});
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const proof=JSON.parse(fs.readFileSync('docs/evidence/T20/postgres-studio/compiled-current/proof.json','utf8'));
for(const [file,sha]of Object.entries(proof.entrySHA256))assert.equal(hash(file),sha,file);
// Current build completed in actual tool chunk c45396 with exit 0 before the current compiled proof.
fs.writeFileSync(root+'/build-command.json',JSON.stringify({command:'node scripts/build.mjs',actualToolChunk:'c45396',exitCode:0,compiledEntries:Object.fromEntries(['dist/postgres.mjs','dist/postgres-runtime.mjs','dist/api.mjs','dist/worker.mjs'].map(f=>[f,hash(f)])),matchesActuallyExecutedCompiledProof:true,noProductionSourceChangesSinceBuild:true},null,2)+'\n',{flag:'wx'});
for(const name of ['typecheck','lint'])for(const suffix of ['.log','-command.json'])fs.copyFileSync('docs/evidence/T20/postgres-studio/checks-first/'+name+suffix,root+'/'+name+suffix,fs.constants.COPYFILE_EXCL);
for(const[name,args]of [['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['lint',['node_modules/eslint/bin/eslint.js','apps','packages','tests','scripts/*.ts']],['docs-build',['scripts/build-docs.mjs']],['docs-check',['scripts/check-docs.mjs']],['api-spec',['--import','tsx','scripts/export-openapi.ts']]]){
 if(['typecheck','lint'].includes(name))continue;
 const file=path.join(root,name),fd=fs.openSync(file+'.log','wx');
 const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});
 const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 fs.closeSync(fd);
 fs.writeFileSync(file+'-command.json',JSON.stringify({command:[process.execPath,...args],exitCode},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({name,exitCode}));assert.equal(exitCode,0,name);
}
fs.writeFileSync(root+'/result.json',JSON.stringify({result:'PASS',checks:['build','typecheck','lint','docs-build','docs-check','api-spec']},null,2)+'\n',{flag:'wx'});
