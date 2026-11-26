import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='docs/evidence/T35/enterprise-directory-ui/process-auditor.mjs',source=fs.readFileSync('docs/evidence/T35/enterprise-directory/process-auditor.mjs','utf8').replace("const root='docs/evidence/T35/enterprise-directory'","const root='docs/evidence/T35/enterprise-directory-ui'");assert.ok(source.includes("const root='docs/evidence/T35/enterprise-directory-ui'"));if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
