import fs from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base='docs/evidence/T20/postgres-presentations',root=base+'/checks-final',read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const proof=read(base+'/compiled-summary.json');assert.equal(proof.result,'PASS');
for(const[f,sha]of Object.entries(proof.entrySHA256))assert.equal(hash(f),sha,f);for(const[n,sha]of Object.entries(proof.compiledRendererSHA256))assert.equal(hash('dist/'+n),sha,n);
for(const n of ['typecheck','lint','build'])assert.equal(read(root+'/'+n+'-command.json').exitCode,0,n);for(const[f,sha]of Object.entries(read(root+'/build-command.json').compiledEntries))assert.equal(hash(f),sha,f);
for(const[name,args]of [['typecheck-complete',['node_modules/typescript/bin/tsc','--noEmit']],['lint-finished',['node_modules/eslint/bin/eslint.js','apps','packages','tests','scripts/*.ts']],['docs-build',['scripts/build-docs.mjs']],['docs-check',['scripts/check-docs.mjs']],['api-spec',['--import','tsx','scripts/export-openapi.ts']]]){
 const file=root+'/'+name,fd=fs.openSync(file+'.log','wx'),startedAt=new Date().toISOString(),c=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});const exitCode=await new Promise((resolve,reject)=>{c.once('error',reject);c.once('close',resolve);});fs.closeSync(fd);fs.writeFileSync(file+'-command.json',JSON.stringify({command:[process.execPath,...args],startedAt,finishedAt:new Date().toISOString(),exitCode},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({name,exitCode}));assert.equal(exitCode,0,name);
}
fs.writeFileSync(root+'/result.json',JSON.stringify({result:'PASS',checks:['build','typecheck','lint','typecheck-complete','lint-finished','docs-build','docs-check','api-spec'],backendFullReport:base+'/backend-full.json',finalNativeReport:base+'/backend-native-final.json',compiledReport:base+'/compiled-summary.json'},null,2)+'\n',{flag:'wx'});
