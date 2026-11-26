import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-hospitality/conversation-ui',file=root+'/check-runner.mjs';
const source=fs.readFileSync('docs/evidence/T20/postgres-hospitality/conversation/check-runner.mjs','utf8').replace("const root='docs/evidence/T20/postgres-hospitality/conversation'","const root='docs/evidence/T20/postgres-hospitality/conversation-ui'");
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
