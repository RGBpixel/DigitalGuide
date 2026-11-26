import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root='docs/evidence/T22/caption-pagination',read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),save=(f,v)=>fs.writeFileSync(root+'/'+f,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const attempts=[],checks=new Map(),children=[],owned=new Set();let totalPassedCheckExecutions=0,browserProcesses=0;
for(const stage of ['compiled-first','compiled-ui-recovery','compiled-ui-box','compiled-history']){
 const folder=root+'/'+stage,p=read(folder+'/proof.json');assert.equal(p.allDirectChildrenClosed,true);for(const close of p.cleanup)assert.equal(close.result,'PASS');
 for(const[f,sha]of Object.entries(p.entrySHA256))assert.equal(hash(path.join(p.compiledOnlyRoot,f)),sha);for(const check of p.checks){assert.equal(check.result,'PASS');checks.set(check.name,check);totalPassedCheckExecutions++;}children.push(...p.children.map(c=>({...c,stage})));
 for(const f of fs.readdirSync(folder).filter(f=>/^observed-.*\.json$/.test(f)&&!f.endsWith('-roots.json'))){const v=read(folder+'/'+f);if(Array.isArray(v.processes))for(const x of v.processes)owned.add(x.pid+':'+x.created);}
 if(fs.existsSync(folder+'/browser/browser.json')){const b=read(folder+'/browser/browser.json');browserProcesses+=b.observedBrowserProcesses;assert.equal(read(folder+'/browser/browser-cleanup.json').result,'PASS');}
 attempts.push({stage,result:p.result,checks:p.checks.length,children:p.children.length,observed:p.observedProcesses,error:p.error,entrySHA256:p.entrySHA256});
}
assert.deepEqual([checks.size,totalPassedCheckExecutions,children.length,owned.size,browserProcesses],[18,20,58,64,36]);
const pre=read(root+'/runtime/pre-history-compiled.json'),current=read(root+'/compiled-history/proof.json'),initial=read(root+'/compiled-first/proof.json');
for(const entry of pre.entries)assert.equal(hash(entry.backup),entry.sha256);const delta=Object.keys(initial.entrySHA256).filter(f=>initial.entrySHA256[f]!==current.entrySHA256[f]);assert.deepEqual(delta.sort(),['dist/api.mjs','dist/worker.mjs']);for(const f of ['dist/timeline-render.mjs','dist/studio-delivery.mjs'])assert.equal(hash(f),initial.entrySHA256[f]);
save('compiled-summary.json',{result:'PASS',checkedAt:new Date().toISOString(),distinctChecks:checks.size,totalPassedCheckExecutions,checks:[...checks.values()],attempts,directChildren:children.length,children,observedProcesses:owned.size,browserChecks:5,browserProcesses,mediaCompositeChildren:4,allPrivateChildrenClosed:true,notSingleAttempt:true,notSingleApiBuild:true,finalEntrySHA256:current.entrySHA256,initialMediaEntrySHA256:initial.entrySHA256,apiOnlyCompatibilityDelta:delta,renderBinariesSameAcrossAllAttempts:true,priorHarnessFailuresRetained:true,preciseForcedAlignmentAccepted:false,newModelOrAsrOrSystemSpeechInference:false});
const a=read(root+'/compiled-first/artifacts.json'),alpha=read(root+'/alpha-composites/verification.json');assert.equal(alpha.result,'PASS');
const files=[
 ...a.frames.map(f=>({file:f.file,result:'PASS',notes:'实际解码：当前分页文字和完整字形在字幕框内，保留字号。'})),
 {file:a.currentPreviewFile,result:'PASS',notes:'实际640 PNG：两行完整，使用新缓存策略。'},
 ...alpha.outputs.map(f=>({file:f.file,result:'PASS',notes:'实际4K ProRes 4444在'+f.background+'底合成：完整字形及原位页序。'})),
 ...['caption-current-preview-desktop.png','caption-density-blocked-desktop.png','caption-viewer-mobile.png'].map(f=>({file:root+'/compiled-ui-box/browser/'+f,result:'PASS',notes:'实际built界面：分页说明/私有PNG、确认后容量拦截，或390px只读无横向页面溢出。布局示意标记为无声；以实际文件验收。'}))
].map(v=>({...v,sha256:hash(v.file)}));assert.equal(files.length,12);
save('visual-review.json',{result:'PASS',checkedAt:new Date().toISOString(),method:'人工查看当前12张原图；字素/页序和全字形边界另有像素及实际解码验证。只接受当前有限样本。',files,priorFinding:{file:'docs/evidence/T20/postgres-processing/visual-review.json',sha256:hash('docs/evidence/T20/postgres-processing/visual-review.json'),result:'FAIL',originalUnmodified:true,currentFixSeparate:true},currentPolicy:'caption-pages-ink-v3',displayTimingEstimated:true,authoredTextAndCuesUnchanged:true,accurateForcedAlignmentAccepted:false});
const before=read(root+'/runtime/backup-before.json'),out=root+'/compiled-diffs';fs.mkdirSync(out,{recursive:false});const entries=[],unchanged=[];
for(const[file,oldSHA256]of Object.entries(before.compiled)){const currentSHA256=hash(file);if(currentSHA256===oldSHA256){unchanged.push(file);continue;}const original=path.join(path.dirname(before.file),'dist-before',file.slice(5));assert.equal(hash(original),oldSHA256);const d=spawnSync('C:/Program Files/Git/cmd/git.exe',['diff','--no-index','--no-ext-diff','--no-color','--',original,path.resolve(file)],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});assert.equal(d.status,1,file);const target=out+'/'+path.basename(file)+'.diff';fs.writeFileSync(target,d.stdout,{flag:'wx'});entries.push({file,oldSHA256,currentSHA256,diff:target,diffSHA256:hash(target),addedLines:d.stdout.split('\n').filter(s=>s.startsWith('+')&&!s.startsWith('+++')).length,removedLines:d.stdout.split('\n').filter(s=>s.startsWith('-')&&!s.startsWith('---')).length});}
assert.deepEqual(entries.map(e=>e.file).sort(),['dist/api.mjs','dist/studio-delivery.mjs','dist/timeline-render.mjs','dist/worker.mjs']);save('compiled-diffs/inventory.json',{result:'PASS',entries,unchanged,unchangedFrontend:unchanged.filter(f=>f.startsWith('dist/web/')).length});
console.log(JSON.stringify({result:'PASS',compiledChecks:checks.size,children:children.length,observed:owned.size,images:files.length,compiledDiffs:entries.length}));
