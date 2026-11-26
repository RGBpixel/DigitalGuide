import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync('scripts/native-dining-food-checks.mjs','utf8');assert.equal(source.split("const root='docs/evidence/T20/postgres-food'").length,2);
let updated=source.replace("const root='docs/evidence/T20/postgres-food'","const root='docs/evidence/T20/postgres-food/ui'").replace('/^native-(speaker|vision|restaurant|dining)-.*\\.(mjs|sql)$/','/^native-(speaker|vision|restaurant|dining|food)-.*\\.(mjs|sql)$/');
updated=updated.replace("core:tests(['tests/integration/postgres-food.test.ts'])","core:tests(['tests/integration/postgres-food-import.test.ts']),food:tests(['tests/integration/postgres-food.test.ts']),purpose:tests(['tests/integration/postgres-food-memory.test.ts'])").replace("unit:tests(['tests/unit/postgres-runtime.test.ts'])","unit:tests(['tests/unit/postgres-runtime.test.ts','tests/unit/native-food-contract.test.ts'])");
assert.notEqual(updated,source);const file='docs/evidence/T20/postgres-food/ui/check-runner-with-purpose.mjs';if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),updated);else fs.writeFileSync(file,updated,{flag:'wx'});await import('../'+file);
