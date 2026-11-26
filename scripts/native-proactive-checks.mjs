import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-proactive',file=root+'/check-runner.mjs';
let source=fs.readFileSync('docs/evidence/T20/postgres-hospitality/conversation-ui/check-runner.mjs','utf8');
source=source.replace("const root='docs/evidence/T20/postgres-hospitality/conversation-ui'","const root='docs/evidence/T20/postgres-proactive'").replace('hospitality|aftercare)','hospitality|aftercare|proactive)').replace("core:tests(['tests/integration/postgres-hospitality-conversation.test.ts'])","core:tests(['tests/integration/postgres-proactive.test.ts']),frontdesk:tests(['tests/integration/postgres-guest-memory.test.ts']),migration:tests(['tests/unit/postgres-runtime.test.ts'])");
assert.ok(source.includes('postgres-proactive.test.ts'));if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
