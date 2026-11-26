import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root='docs/evidence/T20/postgres-processing',out=root+'/compiled-diffs',backup=JSON.parse(fs.readFileSync(root+'/runtime/backup-before.json','utf8')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');fs.mkdirSync(out,{recursive:false});const entries=[],unchanged=[];
for(const[file,sha]of Object.entries(backup.compiled)){const old=path.join(path.dirname(backup.file),'dist-before',file.slice(5));assert.equal(hash(old),sha);const current=hash(file);if(current===sha){unchanged.push(file);continue;}const diff=out+'/'+file.slice(5).replaceAll('/','__')+'.diff',r=spawnSync('C:/Program Files/Git/cmd/git.exe',['diff','--no-index','--text','--unified=3',old,path.resolve(file)],{windowsHide:true,encoding:'utf8',maxBuffer:32*1024*1024});assert.ok(r.status===1||r.status===0,r.stderr);fs.writeFileSync(diff,r.stdout,{flag:'wx'});entries.push({file,oldSHA256:sha,currentSHA256:current,diff,diffSHA256:hash(diff)});}
fs.writeFileSync(out+'/inventory.json',JSON.stringify({result:'PASS',entries,unchanged,unchangedFrontend:unchanged.filter(f=>f.startsWith('dist/web/')).length},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'PASS',changed:entries.map(e=>e.file),unchanged:unchanged.length,frontend:unchanged.filter(f=>f.startsWith('dist/web/')).length}));
