import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = message => errors.push(message);
const read = name => fs.readFile(path.join(root, name), 'utf8');
const b = JSON.parse(await read('docs/backlog.json'));
const acceptance = await read('docs/04-roadmap-acceptance.md');
const evidence = await read('docs/05-research-evidence.md');
const acIds = new Set([...acceptance.matchAll(/^\| (AC-\d{2}) \|/gm)].map(m => m[1]));
const sourceIds = new Set([...evidence.matchAll(/^- (SRC-\d{2}) /gm)].map(m => m[1]));
const reqMap = new Map(b.requirements.map(r => [r.id, r]));
const taskMap = new Map(b.tasks.map(t => [t.id, t]));

if (reqMap.size !== b.requirements.length) fail('Duplicate requirement ID');
if (taskMap.size !== b.tasks.length) fail('Duplicate task ID');
if (b.requirements.length !== b.expectedCounts.requirements) fail('Requirement count differs from approved baseline');
if (b.tasks.length !== b.expectedCounts.tasks) fail('Task count differs from approved baseline');
if (acIds.size !== b.expectedCounts.acceptanceCases) fail('Acceptance count differs from approved baseline');
if (b.capabilityGroups.length !== b.expectedCounts.capabilityGroups) fail('Capability-group count differs from approved baseline');
const grouped = new Set();
for (const group of b.capabilityGroups) {
  if (group.scope !== 'included' || !group.features || !group.evidenceLevel || !group.boundary) fail('Incomplete capability group: ' + group.id);
  for (const id of group.requirementIds) {
    if (!reqMap.has(id)) fail('Unknown capability requirement: ' + id);
    grouped.add(id);
  }
  for (const id of group.sourceIds) if (!sourceIds.has(id)) fail('Unknown capability source: ' + id);
}
for (const id of reqMap.keys()) if (!grouped.has(id)) fail('Requirement missing from capability matrix: ' + id);
for (const r of b.requirements) {
  if (!Array.isArray(r.evidence)) fail('Requirement evidence must be an array: ' + r.id);
  if (!/^R-\d{3}$/.test(r.id)) fail('Invalid requirement ID: ' + r.id);
  if (!b.statusVocabulary.requirements.includes(r.status)) fail('Invalid requirement status: ' + r.id);
  for (const level of ['localStatus','liveStatus']) if (!b.statusVocabulary.delivery.includes(r[level])) fail('Invalid delivery status: ' + r.id);
  if (!r.acceptanceIds.length) fail('No acceptance mapping: ' + r.id);
  for (const id of r.acceptanceIds) if (!acIds.has(id)) fail('Unknown acceptance: ' + r.id + '/' + id);
  for (const id of r.sourceIds) if (!sourceIds.has(id)) fail('Unknown source: ' + r.id + '/' + id);
  const mapped = b.tasks.filter(t => t.requirementIds.includes(r.id));
  if (!mapped.length) fail('No task covers ' + r.id);
  for (const milestone of r.milestones) if (!mapped.some(t => t.milestone === milestone)) fail('No task for ' + r.id + ' in ' + milestone);
  if (r.status === 'verified' && (!r.evidence.length || [r.localStatus,r.liveStatus].some(s => !['verified','not_applicable'].includes(s)))) fail('Requirement marked verified without full evidence: ' + r.id);
}
for (const t of b.tasks) {
  if (!Array.isArray(t.evidence)) fail('Task evidence must be an array: ' + t.id);
  if (!b.statusVocabulary.tasks.includes(t.status)) fail('Invalid task status: ' + t.id);
  if (!t.deliverable || !t.requirementIds.length || !t.acceptanceIds.length) fail('Incomplete task: ' + t.id);
  for (const id of t.requirementIds) if (!reqMap.has(id)) fail('Unknown requirement: ' + t.id + '/' + id);
  for (const id of t.acceptanceIds) if (!acIds.has(id)) fail('Unknown acceptance: ' + t.id + '/' + id);
  for (const dep of t.dependsOn) if (!taskMap.has(dep)) fail('Unknown dependency: ' + t.id + '/' + dep);
  if (t.status === 'verified' && !t.evidence.length) fail('Task verified without evidence: ' + t.id);
}
const visiting = new Set(), visited = new Set();
function visit(id) {
  if (visiting.has(id)) { fail('Dependency cycle at ' + id); return; }
  if (visited.has(id) || !taskMap.has(id)) return;
  visiting.add(id);
  for (const dep of taskMap.get(id).dependsOn) visit(dep);
  visiting.delete(id); visited.add(id);
}
for (const id of taskMap.keys()) visit(id);
for (const gate of b.gates) {
  const reachable = new Set();
  const collect = id => {
    if (reachable.has(id) || !taskMap.has(id)) return;
    reachable.add(id); taskMap.get(id).dependsOn.forEach(collect);
  };
  collect(gate.exitTask);
  for (const t of b.tasks.filter(t => gate.milestones.includes(t.milestone))) if (!reachable.has(t.id)) fail('Exit task misses ' + gate.id + '/' + t.id);
}
for (const id of acIds) if (!b.tasks.some(t => t.acceptanceIds.includes(id))) fail('Unassigned acceptance case: ' + id);

const docNames = ['README.md','AGENTS.md','PLAN.md','DigitalGuide-平台建设总文档.md',
...(await fs.readdir(path.join(root,'docs'))).filter(n => n.endsWith('.md')).map(n => 'docs/' + n)];
let localLinks = 0, externalLinks = 0;
for (const name of docNames) {
  const text = await read(name);
  if (text.includes('\uFFFD')) fail('Replacement character in ' + name);
  let fenceOpen = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('~~~')) fenceOpen = !fenceOpen;
    if (/[ \t]+$/.test(line)) fail('Trailing whitespace in ' + name);
  }
  if (fenceOpen) fail('Unclosed code fence in ' + name);
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^https?:/.test(link)) { externalLinks++; continue; }
    if (/^(mailto:|#)/.test(link)) continue;
    const target = path.resolve(root,path.dirname(name),decodeURIComponent(link.split('#')[0]));
    const rel = path.relative(root,target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { fail('Link escapes workspace in ' + name); continue; }
    try { await fs.access(target); localLinks++; } catch { fail('Broken local link in ' + name + ': ' + link); }
  }
}
const trace = await read('docs/07-requirements-traceability.md');
for (const id of reqMap.keys()) if (!trace.includes('| ' + id + ' |')) fail('Missing generated requirement row: ' + id);
for (const id of taskMap.keys()) if (!trace.includes('| ' + id + ' |')) fail('Missing generated task row: ' + id);
if (errors.length) {
  process.stderr.write(errors.join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({
    result: 'PASS', version: b.version, requirements: reqMap.size, tasks: taskMap.size,
    capabilityGroups: b.capabilityGroups.length, verificationItems: b.verificationItems.length,
    acceptanceCases: acIds.size, researchSources: sourceIds.size,
    markdownFiles: docNames.length, localLinks, externalLinks,
    checked: ['ID integrity','requirement-to-task and milestone coverage','acceptance coverage','capability matrix completeness','acyclic dependencies','gate completeness','local links','code fences','UTF-8 text'],
    notChecked: ['external URL availability','application implementation','vendor capability trials','live business operations']
  },null,2) + '\n');
}
