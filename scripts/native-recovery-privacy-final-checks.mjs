import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='docs/evidence/T20/postgres-recovery-privacy/check-runner-v3.mjs';let source=fs.readFileSync('docs/evidence/T20/postgres-recovery-privacy/check-runner-v2.mjs','utf8');const point='const commands={';assert.equal(source.split(point).length,2);source=source.replace(point,()=>"const commands={'privacy-plan':tests(['tests/integration/postgres-recovery-privacy-plan.test.ts']),");if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
