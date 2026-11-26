import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-live-return',read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const manifest=root+'/verification.json',v=read(manifest),audit=read(root+'/final-audit.json');
assert.equal(v.result,'PASS');assert.equal(audit.result,'PASS');assert.equal(hash(manifest),audit.manifestSHA256);
const checked=new Map();for(const name of ['sourceSHA256','compiledSHA256','evidenceSHA256','referencedHistoricalEvidenceSHA256','earlierFinalManifestSHA256'])for(const [file,sha] of Object.entries(v[name])){if(checked.has(file))assert.equal(checked.get(file),sha,file);else{assert.equal(hash(file),sha,file);checked.set(file,sha);}}
assert.equal(v.goalStatus,'active');assert.equal(v.goalComplete,false);assert.equal(v.wholeT20Completed,false);assert.equal(v.wholeG2Completed,false);assert.equal(v.wholePlatformCompleted,false);
const result={result:'PASS',checkedAt:new Date().toISOString(),manifest,manifestSHA256:hash(manifest),independentlyRehashedDistinctFiles:checked.size,earlierFinals:Object.keys(v.earlierFinalManifestSHA256).length,sourceCompiledCurrentAndHistoricalEvidenceChecked:true,frozenManifestNotModified:true,goalStatus:'active'};
fs.writeFileSync(root+'/read-only-audit.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
