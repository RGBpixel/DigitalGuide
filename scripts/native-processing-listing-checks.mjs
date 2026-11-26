import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const root='docs/evidence/T20/postgres-media-processing',label=process.argv[2],before=process.argv.includes('--before');assert.match(label,/^listing-[a-z-]+$/);
const files=['packages/postgres/src/runtime-assets.ts','packages/postgres/src/runtime-library.ts','apps/api/src/postgres-asset-routes.ts','tests/integration/postgres-processing.test.ts'],sourceSHA256=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const args=['node_modules/vitest/vitest.mjs','run','tests/integration/postgres-processing.test.ts',...(before?['-t','撤回派生来源后列表|失效素材元数据分页']:['tests/integration/postgres-assets.test.ts','tests/integration/postgres-library.test.ts']), '--reporter=json','--outputFile='+root+'/'+label+'.json'];
const fd=fs.openSync(root+'/'+label+'.log','wx'),startedAt=new Date().toISOString(),child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]}),exitCode=await new Promise((r,j)=>{child.once('error',j);child.once('close',r);});fs.closeSync(fd);fs.writeFileSync(root+'/'+label+'-command.json',JSON.stringify({result:exitCode===0?'PASS':'FAIL',startedAt,finishedAt:new Date().toISOString(),command:[process.execPath,...args],exitCode,sourceSHA256},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({label,exitCode}));process.exitCode=exitCode;
