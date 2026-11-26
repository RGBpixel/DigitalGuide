import fs from 'node:fs';
import assert from 'node:assert/strict';
let source=fs.readFileSync('docs/evidence/T20/postgres-hospitality/aftercare-ui/process-auditor.mjs','utf8');assert.equal(source.split("const root='docs/evidence/T20/postgres-hospitality/aftercare-ui'").length,2);source=source.replace("const root='docs/evidence/T20/postgres-hospitality/aftercare-ui'","const root='docs/evidence/T20/postgres-hospitality/conversation'").replaceAll('PASS_STRICT_AFTERCARE_UI_PROCESS_CLOSURE','PASS_STRICT_CONVERSATION_PROCESS_CLOSURE');
const file='docs/evidence/T20/postgres-hospitality/conversation/process-auditor.mjs';if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
