import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-recovery',file=root+'/check-runner.mjs';let source=fs.readFileSync('docs/evidence/T20/postgres-proactive/check-runner.mjs','utf8');
const replacements=[
 ["const root='docs/evidence/T20/postgres-proactive'","const root='docs/evidence/T20/postgres-recovery'"],
 ['hospitality|aftercare|proactive)','hospitality|aftercare|proactive|recovery|recovery-guard)'],
 ["'scripts/check-docs.mjs'],bindings=[]","'scripts/check-docs.mjs','package.json','pnpm-lock.yaml','tsconfig.json'],bindings=[]"],
 ["core:tests(['tests/integration/postgres-proactive.test.ts'])","core:tests(['tests/integration/postgres-recovery.test.ts']),sqlite:tests(['tests/unit/recovery-safety.test.ts','tests/integration/recovery.test.ts'])"],
 ["unit:tests(['tests/unit/postgres-runtime.test.ts','tests/unit/native-order-contract.test.ts','tests/unit/native-billing-contract.test.ts','tests/unit/native-hospitality-contract.test.ts','tests/unit/native-aftercare-crypto.test.ts','tests/unit/native-aftercare-contract.test.ts'])","unit:tests(['tests/unit/postgres-recovery.test.ts'])"]
];for(const[from,to]of replacements){assert.equal(source.split(from).length,2,from);source=source.replace(from,()=>to);}
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
