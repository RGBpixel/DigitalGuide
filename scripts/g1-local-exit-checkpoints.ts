import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileDigest} from '../packages/media/src/files.js';
const root='docs/evidence/G1/local-exit',start=JSON.parse(fs.readFileSync(root+'/start-source-audit.json','utf8'));
const previous=JSON.parse(fs.readFileSync(start.previousManifest,'utf8')),hash=(f:string)=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const output=process.argv[2]||root+'/runtime/checkpoints.json';assert.ok(!fs.existsSync(output));
for(const[f,sha]of Object.entries(start.oldStateFiles))assert.equal(hash(f),sha,f);
for(const[f,sha]of Object.entries(start.earlierFinalManifestSHA256))assert.equal(hash(f),sha,f);
for(const[f,sha]of Object.entries(previous.compiledSHA256))assert.equal(hash(f),sha,f);
for(const m of start.models as {file:string;sha256:string;bytes?:number;size?:number}[]){const d=await fileDigest(m.file);assert.equal(d.sha256,m.sha256,m.file);assert.equal(d.size,m.bytes??m.size,m.file);}
const preservedApplicationFiles=Object.entries(previous.sourceSHA256).filter(([f])=>/^(apps|packages|migrations)\//.test(f));
for(const[f,sha]of preservedApplicationFiles)assert.equal(hash(f),sha,f);
fs.writeFileSync(output,JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),oldStateFiles:Object.keys(start.oldStateFiles).length,earlierFinalManifests:Object.keys(start.earlierFinalManifestSHA256).length,modelsAndRuntimeFiles:start.models.length,currentCompiledFilesUnchanged:Object.keys(previous.compiledSHA256).length,applicationAndMigrationFilesUnchanged:preservedApplicationFiles.length,noApplicationRebuildNeeded:true,wholePlatformCompleted:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PASS',oldStates:Object.keys(start.oldStateFiles).length,models:start.models.length,compiledFiles:Object.keys(previous.compiledSHA256).length,applicationFiles:preservedApplicationFiles.length}));
