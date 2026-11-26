import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-hospitality',file=root+'/check-runner-service.mjs';
const before="unit:tests(['tests/unit/postgres-runtime.test.ts','tests/unit/native-order-contract.test.ts','tests/unit/native-billing-contract.test.ts'])";
let source=fs.readFileSync(root+'/check-runner.mjs','utf8');assert.equal(source.split(before).length,2);
source=source.replace(before,"unit:tests(['tests/unit/postgres-runtime.test.ts','tests/unit/native-order-contract.test.ts','tests/unit/native-billing-contract.test.ts','tests/unit/native-hospitality-contract.test.ts'])");
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});
await import('../'+file);
