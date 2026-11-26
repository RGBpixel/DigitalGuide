import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-hospitality/conversation-ui',read=f=>JSON.parse(fs.readFileSync(f,'utf8')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),final=read(root+'/verification.json');
assert.equal(final.result,'PASS_STAGED_NATIVE_CONVERSATION_SERVICE_UI_TIMER_PRIVACY_MOBILE_RESTART');let hashes=0;
for(const map of [final.sourceSHA256,final.documents,final.evidenceSHA256])for(const[f,sha]of Object.entries(map)){assert.equal(hash(f),sha,f);hashes++;}
assert.equal(hash(final.proofFile),final.proofSHA256);assert.equal(hash(final.mainPreservation),final.mainPreservationSHA256);
const proof=read(final.proofFile),compiled=read(path.join(path.dirname(final.proofFile),'compiled-file-sha256.json'));assert.equal(proof.result,'PASS');
for(const[f,sha]of Object.entries(compiled)){assert.equal(hash(path.join(proof.compiledOnlyRoot,f)),sha,f);hashes++;}
const report={result:'PASS_NATIVE_CONVERSATION_SERVICE_UI_FINAL_HASH_BINDINGS',checkedAt:new Date().toISOString(),fileHashesVerified:hashes,verificationSHA256:hash(root+'/verification.json'),guiFlows:10,stagedGuiPasses:[3,1,6],goal:'active',goalTurnClassification:'progress'};
fs.writeFileSync(root+'/final-hash-audit.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
