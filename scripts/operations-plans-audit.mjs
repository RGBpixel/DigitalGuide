import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='docs/evidence/T35/plan-entitlements/process-auditor.mjs',from="const root='docs/evidence/T35/operations-metrics'";let source=fs.readFileSync('docs/evidence/T35/operations-metrics/process-auditor.mjs','utf8');assert.equal(source.split(from).length,2);source=source.replace(from,()=>"const root='docs/evidence/T35/plan-entitlements'");if(fs.existsSync(file))assert.equal(fs.readFileSync(file,'utf8'),source);else fs.writeFileSync(file,source,{flag:'wx'});await import('../'+file);
