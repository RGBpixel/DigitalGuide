import fs from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-imports/checks-final';fs.mkdirSync(root,{recursive:true});
for(const[name,args]of [['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['lint',['node_modules/eslint/bin/eslint.js','apps','packages','tests','scripts/*.ts']],['build',['scripts/build.mjs']]]){
 const file=root+'/'+name,fd=fs.openSync(file+'.log','wx'),startedAt=new Date().toISOString(),child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});fs.closeSync(fd);const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');fs.writeFileSync(file+'-command.json',JSON.stringify({command:[process.execPath,...args],startedAt,finishedAt:new Date().toISOString(),exitCode,...(name==='build'&&exitCode===0?{compiledEntries:Object.fromEntries(['dist/api.mjs','dist/worker.mjs','dist/postgres-runtime.mjs','dist/video-inspect.mjs','dist/document-import.mjs'].map(f=>[f,hash(f)]))}:{})},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({name,exitCode}));assert.equal(exitCode,0,name);
}
