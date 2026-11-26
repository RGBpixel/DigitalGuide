import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='docs/evidence/T35/member-directory/process-auditor.mjs',source=fs.readFileSync('docs/evidence/T35/enterprise-identity/process-auditor.mjs','utf8').replace("const root='docs/evidence/T35/enterprise-identity'","const root='docs/evidence/T35/member-directory'");
assert.ok(source.includes("const root='docs/evidence/T35/member-directory'"));if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
