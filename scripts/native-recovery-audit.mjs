import fs from 'node:fs';
import assert from 'node:assert/strict';
let source=fs.readFileSync('docs/evidence/T20/postgres-proactive/process-auditor.mjs','utf8');assert.equal(source.split("const root='docs/evidence/T20/postgres-proactive'").length,2);source=source.replace("const root='docs/evidence/T20/postgres-proactive'","const root='docs/evidence/T20/postgres-recovery'").replaceAll('PASS_STRICT_PROACTIVE_PROCESS_CLOSURE','PASS_STRICT_NATIVE_RECOVERY_PROCESS_CLOSURE');
const file='docs/evidence/T20/postgres-recovery/process-auditor.mjs';if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
