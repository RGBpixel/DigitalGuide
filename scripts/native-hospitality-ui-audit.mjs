import fs from 'node:fs';
import assert from 'node:assert/strict';
let source=fs.readFileSync('docs/evidence/T20/postgres-hospitality/process-auditor.mjs','utf8');
assert.equal(source.split("const root='docs/evidence/T20/postgres-hospitality'").length,2);
source=source.replace("const root='docs/evidence/T20/postgres-hospitality'","const root='docs/evidence/T20/postgres-hospitality/ui'");
const file='docs/evidence/T20/postgres-hospitality/ui/process-auditor.mjs';if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
