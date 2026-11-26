import fs from 'node:fs';
import assert from 'node:assert/strict';
let source=fs.readFileSync('scripts/native-order-guest-audit.mjs','utf8');
assert.equal(source.split("const root='docs/evidence/T20/postgres-order-ui/guest'").length,2);
source=source.replace("const root='docs/evidence/T20/postgres-order-ui/guest'","const root='docs/evidence/T20/postgres-hospitality'").replaceAll('PASS_STRICT_ORDER_GUEST_PROCESS_CLOSURE','PASS_STRICT_HOSPITALITY_PROCESS_CLOSURE');
const file='docs/evidence/T20/postgres-hospitality/process-auditor.mjs';
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});
await import('../'+file);
