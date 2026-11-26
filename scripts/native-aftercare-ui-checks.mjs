import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-hospitality/aftercare-ui',file=root+'/check-runner.mjs';
const source=fs.readFileSync('docs/evidence/T20/postgres-hospitality/aftercare/check-runner.mjs','utf8').replace("const root='docs/evidence/T20/postgres-hospitality/aftercare'","const root='docs/evidence/T20/postgres-hospitality/aftercare-ui'").replace("core:tests(['tests/integration/postgres-aftercare.test.ts'])","core:tests(['tests/integration/postgres-aftercare-history.test.ts'])");
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});
await import('../'+file);
