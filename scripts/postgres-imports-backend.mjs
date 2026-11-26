import fs from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const base='docs/evidence/T20/postgres-imports',label=process.argv[2]??'backend-full',old=JSON.parse(fs.readFileSync('docs/evidence/T20/postgres-video/backend-final.json','utf8'));
const files=[...new Set([...old.testResults.map(s=>s.name),...['tests/integration/postgres-imports.test.ts','tests/integration/studio-document-import.test.ts']])];
const args=['node_modules/vitest/vitest.mjs','run',...files,'--reporter=default','--reporter=json','--outputFile='+base+'/'+label+'.json'];assert.ok(!fs.existsSync(base+'/'+label+'.json'));const fd=fs.openSync(base+'/'+label+'.log','wx'),startedAt=new Date().toISOString(),child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});
const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});fs.closeSync(fd);fs.writeFileSync(base+'/'+label+'-command.json',JSON.stringify({command:[process.execPath,...args],startedAt,finishedAt:new Date().toISOString(),exitCode},null,2)+'\n',{flag:'wx'});const result=JSON.parse(fs.readFileSync(base+'/'+label+'.json'));console.log(JSON.stringify({exitCode,passed:result.numPassedTests,failed:result.numFailedTests,files:result.testResults.length}));process.exitCode=exitCode;
