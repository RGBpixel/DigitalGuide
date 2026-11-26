import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const mode = process.argv[2];
assert.ok(['documents', 'final'].includes(mode));
const root = 'docs/evidence/T20/postgres-recovery-directory-erasure';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const start = read(root + '/phase-start.json'), parent = read(start.parentFile), scope = parent.scope, backlog = read('docs/backlog.json');
assert.equal(hash(start.parentFile), start.parentSHA256);
assert.deepEqual(scope, { requirements: 134, tasks: 38, acceptanceCases: 65, capabilityGroups: 26 });
assert.equal(backlog.requirements.length, 134); assert.equal(backlog.tasks.length, 38);
assert.deepEqual(backlog.expectedCounts, scope); assert.equal(backlog.capabilityGroups.length, 26);
for (const [status, count] of [['verified', 27], ['in_progress', 2], ['pending', 9]]) assert.equal(backlog.tasks.filter(t => t.status === status).length, count);
for (const id of ['T20', 'T35']) assert.equal(backlog.tasks.find(t => t.id === id).status, 'in_progress');
const checks = ['directory-erasure-unit-initial', 'directory-erasure-native-initial', 'directory-erasure-proof-types-resume', 'directory-erasure-proof-lint-resume', 'directory-erasure-build', 'directory-erasure-compiled-continued'];
for (const label of checks) assert.equal(read(root + '/' + label + '-command.json').result, 'PASS', label);
const testStages = ['directory-erasure-unit-initial', 'directory-erasure-native-initial'];
const cases = testStages.flatMap(stage => read(root + '/' + stage + '.json').testResults.flatMap(file => file.assertionResults.filter(t => t.status === 'passed').map(t => ({ stage, file: file.name, title: t.fullName }))));
assert.equal(cases.length, 20); assert.equal(new Set(cases.map(c => c.file + '|' + c.title)).size, 20); assert.equal(new Set(cases.map(c => c.file)).size, 2);
const priorProofFile = root + '/directory-erasure-recovery-compiled/proof.json', priorProof = read(priorProofFile);
const proofFile = root + '/directory-erasure-recovery-compiled-continued/proof.json', proof = read(proofFile);
const manifestFile = root + '/directory-erasure-recovery-compiled-continued/compiled-file-sha256.json', compiled = read(manifestFile);
const summary = read(root + '/directory-erasure-recovery-compiled-continued/directory-erasure-recovery-summary.json');
assert.equal(priorProof.result, 'FAIL'); assert.equal(priorProof.checks.length, 1); assert.equal(priorProof.root, proof.root);
assert.equal(proof.result, 'PASS'); assert.equal(proof.checks.length, 11); assert.equal(summary.compiledChecks, 11);
assert.equal(summary.resumedOriginalFailedFixture, true); assert.equal(summary.initialSuccessfulUserCreationRepeated, false);
assert.equal(summary.contentModelsRead, false); assert.equal(summary.workerStarted, false);
assert.equal(Object.keys(compiled).length, 96); assert.equal(summary.webFiles, 69);
const previousCompiled = read(parent.compiledFileManifest);
for (const [file, sha] of Object.entries(compiled)) {
  assert.equal(hash(file), sha, file); assert.equal(hash(path.join(proof.compiledOnlyRoot, file)), sha, file);
  if (file.startsWith('dist/web/')) assert.equal(previousCompiled[file], sha, file);
}
assert.equal(hash('docs/api/openapi.json'), parent.documents['docs/api/openapi.json']);
for (const file of ['erasure-restart.json', 'directory-erasure-recovery-compiled-continued/compiled-restart.json']) {
  const restart = read(root + '/' + file); assert.equal(restart.result, 'PASS'); assert.equal(restart.tables, 517); assert.equal(restart.originalKeys, 2);
}
const auditFile = root + '/directory-erasure-recovery-final-process-audit.json', audit = read(auditFile);
const mainFile = 'docs/evidence/T20/postgres-speaker-focus/runtime/preservation-directory-erasure-recovery-final.json', main = read(mainFile);
assert.equal(audit.result, 'PASS_STRICT_NATIVE_RECOVERY_PROCESS_CLOSURE'); assert.equal(audit.privateProcesses, 0); assert.equal(audit.privateListeners, 0);
assert.equal(audit.roots, 4); assert.equal(audit.ports, 7); assert.ok(audit.creationIdentities > 0);
assert.equal(main.result, 'PASS'); assert.equal(main.originalBusinessRows, 3310); assert.equal(main.missingOrChangedOriginalBusinessRows, 0); assert.equal(main.bothOriginalKeysExact, true); assert.equal(main.removedObservedExpiredAuthenticationRows, 8);
for (const [file, sha] of Object.entries(parent.sourceSHA256).filter(([file]) => /^migrations\//.test(file))) assert.equal(hash(file), sha, file);
const frozenRulesFiles = ['packages/postgres/src/recovery-identity-selection.ts', 'packages/postgres/src/recovery-identity-authority.ts', 'packages/postgres/src/recovery-identity-receipts.ts', 'packages/postgres/src/recovery-directory-selection.ts', 'packages/postgres/src/recovery-directory-authority.ts', 'packages/postgres/src/recovery-directory-receipts.ts', 'packages/postgres/src/recovery-journal-format.ts'];
for (const file of frozenRulesFiles) assert.equal(hash(file), parent.sourceSHA256[file], file);
assert.equal(read('migrations/postgres/runtime.json').version, 135);
const firstApplied = read(root + '/erasure-applied.json').applied;
assert.equal(firstApplied.algorithm, 'restored-directory-profile-erasure-v1');
const nativeSourceRoot = read(root + '/erasure-target.json').sourceRoot;
assert.equal(hash(path.join(nativeSourceRoot, 'erasure-baseline.dgr')), read(root + '/erasure-backup.json').backup.archiveSHA256);
assert.equal(hash(path.join(proof.root, 'compiled-backup.dgr')), read(root + '/directory-erasure-recovery-compiled-continued/compiled-backup.json').backup.archiveSHA256);
const nativeBindings = read(root + '/directory-erasure-native-initial-command.json').bindings;
const erasureSourceFiles = ['recovery-directory-erasure.ts', 'recovery-directory-erasure-selection.ts', 'recovery-directory-erasure-receipts.ts', 'recovery-directory-erasure-witness.ts'].map(name => 'packages/postgres/src/' + name);
for (const file of erasureSourceFiles) { const binding = nativeBindings.find(b => b.file === file); assert.ok(binding); assert.equal(hash(file), binding.sha256, file); }
const failedCommands = fs.readdirSync(root).filter(n => n.endsWith('-command.json')).filter(n => read(root + '/' + n).result === 'FAIL').map(n => root + '/' + n);
if (mode === 'documents') {
  assert.equal(fs.existsSync(root + '/documents-update.json'), false);
  const note = '2026-11-26 增量139目录删除恢复重核检查点：日志导出同一重复读快照附加独立Ed25519签名范围证明，绑定备份固定公钥、完整日志元数据及确切头摘要，仅含范围/原回执主键摘要与来源共享姓名决定；相同头不可换证明，缺失/篡改/超限拒绝。隔离恢复新增独立版本预览/明确确认/私有不可变收据及directory_erasure_v1第五状态边，先原身份和目录撤权再清理，基础撤权不得跳过。已证明旧目录正文及独占姓名精确清理，来源共享姓名和其他范围保持，备份后新人员不创建，原业务回执/事件不伪造、不改写。20不同自动检查/2文件通过（7单元+13原生），含两处故障完整回滚、确认/摘要/容量/状态漂移/幂等/不可变与五操作链；未重跑成功恢复。12编译检查按1+11在同一独立实例分阶段通过，实际CLI备份/校验/日志/跨库恢复、顺序和缺证拒绝、精确清理、隐私/基础撤权及目标重启原收据复用贯通。原验证脚本空DELETE误带JSON头400与导入路径类型FAIL保留，严格审计后只续原失败实例，原已建号不重复；修正类型/lint/构建通过。两套517表/两视图/各两原密钥重启保持，业务仍隔离、排队任务0次执行；96构建绑定，69Web与138相同不复跑GUI，OpenAPI字节未变，无worker/设备/大内容模型或真实动作。严格4根/7端口/' + audit.creationIdentities + '捕获创建身份私有0，不扩大短命CLI/夹具PID覆盖；主33223四原进程/3310业务行/两密钥/052保持，8过期登录未恢复，不重启切库，旧成功根保持关闭。无业务迁移，059/138/runtime135冻结、下一060/139；原身份/目录v1与原日志格式不改，新清理v1首次提交后冻结。只支持同覆盖版本且只清理恢复副本，不重写加密归档；跨版本恢复、生产删除标记接续/保留期自动化、其他业务/真实IdP/正向身份与全部134/38/65/26/T20/T35/G2继续，27本地verified、两进行中、9pending及目标active/progress保持。';
  let plan = fs.readFileSync('PLAN.md', 'utf8').replace(/当前增量：[^\n]*/, () => '当前增量：139，签名目录清理证明、恢复后精确正文清理及五操作链已验证；20自动/12编译通过，原类型FAIL保留。059/138/runtime135冻结；跨版本/生产删除接续、真实互操作和全平台T20/T35/G2继续。');
  assert.ok(plan.includes('\n2026-11-26 增量139开始：'));
  plan = plan.replace('\n2026-11-26 增量139开始：', () => '\n' + note + '\n\n2026-11-26 增量139开始：'); fs.writeFileSync('PLAN.md', plan);
  for (const item of [...backlog.requirements.filter(r => ['R-009', 'R-058', 'R-059', 'R-119'].includes(r.id)), ...backlog.tasks.filter(t => ['T20', 'T35'].includes(t.id))]) {
    item.progressNotes = (item.progressNotes || '') + '\n' + note; item.evidence ??= [];
    for (const file of ['docs/139-directory-erasure-recovery.md', root + '/verification.json']) if (!item.evidence.includes(file)) item.evidence.push(file);
  }
  backlog.updatedAt = '2026-11-26'; fs.writeFileSync('docs/backlog.json', JSON.stringify(backlog, null, 2) + '\n');
  const readme = fs.readFileSync('README.md', 'utf8'); assert.ok(readme.startsWith('# DigitalGuide 数字人平台\n'));
  fs.writeFileSync('README.md', readme.replace('# DigitalGuide 数字人平台\n', () => '# DigitalGuide 数字人平台\n\n[恢复后目录资料删除重核](docs/139-directory-erasure-recovery.md)：独立签名范围证明、精确清理、共享姓名保护和第五操作收据已接通。20自动/12编译检查通过，两套517表/两密钥重启保持，原类型FAIL保留。96构建/69Web绑定，主052不重启切库；仅同覆盖版本与隔离恢复副本，跨版本/生产接续及真实IdP/G2继续，命令见文档。\n'));
  fs.appendFileSync('docs/02-architecture.md', '\n\n2026-11-26 增量139：[恢复后目录资料删除重核](139-directory-erasure-recovery.md)在既有日志格式外增加同快照独立签名范围证明，仅含范围与原业务回执主键摘要及共享姓名清理决定；绑定固定备份公钥、完整日志头且同头不覆盖。新的独立规则/私有不可变收据以directory_erasure_v1接入第五状态边，先原身份/目录撤权再精确清理已证明旧正文、原子移除相关基础/关系并使旧登录失效；来源共享决定/其他范围及原业务回执保持，备份后新人员不创建。基础撤权不能跳过此步，无生产启用。旧身份/目录v1及原日志格式、059/138/runtime135不改，下一060/139；同覆盖版本/隔离副本限制、生产删除标记接续/跨版本恢复与完整T20/T35/G2继续。\n');
  fs.appendFileSync('docs/04-roadmap-acceptance.md', '\n\n2026-11-26 增量139：[目录资料恢复删除重核](139-directory-erasure-recovery.md)20不同自动检查/2文件和12编译检查通过。实际签名/头/范围/容量/缺证、确认/摘要/状态漂移/两处故障回滚、共享保护/精确清理/幂等/不可变/五收据链、CLI跨集群恢复及两套517表/两视图/各两原密钥重启原回执复用已验。原证明脚本导入路径类型FAIL保留；成功恢复和已提交业务不重复。96产物绑定，69Web未变不复跑GUI，OpenAPI相同，无worker/设备/真实动作；严格4根/7端口/' + audit.creationIdentities + '捕获身份私有0，主33223/3310业务行/两密钥/052保持，8过期登录未恢复。无新业务迁移，059/138/runtime135冻结/下一060与139；只清理隔离副本，不重写原归档，只支持同覆盖版本。跨版本/生产删除接续/完整保留期、真实供应/OIDC/正向核实、全部134/38/65/26/T20/T35/G2继续，目标active。\n');
  const builder = 'scripts/build-docs.mjs', source = fs.readFileSync(builder, 'utf8'); assert.equal(source.split("'docs/138-directory-lifecycle.md'").length, 2);
  fs.writeFileSync(builder, source.replace("'docs/138-directory-lifecycle.md'", "'docs/138-directory-lifecycle.md', 'docs/139-directory-erasure-recovery.md'"));
  write(root + '/verification.json', { result: 'IN_PROGRESS_FINAL_BINDING_PENDING', scope, goalStatus: 'active', wholeG2Complete: false });
  write(root + '/final-hash-audit.json', { result: 'IN_PROGRESS_FINAL_BINDING_PENDING', goalStatus: 'active' });
  write(root + '/documents-update.json', { result: 'DOCUMENTS_UPDATED_PENDING_CHECKS', checkedAt: new Date().toISOString(), distinctAutomatedChecks: 20, compiledChecks: 12, guiChecks: 0 });
  console.log(JSON.stringify({ result: 'DOCUMENTS_UPDATED_PENDING_CHECKS', distinctAutomatedChecks: 20, compiledChecks: 12 }));
} else {
  const docChecks = ['directory-erasure-docs-build', 'directory-erasure-docs-check'];
  for (const label of docChecks) assert.equal(read(root + '/' + label + '-command.json').result, 'PASS');
  assert.equal(read(root + '/verification.json').result, 'IN_PROGRESS_FINAL_BINDING_PENDING');
  const sourceSHA256 = {}, snapshot = (file, sha) => {
    assert.equal(hash(file), sha, file); const target = root + '/sources/' + sha + '/' + path.basename(file); fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) assert.equal(hash(target), sha); else fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); sourceSHA256[file] = sha;
  };
  for (const item of read(root + '/directory-erasure-docs-check-command.json').bindings) snapshot(item.file, item.sha256);
  for (const file of ['.env.example', 'apps/web/src/operations/enterprise-directory.css']) snapshot(file, hash(file));
  for (const [file, sha] of Object.entries(parent.sourceSHA256)) if (!(file in sourceSHA256)) snapshot(file, sha);
  const executedBindings = read(root + '/directory-erasure-compiled-continued-command.json').bindings;
  for (const item of executedBindings.filter(b => /^(apps|packages|migrations)\//.test(b.file))) assert.equal(hash(item.file), item.sha256, item.file);
  const documents = {}; for (const file of new Set([...Object.keys(parent.documents), 'docs/139-directory-erasure-recovery.md'])) documents[file] = hash(file);
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() && !['sources', 'parent-documents'].includes(e.name) ? walk(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name).replaceAll('\\', '/')] : []);
  const evidenceSHA256 = {};
  for (const file of walk(root)) if (!file.endsWith('/verification.json') && !file.endsWith('/final-hash-audit.json')) evidenceSHA256[file] = hash(file);
  for (const file of [mainFile, main.rawReport]) evidenceSHA256[file] = hash(file);
  const archived = new Map();
  for (const file of Object.keys(evidenceSHA256).filter(f => f.endsWith('-command.json'))) for (const item of read(file).bindings ?? []) { assert.equal(hash(item.snapshot), item.sha256, item.snapshot); archived.set(item.snapshot, item.sha256); }
  fs.writeFileSync(root + '/verification.json', JSON.stringify({
    result: 'PASS_STAGED_DIRECTORY_ERASURE_RECOVERY', checkedAt: new Date().toISOString(), parentFile: start.parentFile, parentSHA256: start.parentSHA256,
    previousGoalTurnClassification: 'progress', currentGoalTurnClassification: 'progress', goalStatus: 'active', phaseStillOpen: false, scope,
    tasks: ['T20', 'T35'], requirements: ['R-009', 'R-058', 'R-059', 'R-119'], taskStatuses: { T20: 'in_progress', T35: 'in_progress' },
    distinctAutomatedChecks: 20, automatedTestFiles: 2, testStages, stagedCases: cases, originalSuccessfulRecoveryOperationsRepeated: false,
    compiledChecks: 12, compiledStages: [{ file: priorProofFile, passedChecks: 1, overallResult: 'FAIL' }, { file: proofFile, passedChecks: 11, overallResult: 'PASS' }], guiChecks: 0, webFilesUnchanged: 69,
    productionUiSourceChanged: false, apiSpecUnchanged: true, workerStarted: false, failedCommandsPreserved: failedCommands, sourceSHA256, documents, evidenceSHA256,
    checks: [...checks, ...docChecks], proofFile, proofSHA256: hash(proofFile), executedCompiledRoot: proof.compiledOnlyRoot, executedCompiledFileManifest: manifestFile,
    currentCompiledRoot: proof.compiledOnlyRoot, compiledFileManifest: manifestFile, currentCompiledRootExecuted: true, distinctCompiledManifestPairs: 1,
    compiledFilesBound: 96, individualExecutionOfEveryCompiledFileClaimed: false, activeRuntime: 135, lastFrozenMigration: '138-native-directory-shared-identity-name.sql',
    nextMigration: '139', sqliteMigration: '059', nextSqliteMigration: '060', newBusinessMigrationAdded: false, mainSqliteMigration: '052',
    nativeTables: 517, nativePermissionViews: 2, originalKeys: 2, linkedContentModels: 0,
    frozenIdentityRecoveryRulesSHA256: parent.frozenIdentityRecoveryRulesSHA256, frozenDirectoryRecoveryRulesSHA256: parent.frozenDirectoryRecoveryRulesSHA256,
    frozenDirectoryErasureRecoveryRulesSHA256: firstApplied.rulesSHA256, frozenDirectoryErasureSourceSHA256: Object.fromEntries(erasureSourceFiles.map(file => [file, hash(file)])),
    witnessFormat: 'native-directory-erasure-witness-v1', witnessSignature: 'Ed25519', witnessSharesJournalSnapshot: true, originalBusinessReceiptsForged: false,
    sourceArchiveRewritten: false, productionDeletionTombstoneCarryForwardComplete: false, sameCoverageVersionRequired: true,
    strictClosure: { file: auditFile, sha256: hash(auditFile), roots: audit.roots, ports: audit.ports, creationIdentities: audit.creationIdentities, privateProcesses: 0, privateListeners: 0, fullShortLivedCliOrUnitFixturePidCreationCoverageClaimed: false },
    mainPreservation: mainFile, mainPreservationSHA256: hash(mainFile), removedObservedExpiredOriginalAuthenticationRows: 8,
    mainRestarted: false, mainCutOver: false, earlierSuccessfulSealedRootsReactivated: false, wholeR119Complete: false, wholeT35Complete: false,
    wholeT20Complete: false, wholeG2Complete: false, productionAccepted: false,
    remaining: ['跨覆盖版本恢复与生产删除标记接续、完整保留期/其他业务和对象存储核对', '真实IdP供应/OIDC与正向身份核实、同步凭据重新接入及全工作族离职中止', 'T35其余企业运营与T20可信业务新鲜度/生产启用', '全部134/38/65/26平台与真实克隆/声音语气/感知/渠道及G2现场验收']
  }, null, 2) + '\n');
  let count = 0;
  for (const map of [sourceSHA256, documents, evidenceSHA256]) for (const [file, sha] of Object.entries(map)) { assert.equal(hash(file), sha, file); count++; }
  for (const [file, sha] of Object.entries(compiled)) { assert.equal(hash(path.join(proof.compiledOnlyRoot, file)), sha, file); count++; }
  assert.equal(read(root + '/final-hash-audit.json').result, 'IN_PROGRESS_FINAL_BINDING_PENDING');
  fs.writeFileSync(root + '/final-hash-audit.json', JSON.stringify({ result: 'PASS_DIRECTORY_ERASURE_RECOVERY_FINAL_HASH_BINDINGS', checkedAt: new Date().toISOString(), fileHashesVerified: count, archivedSourceSnapshotsVerified: archived.size, verificationSHA256: hash(root + '/verification.json'), distinctAutomatedChecks: 20, compiledChecks: 12, distinctCompiledManifestPairs: 1, goal: 'active', goalTurnClassification: 'progress' }, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'PASS_DIRECTORY_ERASURE_RECOVERY_FINAL_HASH_BINDINGS', fileHashesVerified: count, archivedSourceSnapshotsVerified: archived.size, goal: 'active' }));
}
