import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = 'docs/evidence/T35/developer-access', parentFile = 'docs/evidence/T20/postgres-recovery-directory-erasure/verification.json';
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const hash = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const parent = read(parentFile), final = read('docs/evidence/T20/postgres-recovery-directory-erasure/final-hash-audit.json');
assert.equal(parent.result, 'PASS_STAGED_DIRECTORY_ERASURE_RECOVERY'); assert.equal(hash(parentFile), final.verificationSHA256);
let count = 0;
for (const map of [parent.sourceSHA256, parent.documents, parent.evidenceSHA256]) for (const [file, sha] of Object.entries(map)) { assert.equal(hash(file), sha, file); count++; }
for (const [file, sha] of Object.entries(read(parent.compiledFileManifest))) { assert.equal(hash(path.join(parent.currentCompiledRoot, file)), sha, file); count++; }
assert.equal(count, final.fileHashesVerified); fs.mkdirSync(root);
const documents = {};
for (const [file, sha] of Object.entries(parent.documents)) { const snapshot = root + '/parent-documents/' + sha + '/' + path.basename(file); fs.mkdirSync(path.dirname(snapshot), { recursive: true }); fs.copyFileSync(file, snapshot, fs.constants.COPYFILE_EXCL); documents[file] = { sha256: sha, snapshot }; }
fs.writeFileSync(root + '/phase-start.json', JSON.stringify({ result: 'PASS_DEVELOPER_ACCESS_START_REVALIDATED', checkedAt: new Date().toISOString(), parentFile, parentSHA256: hash(parentFile), parentHashesVerified: count, parentCompiledPairsVerified: 1, documents, scope: parent.scope, previousGoalTurnClassification: 'progress', goalStatus: 'active', tasks: ['T35'], requirements: ['R-002', 'R-009', 'R-062', 'R-120'], runtimeBefore: 135, plannedRuntime: 136, lastFrozenMigration: '138-native-directory-shared-identity-name.sql', plannedNativeMigration: '139-native-developer-access.sql', plannedSqliteMigration: '060-developer-access.sql', mainHandle: '33223', mainSqliteMigration: '052', mainRestarted: false, mainCutOver: false, earlierSuccessfulRootsReactivated: false, frozenIdentityRecoveryRulesSHA256: parent.frozenIdentityRecoveryRulesSHA256, frozenDirectoryRecoveryRulesSHA256: parent.frozenDirectoryRecoveryRulesSHA256, frozenDirectoryErasureRecoveryRulesSHA256: parent.frozenDirectoryErasureRecoveryRulesSHA256, work: ['Organization-managed scoped developer applications and revocable expiring one-time credentials, hash-only persistence and secret-free idempotency/audit', 'Separate machine authentication for bounded project/job metadata endpoints, current scope/environment checks and persistent credential rate limits', 'Chinese administration UI, explicit confirmations, stale-scope isolation and backward-compatible capability flag', 'SQLite/native PG contracts, real compiled API/PG restart retention, process closure and original workbench preservation; full API writes/webhooks/brand embed remain required'] }, null, 2) + '\n', { flag: 'wx' });
let runner = fs.readFileSync('docs/evidence/T20/postgres-recovery-directory-erasure/check-runner.mjs', 'utf8').replaceAll('docs/evidence/T20/postgres-recovery-directory-erasure', root);
runner = runner.replace('const commands={', "const commands={'developer-unit':tests(['tests/unit/developer-access.test.ts']),'developer-sqlite':tests(['tests/integration/developer-access.test.ts']),'developer-native':tests(['tests/integration/postgres-developer-access.test.ts']),'developer-proof':['--import','tsx','scripts/operations-developer-access-proof.ts',...process.argv.slice(4)],");
fs.writeFileSync(root + '/check-runner.mjs', runner);
const note = '2026-11-26 增量140开始：139最终2919份绑定和96构建已重核，上一目标轮progress。建设R-062/R-120开发者应用、环境/单空间/具体读取范围授权、只显示一次且仅摘要落库的过期可撤销访问凭证，以及独立机器鉴权的有界制作工程/任务状态读取和持久限频；中文管理界面与双库/编译重启证据一并补齐。计划追加SQLite060/原生139/runtime136，旧059/138/runtime135和三类恢复v1规则冻结，本轮尚未实现验证。此为开放接入基础，写入/任务提交、签名Webhook、品牌嵌入、真实生产互操作以及全部134/38/65/26/T20/T35/G2继续保留。主33223/052不重启切库，旧成功封存根保持关闭，目标active。';
const backlog = read('docs/backlog.json');
for (const item of [...backlog.requirements.filter(r => ['R-002', 'R-009', 'R-062', 'R-120'].includes(r.id)), ...backlog.tasks.filter(t => t.id === 'T35')]) { item.progressNotes = (item.progressNotes || '') + '\n' + note; item.evidence ??= []; item.evidence.push(root + '/phase-start.json'); if (['R-062', 'R-120'].includes(item.id)) { item.status = 'in_progress'; item.localStatus = 'in_progress'; } }
fs.writeFileSync('docs/backlog.json', JSON.stringify(backlog, null, 2) + '\n');
let plan = fs.readFileSync('PLAN.md', 'utf8').replace(/当前增量：[^\n]*/, '当前增量：140，开发者应用、访问凭证与独立机器读取接口；本轮尚未测试。计划追加060/139/runtime136，原恢复规则及完整平台范围保持。');
plan = plan.replace('\n2026-11-26 增量139目录删除恢复重核检查点：', '\n' + note + '\n\n2026-11-26 增量139目录删除恢复重核检查点：'); fs.writeFileSync('PLAN.md', plan);
console.log(JSON.stringify({ result: 'PASS_DEVELOPER_ACCESS_START', parentHashesVerified: count, goal: 'active' }));
