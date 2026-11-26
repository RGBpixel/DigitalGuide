import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='docs/evidence/T25/presentation-composition',folder=root+'/checks-completed';
const previous=JSON.parse(fs.readFileSync(root+'/checks-final/commands.json','utf8'));
assert.equal(previous.result,'FAIL');assert.equal(previous.commands.filter(c=>c.exitCode!==0).length,1);assert.equal(previous.commands.at(-1).name,'documentation');
fs.mkdirSync(folder,{recursive:true});assert.ok(!fs.existsSync(folder+'/commands.json'));
const commands=previous.commands.filter(c=>c.exitCode===0).map(c=>({...c,reusedFromEarlierSuccessfulRun:true}));
const steps=[...['evidence','final-audit','docs-check'].map(s=>['syntax-'+s,['--check','scripts/presentation-composition-'+s+'.mjs']]),['docs-build',['scripts/build-docs.mjs']],['documentation',['scripts/check-docs.mjs']]];
for(const[name,args]of steps){
 const log=folder+'/'+name+'.log',fd=fs.openSync(log,'wx'),startedAt=new Date().toISOString();
 const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});fs.closeSync(fd);
 commands.push({name,command:['node',...args].join(' '),startedAt,endedAt:new Date().toISOString(),exitCode,log});console.log(JSON.stringify({name,exitCode}));if(exitCode!==0)break;
}
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),proof=JSON.parse(fs.readFileSync(root+'/compiled-first/proof.json','utf8'));for(const[f,sha]of Object.entries(proof.entrySHA256))assert.equal(hash(f),sha,f);for(const b of proof.observations.find(o=>o.kind==='built_browser').bundles)assert.equal(hash(b.file),b.sha256,b.file);
const passed=commands.length===previous.commands.length-1+steps.length&&commands.every(c=>c.exitCode===0);
if(passed)fs.copyFileSync(folder+'/documentation.log',folder+'/documentation.json',fs.constants.COPYFILE_EXCL);
fs.writeFileSync(folder+'/commands.json',JSON.stringify({result:passed?'PASS':'FAIL',commands,previousFailedDocumentCheck:root+'/checks-final/commands.json',cause:'New documentation linked the final manifest before it existed. Links now target the already existing evidence folder; final manifest name remains documented.',documentValidatorRelaxed:false,applicationOrUnitOrBackendTestsRepeated:false,currentCompiledEntriesUnchanged:true,currentWebBundlesUnchanged:true,applicationBuildLog:root+'/build-final.log',fullBackendSuiteRerun:false},null,2)+'\n',{flag:'wx'});
assert.ok(passed);
