import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fixtureIds as f} from '../packages/test-fixtures/src/seed.js';
const base='http://127.0.0.1:4301/api/v1',origin='http://127.0.0.1:5174',previous=JSON.parse(fs.readFileSync('storage/writing-review-preview-state.json','utf8'));
const response=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({accountId:f.adminA})});assert.equal(response.status,200);const cookie=response.headers.getSetCookie()[0].split(';')[0];
async function get(url:string){const response=await fetch(base+url,{headers:{cookie}});assert.equal(response.status,200);return(await response.json()).data;}
const cap=await get('/studio/content/writing/capabilities?workspaceId='+f.workspaceA),old=await get('/studio/content/writing/jobs/'+previous.ids.job);
assert.equal(cap.available,true);assert.equal(cap.engine.policy,'source-script-reviewed-v3');assert.equal(cap.engine.guardPolicy,'explicit-constraints-v2');assert.deepEqual(old,previous.stable.job);
fs.writeFileSync('docs/evidence/T24/writing-calendar/runtime/default-after-restart.json',JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),previewSession:process.env.PREVIEW_SESSION_HANDLE,policy:cap.engine.policy,guardPolicy:cap.engine.guardPolicy,engineHash:cap.engineHash,originalV2JobId:old.id,originalV2JobAndEvidenceUnchanged:true,scope:'Read-only protected capabilities and original v2 job immediately after the first restart; no model generation or business write in this check.',realExternalActions:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PASS',policy:cap.engine.policy,originalV2JobUnchanged:true}));
