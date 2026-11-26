import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = 'docs/evidence/T35/developer-access', file = root + '/process-auditor.mjs';
const source = fs.readFileSync('docs/evidence/T35/enterprise-directory-access/process-auditor.mjs', 'utf8').replace("const root='docs/evidence/T35/enterprise-directory-access'", "const root='" + root + "'");
assert.ok(source.includes("const root='" + root + "'"));
if (fs.existsSync(file)) assert.equal(fs.readFileSync(file, 'utf8'), source); else fs.writeFileSync(file, source, { flag: 'wx' });
await import('../' + file);
