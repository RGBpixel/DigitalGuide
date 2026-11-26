import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const base='docs/evidence/T20/postgres-content',root=base+'/checks-final',read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),proof=read(base+'/compiled-summary-current.json');
assert.equal(proof.result,'PASS');
fs.mkdirSync(root,{recursive:false});
const expected={...proof.entrySHA256,...Object.fromEntries(Object.entries(proof.compiledRendererSHA256??{}).map(([f,s])=>['dist/'+f,s]))};
for(const[f,sha]of Object.entries(expected))assert.equal(hash(f),sha,f);
const checks=[['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['lint',['node_modules/eslint/bin/eslint.js','apps','packages','tests','scripts/*.ts']],['build',['scripts/build.mjs']],['docs-build',['scripts/build-docs.mjs']],['docs-check',['scripts/check-docs.mjs']],['api-spec',['--import','tsx','scripts/export-openapi.ts']]];
for(const[name,args]of checks){
 const file=root+'/'+name,fd=fs.openSync(file+'.log','wx'),startedAt=new Date().toISOString(),child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});
 const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});fs.closeSync(fd);
 fs.writeFileSync(file+'-command.json',JSON.stringify({command:[process.execPath,...args],startedAt,finishedAt:new Date().toISOString(),exitCode,...(name==='build'&&exitCode===0?{compiledEntries:Object.fromEntries(Object.keys(expected).map(f=>[f,hash(f)]))}:{})},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({name,exitCode}));assert.equal(exitCode,0,name);
 if(name==='build')for(const[f,sha]of Object.entries(expected))assert.equal(hash(f),sha,'Build differs from actual current compiled proof: '+f);
}
fs.writeFileSync(root+'/result.json',JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),checks:checks.map(c=>c[0]),actualBuiltRuntimeMatchesCurrentCompiledProof:true,backendCoverageReport:base+'/backend-summary.json',compiledReport:base+'/compiled-summary-current.json',fullPlatformComplete:false},null,2)+'\n',{flag:'wx'});
