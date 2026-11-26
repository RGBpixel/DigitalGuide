import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='docs/evidence/T35/operations-metrics/process-auditor.mjs';let s=fs.readFileSync('docs/evidence/T20/postgres-recovery-journal/process-auditor.mjs','utf8');const from="const root='docs/evidence/T20/postgres-recovery-journal'";assert.equal(s.split(from).length,2);s=s.replace(from,()=>"const root='docs/evidence/T35/operations-metrics'");if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),s);else fs.writeFileSync(file,s,{flag:'wx'});await import('../'+file);
