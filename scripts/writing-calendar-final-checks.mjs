import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='docs/evidence/T24/writing-calendar',folder=root+'/checks-final';
fs.mkdirSync(folder,{recursive:true});assert.ok(!fs.existsSync(folder+'/commands.json'));
const scripts=['writing-calendar-start','writing-calendar-process-audit','writing-calendar-readiness','writing-calendar-preservation','writing-calendar-final-checks','writing-calendar-evidence','writing-calendar-final-audit'];
const steps=[['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['lint',['node_modules/eslint/bin/eslint.js','apps','packages','tests','scripts/*.ts']],...scripts.map(s=>['syntax-'+s,['--check','scripts/'+s+'.mjs']]),['api-spec',['--import','tsx','scripts/export-openapi.ts']],['docs-build',['scripts/build-docs.mjs']],['documentation',['scripts/check-docs.mjs']]],commands=[];
for(const[name,args]of steps){
  const log=folder+'/'+name+'.log',fd=fs.openSync(log,'wx'),startedAt=new Date().toISOString(),child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});
  const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});fs.closeSync(fd);
  commands.push({name,command:['node',...args].join(' '),startedAt,endedAt:new Date().toISOString(),exitCode,log});console.log(JSON.stringify({name,exitCode}));if(exitCode!==0)break;
}
const proof=JSON.parse(fs.readFileSync(root+'/compiled-fixed/proof.json','utf8')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');assert.equal(proof.result,'PASS');
for(const[file,expected]of Object.entries(proof.entrySHA256))assert.equal(hash(file),expected,file);
for(const bundle of proof.observations.find(o=>o.kind==='built_browser').bundles)assert.equal(hash(bundle.file),bundle.sha256);
const passed=commands.length===steps.length&&commands.every(c=>c.exitCode===0);
if(passed)fs.copyFileSync(folder+'/documentation.log',folder+'/documentation.json',fs.constants.COPYFILE_EXCL);
fs.writeFileSync(folder+'/commands.json',JSON.stringify({result:passed?'PASS':'FAIL',commands,currentBackendAndHelperArtifactsMatchCompiledProof:true,currentWebBundlesMatchCompiledBrowser:true,applicationBuildLog:root+'/build-union-fixed.log',fullBackendSuiteRerun:false},null,2)+'\n',{flag:'wx'});
assert.ok(passed,'Inspect preserved command logs.');
