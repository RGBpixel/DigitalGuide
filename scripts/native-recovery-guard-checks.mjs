import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-recovery-guard',file=root+'/check-runner.mjs';
let source=fs.readFileSync('docs/evidence/T20/postgres-proactive/check-runner.mjs','utf8');
const replacements=[
 ["const root='docs/evidence/T20/postgres-proactive'","const root='docs/evidence/T20/postgres-recovery-guard'"],
 ['hospitality|aftercare|proactive)','hospitality|aftercare|proactive|recovery-guard)'],
 ["core:tests(['tests/integration/postgres-proactive.test.ts'])","core:tests(['tests/integration/postgres-recovery-guard.test.ts'])"],
 ["unit:tests(['tests/unit/postgres-runtime.test.ts','tests/unit/native-order-contract.test.ts','tests/unit/native-billing-contract.test.ts','tests/unit/native-hospitality-contract.test.ts','tests/unit/native-aftercare-crypto.test.ts','tests/unit/native-aftercare-contract.test.ts'])","unit:tests(['tests/unit/postgres-recovery-guard.test.ts'])"]
];for(const[from,to]of replacements){assert.equal(source.split(from).length,2,from);source=source.replace(from,()=>to);}
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
