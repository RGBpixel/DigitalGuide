import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='docs/evidence/T20/postgres-recovery/check-runner-current-v2.mjs';let source=fs.readFileSync('docs/evidence/T20/postgres-recovery/check-runner.mjs','utf8');
for(const[from,to]of [["unit:tests(['tests/unit/postgres-recovery.test.ts'])","unit:tests(['tests/unit/postgres-recovery.test.ts','tests/unit/postgres-recovery-catalog.test.ts'])"],["migration:tests(['tests/unit/postgres-runtime.test.ts'])","'recovery-catalog':tests(['tests/integration/postgres-recovery-catalog.test.ts']),migration:tests(['tests/unit/postgres-runtime.test.ts'])"],["'tsconfig.json'],bindings=[]","'tsconfig.json','packages/test-fixtures/recovery-check-roundtrip.json'],bindings=[]"]]){assert.equal(source.split(from).length,2);source=source.replace(from,()=>to);}
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
