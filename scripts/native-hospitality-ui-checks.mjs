import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-hospitality/ui',file=root+'/check-runner.mjs';
let source=fs.readFileSync('docs/evidence/T20/postgres-hospitality/check-runner-service.mjs','utf8');
assert.equal(source.split("const root='docs/evidence/T20/postgres-hospitality'").length,2);
source=source.replace("const root='docs/evidence/T20/postgres-hospitality'","const root='docs/evidence/T20/postgres-hospitality/ui'");
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});
await import('../'+file);
