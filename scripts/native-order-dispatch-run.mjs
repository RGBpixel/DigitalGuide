import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const label=process.argv[2];assert.match(label,/^[a-z][a-z0-9-]+$/);const root='docs/evidence/T20/postgres-orders/dispatch',read=file=>JSON.parse(fs.readFileSync(file,'utf8')),hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const source=read(root+'/dispatch-proof-build-command.json'),bindings=source.bindings;for(const b of bindings)assert.equal(hash(b.file),b.sha256,b.file);const built=Object.fromEntries(fs.readdirSync('dist',{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const file=path.join(e.parentPath,e.name).replaceAll('\\','/');return[file,hash(file)];}));assert.equal(Object.keys(built).length,76);
const fd=fs.openSync(root+'/'+label+'.log','wx'),args=['--import','tsx','scripts/native-order-dispatch-proof.ts',label],startedAt=new Date().toISOString(),child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]}),exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});fs.closeSync(fd);fs.writeFileSync(root+'/'+label+'-command.json',JSON.stringify({result:exitCode===0?'PASS':'FAIL',startedAt,finishedAt:new Date().toISOString(),exitCode,command:[process.execPath,...args],bindings,built},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({label,exitCode,result:exitCode===0?'PASS':'FAIL'}));process.exitCode=exitCode;
