import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='docs/evidence/T20/postgres-recovery-privacy/process-auditor.mjs';let source=fs.readFileSync('docs/evidence/T20/postgres-recovery-journal/process-auditor.mjs','utf8');const from="const root='docs/evidence/T20/postgres-recovery-journal'";assert.equal(source.split(from).length,2);source=source.replace(from,()=>"const root='docs/evidence/T20/postgres-recovery-privacy'");if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
