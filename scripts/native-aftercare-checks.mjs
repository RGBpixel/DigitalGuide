import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-hospitality/aftercare',file=root+'/check-runner.mjs';
let source=fs.readFileSync('docs/evidence/T20/postgres-hospitality/ui/check-runner.mjs','utf8');
const replace=(a,b)=>{assert.equal(source.split(a).length,2,a);source=source.replace(a,b);};
replace("const root='docs/evidence/T20/postgres-hospitality/ui'","const root='docs/evidence/T20/postgres-hospitality/aftercare'");replace("core:tests(['tests/integration/postgres-hospitality.test.ts'])","core:tests(['tests/integration/postgres-aftercare.test.ts'])");replace("'tests/unit/native-hospitality-contract.test.ts'])","'tests/unit/native-hospitality-contract.test.ts','tests/unit/native-aftercare-crypto.test.ts','tests/unit/native-aftercare-contract.test.ts'])");replace('|hospitality)-','|hospitality|aftercare)-');
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
