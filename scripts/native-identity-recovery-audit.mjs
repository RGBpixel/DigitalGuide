import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='docs/evidence/T20/postgres-recovery-identity/process-auditor.mjs',source=fs.readFileSync('docs/evidence/T35/member-runtime-access/process-auditor.mjs','utf8').replace("const root='docs/evidence/T35/member-runtime-access'","const root='docs/evidence/T20/postgres-recovery-identity'");assert.ok(source.includes("const root='docs/evidence/T20/postgres-recovery-identity'"));if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
