import fs from 'node:fs';
import assert from 'node:assert/strict';
let source=fs.readFileSync('docs/evidence/T20/postgres-hospitality/conversation/process-auditor.mjs','utf8');
assert.equal(source.split("const root='docs/evidence/T20/postgres-hospitality/conversation'").length,2);
source=source.replace("const root='docs/evidence/T20/postgres-hospitality/conversation'","const root='docs/evidence/T20/postgres-hospitality/conversation-ui'")
 .replaceAll('PASS_STRICT_CONVERSATION_PROCESS_CLOSURE','PASS_STRICT_CONVERSATION_UI_PROCESS_CLOSURE');
const file='docs/evidence/T20/postgres-hospitality/conversation-ui/process-auditor.mjs';
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});
await import('../'+file);
