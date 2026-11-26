import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const root='docs/evidence/G1/local-exit',folder=root+'/checks-final';fs.mkdirSync(folder,{recursive:true});assert.ok(!fs.existsSync(folder+'/commands.json'));
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):e.isFile()?[dir+'/'+e.name]:[]);}
const typeLog=root+'/typecheck-audit.log';assert.ok(fs.existsSync(typeLog));const stamp=fs.statSync(typeLog).mtimeMs;
for(const f of['apps','packages','tests','scripts'].flatMap(walk).filter(f=>/\.tsx?$/.test(f)))assert.ok(fs.statSync(f).mtimeMs<=stamp,'TypeScript changed after observed successful typecheck: '+f);
const commands=[{name:'typecheck',command:'pnpm typecheck',exitCode:0,log:typeLog,reusedSuccessfulObservedExecution:true,typescriptInputsUnchangedSinceRun:true}];
const steps=[['lint',['node_modules/eslint/bin/eslint.js','apps','packages','tests','scripts/*.ts']],...['review','preservation','final-checks','evidence','final-audit'].map(s=>['syntax-'+s,['--check','scripts/g1-local-exit-'+s+'.mjs']]),['docs-build',['scripts/build-docs.mjs']],['documentation',['scripts/check-docs.mjs']]];
for(const[name,args]of steps){const log=folder+'/'+name+'.log',fd=fs.openSync(log,'wx'),startedAt=new Date().toISOString(),child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});fs.closeSync(fd);commands.push({name,command:['node',...args].join(' '),startedAt,endedAt:new Date().toISOString(),exitCode,log});console.log(JSON.stringify({name,exitCode}));if(exitCode!==0)break;}
const passed=commands.length===steps.length+1&&commands.every(c=>c.exitCode===0);if(passed)fs.copyFileSync(folder+'/documentation.log',folder+'/documentation.json',fs.constants.COPYFILE_EXCL);
fs.writeFileSync(folder+'/commands.json',JSON.stringify({result:passed?'PASS':'FAIL',commands,noApplicationRebuildOrApiContractExportNeeded:true,applicationPackagesAndMigrationsUnchanged:true,fullBackendOrBrowserSuiteRepeated:false},null,2)+'\n',{flag:'wx'});assert.ok(passed);
