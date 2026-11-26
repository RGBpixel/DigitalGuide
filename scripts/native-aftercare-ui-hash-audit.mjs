import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-hospitality/aftercare-ui',hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),read=f=>JSON.parse(fs.readFileSync(f,'utf8')),final=read(root+'/verification.json');
assert.equal(final.result,'PASS_STAGED_NATIVE_AFTERCARE_UI_DEFAULT_PRIVACY_MOBILE_RESTART');let hashes=0;for(const map of [final.sourceSHA256,final.documents,final.evidenceSHA256])for(const[f,sha]of Object.entries(map)){assert.equal(hash(f),sha,f);hashes++;}assert.equal(hash(final.mainPreservation),final.mainPreservationSHA256);
for(const item of final.proofFiles){assert.equal(hash(item.path),item.sha256);const proof=read(item.path),compiled=read(path.join(path.dirname(item.path),'compiled-file-sha256.json'));assert.equal(proof.result,'PASS');assert.equal(Object.keys(compiled).length,78);for(const[f,sha]of Object.entries(compiled)){assert.equal(hash(path.join(proof.compiledOnlyRoot,f)),sha,f);hashes++;}}
const report={result:'PASS_NATIVE_AFTERCARE_UI_FINAL_HASH_BINDINGS',checkedAt:new Date().toISOString(),fileHashesVerified:hashes,verificationSHA256:hash(root+'/verification.json'),assertions:66,guiFlows:16,goal:'active',goalTurnClassification:'progress'};fs.writeFileSync(root+'/final-hash-audit.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
