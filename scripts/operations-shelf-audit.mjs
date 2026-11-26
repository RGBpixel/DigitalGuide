import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='docs/evidence/T35/resource-shelf/process-auditor.mjs',from="const root='docs/evidence/T35/plan-entitlements'";let source=fs.readFileSync('docs/evidence/T35/plan-entitlements/process-auditor.mjs','utf8');assert.equal(source.split(from).length,2);source=source.replace(from,()=>"const root='docs/evidence/T35/resource-shelf'");if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
