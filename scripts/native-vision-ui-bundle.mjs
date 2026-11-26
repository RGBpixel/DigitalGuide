import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const label=process.argv[2],priorFile=process.argv[3];assert.match(label,/^[a-z][a-z0-9-]+$/);
const prior=JSON.parse(fs.readFileSync(priorFile,'utf8'));assert.equal(prior.allDirectChildrenClosed,true);
const root=path.resolve(prior.root),base=path.resolve('storage/postgres-native-tests')+path.sep;assert.ok(root.startsWith(base));
const target=path.join(root,'compiled-only-root-'+label);assert.equal(fs.existsSync(target),false);
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const acceptanceFile=process.argv[4],acceptance=acceptanceFile?JSON.parse(fs.readFileSync(acceptanceFile,'utf8')):null;
const allowedBackendChanges=acceptance?['dist/api.mjs','dist/worker.mjs']:[];
if(acceptance){assert.equal(acceptance.result,'PASS');assert.equal(acceptance.allowDefaultLocalMockEntry,true);assert.equal(acceptance.distinctPassedFlowCount,11);for(const[file,sha]of Object.entries(acceptance.acceptedSourceSHA256))if((file.startsWith('apps/')||file.startsWith('packages/')||file.startsWith('migrations/'))&&file!=='packages/postgres/src/native-vision-ui-state.ts')assert.equal(hash(file),sha,file);assert.match(fs.readFileSync('packages/postgres/src/native-vision-ui-state.ts','utf8'),/nativeVisionUiVerified:boolean=true/);}
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const f=path.join(dir,e.name);assert.equal(fs.lstatSync(f).isSymbolicLink(),false);return e.isDirectory()?walk(f):[f];});
for(const[file,sha]of Object.entries(prior.entrySHA256)){assert.equal(hash(path.join(prior.compiledOnlyRoot,file)),sha);if(!allowedBackendChanges.includes(file))assert.equal(hash(file),sha);}
fs.mkdirSync(target);fs.cpSync('dist',path.join(target,'dist'),{recursive:true,force:false,errorOnExist:true});
for(const name of ['migrations','scripts'])fs.cpSync(path.join(prior.compiledOnlyRoot,name),path.join(target,name),{recursive:true,force:false,errorOnExist:true});
for(const tool of prior.linkedTools){const from=path.join(prior.compiledOnlyRoot,'storage/tools',tool.file),to=path.join(target,'storage/tools',tool.file);assert.equal(fs.statSync(from).size,tool.size);fs.mkdirSync(path.dirname(to),{recursive:true});fs.linkSync(from,to);}
const manifest=dir=>Object.fromEntries(walk(path.join(dir,'dist')).map(f=>[path.relative(dir,f).replaceAll('\\','/'),hash(f)]));
const old=manifest(prior.compiledOnlyRoot),current=manifest(target);assert.equal(Object.keys(old).length,Object.keys(current).length);
for(const[file,sha]of Object.entries(old))if(!file.startsWith('dist/web/')&&!allowedBackendChanges.includes(file))assert.equal(current[file],sha);
const backendChanges=Object.keys(old).filter(file=>!file.startsWith('dist/web/')&&old[file]!==current[file]);if(acceptance)assert.deepEqual(backendChanges.sort(),allowedBackendChanges.toSorted());
const output='docs/evidence/T20/postgres-vision/'+label+'-bundle.json',report={result:'PASS',createdAt:new Date().toISOString(),root,sourceProof:priorFile,sourceProofSHA256:hash(priorFile),oldCompiledOnlyRoot:prior.compiledOnlyRoot,newCompiledOnlyRoot:target,oldDist:old,currentDist:current,backendUnchanged:backendChanges.length===0,backendChanges,acceptedLocalMockEntry:acceptanceFile??null,sourceFrontend:'dist/web',linkedTools:prior.linkedTools.length,modelBytesCopied:false,oldBundleOverwritten:false,mainRestarted:false};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const entrySHA256=Object.fromEntries(Object.keys(prior.entrySHA256).map(file=>[file,current[file]]));
const input='docs/evidence/T20/postgres-vision/'+label+'-resume-input.json';fs.writeFileSync(input,JSON.stringify({...prior,result:'SOURCE_BOUND_CONTINUATION_INPUT',compiledOnlyRoot:target,entrySHA256,frontendBundleReport:output,originalProof:priorFile},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PASS',bundleFiles:Object.keys(current).length,backendUnchanged:backendChanges.length===0,backendChanges,resumeInput:input}));
