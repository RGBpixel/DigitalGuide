import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T24/writing-calendar',file=root+'/verification.json',output=root+'/final-audit.json',manifest=JSON.parse(fs.readFileSync(file,'utf8')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert.ok(!fs.existsSync(output));assert.equal(manifest.result,'PASS_LOCAL_CALENDAR_WORKFLOW_WITH_KNOWN_QUALITY_LIMITS');let entries=0;
for(const map of [manifest.sourceSHA256,manifest.evidenceSHA256,manifest.earlierFinalManifestSHA256,manifest.compiled.entrySHA256])for(const[f,expected]of Object.entries(map)){assert.equal(hash(f),expected,f);entries++;}
for(const b of [...manifest.compiled.webBundles,...manifest.currentBuiltBrowser.bundles]){assert.equal(hash(b.file),b.sha256);entries++;}
for(const m of manifest.models.files){const digest=createHash('sha256');for await(const bytes of fs.createReadStream(m.file))digest.update(bytes);assert.equal(digest.digest('hex'),m.sha256);entries++;}
assert.equal(manifest.quality.generalFactualQualityVerified,false);assert.equal(manifest.wholeTaskOrPlatformCompleted,false);
fs.writeFileSync(output,JSON.stringify({result:'PASS',checkedAt:new Date().toISOString(),manifestSHA256:hash(file),entriesChecked:entries,sourceFiles:Object.keys(manifest.sourceSHA256).length,evidenceFiles:Object.keys(manifest.evidenceSHA256).length,earlierManifests:Object.keys(manifest.earlierFinalManifestSHA256).length,originalFailuresAndKnownModelLimitationsRetained:true,filesRewritten:false,goalOrWholePlatformCompleted:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'PASS',entriesChecked:entries,manifestSHA256:hash(file)}));
