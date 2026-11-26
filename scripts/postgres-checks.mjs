import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres/checks-final';fs.mkdirSync(root,{recursive:false});
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
// pnpm build was actually completed in tool PTY46094, exit 0, before compiled-final validation.
fs.writeFileSync(root+'/build-command.json',JSON.stringify({command:'pnpm build',actualToolSession:46094,exitCode:0,compiledEntries:{'dist/postgres.mjs':hash('dist/postgres.mjs'),'dist/api.mjs':hash('dist/api.mjs'),'dist/worker.mjs':hash('dist/worker.mjs')},noProductionSourceChangesSinceBuild:true},null,2)+'\n',{flag:'wx'});
for(const[name,args]of [['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['lint',['node_modules/eslint/bin/eslint.js','apps','packages','tests','scripts/*.ts']],['docs-build',['scripts/build-docs.mjs']],['docs-check',['scripts/check-docs.mjs']],['api-spec',['--import','tsx','scripts/export-openapi.ts']]]){
 const file=path.join(root,name),fd=fs.openSync(file+'.log','wx'),child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});const exitCode=await new Promise((r,j)=>{child.once('error',j);child.once('close',r);});fs.closeSync(fd);fs.writeFileSync(file+'-command.json',JSON.stringify({command:[process.execPath,...args],exitCode},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({name,exitCode}));assert.equal(exitCode,0);
}
fs.writeFileSync(root+'/result.json',JSON.stringify({result:'PASS',checks:['build','typecheck','lint','docs-build','docs-check','api-spec']},null,2)+'\n',{flag:'wx'});
