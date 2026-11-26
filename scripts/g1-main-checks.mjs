import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const stage=process.argv[2],handle=process.env.PREVIEW_SESSION_HANDLE,folder='docs/evidence/T16/g1/runtime/'+stage;
assert.ok(['main-initial','main-restarted'].includes(stage)&&handle);
fs.mkdirSync(folder,{recursive:true});assert.ok(!fs.existsSync(folder+'/checks.json'));
const steps=[['readiness','g1-acceptance-readiness.mjs',[folder+'/readiness.json'],{}],
 ['practice-runtime','practice-preview.ts',['--verify-only'],{PRACTICE_EVIDENCE_DIR:folder+'/practice-runtime'}],
 ['practice-dev','practice-preview-browser.ts',[],{PRACTICE_BROWSER_DIR:folder+'/practice-dev'}]];
if(stage==='main-restarted')steps.push(
 ['legacy20','presentation-answers-legacy.mjs',[folder+'/legacy20'],{}],
 ['practice-built','practice-preview-browser.ts',['--built'],{PRACTICE_BROWSER_DIR:folder+'/practice-built'}],
 ['ppt-v1-runtime','presentation-answers-preview.ts',['--verify-only'],{PRESENTATION_ANSWERS_EVIDENCE_DIR:folder+'/ppt-v1-runtime'}],
 ['ppt-v1-dev','presentation-answers-browser.ts',[],{PRESENTATION_ANSWERS_BROWSER_DIR:folder+'/ppt-v1-dev'}],
 ['ppt-v2-runtime','presentation-composition-preview.ts',['--verify-only'],{PRESENTATION_COMPOSITION_EVIDENCE_DIR:folder+'/ppt-v2-runtime'}],
 ['ppt-v2-built','presentation-composition-browser.ts',['--built'],{PRESENTATION_COMPOSITION_BROWSER_DIR:folder+'/ppt-v2-built'}],
 ['guest-built','live-guest-programme-preview-browser.ts',['--built'],{PROGRAMME_EVIDENCE_DIR:folder+'/guest-built'}],
 ['ae-built','ae-media-preview-browser.ts',['--built'],{AE_MEDIA_EVIDENCE_DIR:folder+'/ae-built'}]);
const results=[];
for(const[name,script,args,extra]of steps){assert.ok(fs.existsSync('scripts/'+script));const target=path.join(folder,name);fs.mkdirSync(target,{recursive:true});const fd=fs.openSync(target+'/command.log','wx'),child=spawn(process.execPath,['--import','tsx','scripts/'+script,...args],{env:{...process.env,PREVIEW_SESSION:handle,PREVIEW_SCHEMA_MIGRATION:'052-practice.sql',...extra},windowsHide:true,stdio:['ignore',fd,fd]});const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});fs.closeSync(fd);results.push({name,script,args,exitCode});console.log(JSON.stringify({name,exitCode}));if(exitCode!==0)break;}
const result=results.length===steps.length&&results.every(r=>r.exitCode===0)?'PASS':'FAIL';fs.writeFileSync(folder+'/checks.json',JSON.stringify({result,checkedAt:new Date().toISOString(),previewSession:handle,steps:results,scope:'Read-only existing main demonstrations; authentication creation is the only allowed write. No replacement demonstrations.',businessActionsOrCapture:false},null,2)+'\n',{flag:'wx'});assert.equal(result,'PASS');
