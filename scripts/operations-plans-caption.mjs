import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
const root='docs/evidence/T35/plan-entitlements',mode=process.argv[2],file='apps/web/src/operations/OperationsPage.tsx',hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
assert.ok(['source','bind'].includes(mode));
if(mode==='source'){
 const before=fs.readFileSync(file,'utf8'),from='套餐权益、购买席位与正式计费尚未接入；这里展示当前已配置的核心任务上限。',to='正式套餐权益、购买席位与计费尚未接入；此处为组织安全上限，沙箱套餐可能另有限制。';assert.equal(before.split(from).length,2);
 const snapshot=(contents)=>{const sha=createHash('sha256').update(contents).digest('hex'),target=root+'/sources/'+sha+'/'+path.basename(file);fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target))fs.writeFileSync(target,contents,{flag:'wx'});return{sha256:sha,snapshot:target};};
 const prior=snapshot(before),after=before.replace(from,()=>to);fs.writeFileSync(file,after);const current=snapshot(after);
 fs.writeFileSync(root+'/caption-only-source-delta.json',JSON.stringify({result:'PASS_WORDING_ONLY_SOURCE_DELTA',file,before:prior,after:current,from,to,onlyChangeAsserted:before.replace(from,()=>to)===after,enterprisePageSourceSHA256:hash('apps/web/src/operations/EnterprisePlansPage.tsx'),originalCompiledProofSHA256:hash(root+'/plans-compiled/proof.json'),newBusinessOrGuiRunsClaimed:false},null,2)+'\n',{flag:'wx'});
}else{
 const delta=read(root+'/caption-only-source-delta.json');assert.equal(hash(file),delta.after.sha256);assert.equal(hash('apps/web/src/operations/EnterprisePlansPage.tsx'),delta.enterprisePageSourceSHA256);assert.equal(hash(root+'/plans-compiled/proof.json'),delta.originalCompiledProofSHA256);
 const old=read(root+'/plans-compiled/compiled-file-sha256.json');for(const[f,sha]of Object.entries(old))if(!f.startsWith('dist/web/'))assert.equal(hash(f),sha,f);
 const frozen=path.resolve('storage/enterprise-builds/plans-final-'+randomUUID());fs.mkdirSync(frozen,{recursive:true});fs.cpSync('dist',path.join(frozen,'dist'),{recursive:true,errorOnExist:true,force:false});
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]),manifest={};for(const f of walk('dist')){const key=f.replaceAll('\\','/');manifest[key]=hash(f);assert.equal(hash(path.join(frozen,key)),manifest[key]);}
 fs.writeFileSync(root+'/current-build-file-sha256.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});fs.writeFileSync(root+'/caption-only-build-binding.json',JSON.stringify({result:'PASS_CAPTION_ONLY_BUILD_BINDING',compiledOnlyRoot:frozen,compiledFiles:Object.keys(manifest).length,originalExecutedRoot:read(root+'/plans-compiled/proof.json').compiledOnlyRoot,originalCompiledProofSHA256:delta.originalCompiledProofSHA256,onlyApplicationSourceDelta:delta,backendCompiledEntriesUnchanged:true,currentBuildExecuted:false,currentGuiRunsClaimed:0,currentRootContainsNativeDatabase:false},null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({result:'PASS',mode,wordingOnly:true,newBusinessOrGuiRunsClaimed:false}));
