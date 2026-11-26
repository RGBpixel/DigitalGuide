import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync('scripts/native-dining-food-checks.mjs','utf8');assert.equal(source.split("const root='docs/evidence/T20/postgres-food'").length,2);
let updated=source.replace("const root='docs/evidence/T20/postgres-food'","const root='docs/evidence/T20/postgres-food/memory-import'");updated=updated.replace("core:tests(['tests/integration/postgres-food.test.ts'])","core:tests(['tests/integration/postgres-food-import.test.ts']),food:tests(['tests/integration/postgres-food.test.ts']),memory:tests(['tests/integration/postgres-guest-memory.test.ts']),purpose:tests(['tests/integration/postgres-food-memory.test.ts'])");assert.notEqual(updated,source);
const file='docs/evidence/T20/postgres-food/memory-import/check-runner.mjs';if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),updated);else fs.writeFileSync(file,updated,{flag:'wx'});await import('../'+file);
