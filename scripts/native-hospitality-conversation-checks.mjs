import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-hospitality/conversation',file=root+'/check-runner.mjs';
let source=fs.readFileSync('docs/evidence/T20/postgres-hospitality/aftercare-ui/check-runner.mjs','utf8').replace("const root='docs/evidence/T20/postgres-hospitality/aftercare-ui'","const root='docs/evidence/T20/postgres-hospitality/conversation'").replace("core:tests(['tests/integration/postgres-aftercare-history.test.ts'])","core:tests(['tests/integration/postgres-hospitality-conversation.test.ts'])");
source=source.replace("sessions:tests(['tests/integration/postgres-restaurant-sessions.test.ts'])","sessions:tests(['tests/integration/postgres-restaurant-sessions.test.ts']),speaker:tests(['tests/integration/postgres-speaker-events.test.ts'])");
if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
