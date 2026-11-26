import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-proactive-ui',file=root+'/check-runner.mjs';
let source=fs.readFileSync('docs/evidence/T20/postgres-proactive/check-runner.mjs','utf8').replace("const root='docs/evidence/T20/postgres-proactive'","const root='docs/evidence/T20/postgres-proactive-ui'");
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
