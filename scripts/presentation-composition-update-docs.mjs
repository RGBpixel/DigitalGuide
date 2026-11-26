// Documentation and backlog update receipt; content is maintained in the repository originals.
import fs from 'node:fs';import assert from 'node:assert/strict';
const b=JSON.parse(fs.readFileSync('docs/backlog.json','utf8'));assert.equal(b.tasks.find(t=>t.id==='T25').status,'in_progress');assert.equal(b.requirements.find(t=>t.id==='R-110').status,'in_progress');assert.equal(b.tasks.filter(t=>t.status==='verified').length,22);assert.ok(fs.readFileSync('PLAN.md','utf8').includes('主42251/schema051'));console.log('Documentation and full scope retained.');
