import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const mode = process.argv[2];
assert.ok(['documents', 'final'].includes(mode));
const root = 'docs/evidence/T35/operations-metrics';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const start = read(root + '/phase-start.json');
assert.equal(hash(start.parentFile), start.parentSHA256);
const parent = read(start.parentFile);
const registry = read('migrations/postgres/runtime.json');
assert.equal(registry.version, 126);
assert.equal(registry.migrations.at(-1).name, '129-native-operations-metrics.sql');
assert.equal(registry.migrations.at(-1).sha256, read(root + '/129-first-committed.json').sha256);
assert.equal(registry.migrations.at(-1).sha256, '7c9f6334d84e1b14d459b74d7913f45f3ae67a315687582d38213be1305d2119');
for (const migration of registry.migrations) assert.equal(hash('migrations/postgres/' + migration.name), migration.sha256);

const stages = [
  ['operations-unit-initial', 10],
  ['operations-sqlite-initial', 10],
  ['operations-native-grant-phase', 12],
  ['operations-migration-target', 1]
];
const cases = [], files = new Set();
for (const [label, passed] of stages) {
  const result = read(root + '/' + label + '.json');
  assert.equal(result.numPassedTests, passed, label);
  assert.equal(result.numFailedTests, 0, label);
  for (const file of result.testResults) {
    files.add(file.name);
    for (const test of file.assertionResults.filter(test => test.status === 'passed')) {
      cases.push({ stage: label, name: test.fullName });
    }
  }
}
assert.equal(cases.length, 33);
assert.equal(new Set(cases.map(test => test.name)).size, 33);
assert.equal(files.size, 4);
assert.equal(read(root + '/operations-migration-target.json').numPendingTests, 44);
assert.equal(read(root + '/operations-shared-sqlite-alias.json').numPassedTests, 1);

const stagedFile = root + '/compiled-staged-verification.json';
const staged = read(stagedFile);
assert.equal(staged.result, 'PASS_STAGED_OPERATIONS_FEATURES_WITH_INDEPENDENT_POST_EXIT_CLOSURE');
assert.equal(staged.compiledChecks, 10);
assert.equal(staged.guiFlows, 8);
assert.deepEqual(staged.compiledStages, [1, 4, 2, 3]);
assert.deepEqual(staged.guiStages, [7, 1]);
assert.equal(staged.checks.length, 10);
assert.equal(new Set(staged.checks.map(check => check.name)).size, 10);
for (const proof of staged.proofs) {
  assert.equal(hash(proof.file), proof.sha256, proof.file);
  const raw = read(proof.file);
  assert.equal(raw.result, 'FAIL');
  assert.equal(raw.checks.length, proof.passedChecks);
  assert.ok(raw.checks.every(check => check.result === 'PASS'));
}
for (const gui of staged.gui) {
  assert.equal(hash(gui.file), gui.sha256, gui.file);
  assert.equal(read(gui.file).result, 'PASS');
}
const proofRoot = root + '/operations-compiled-final';
const summary = read(proofRoot + '/operations-summary.json');
assert.equal(summary.result, 'PASS');
assert.equal(summary.guiFlows.length, 8);
for (const flag of ['originalTaskRepeated', 'originalProjectsRecreated', 'originalRevocationRepeated', 'realBilling', 'productionAccepted', 'fullT35Complete', 'mainRestarted']) assert.equal(summary[flag], false, flag);
assert.equal(summary.backendEntriesUnchanged, true);
assert.equal(summary.currentWebVerified, true);
const visual = read(proofRoot + '/current-visual-assertions.json');
assert.equal(visual.result, 'PASS');
assert.equal(visual.mobileWidth, 390);
assert.equal(visual.actionsSameRow, true);
assert.equal(visual.allUnknownCostsDoNotDisplayKnownZero, true);
const visualReview = read(root + '/visual-review.json');
assert.equal(visualReview.result, 'PASS_MANUAL_VISUAL_REVIEW');
for (const image of visualReview.images) assert.equal(hash(image.file), image.sha256);
const restart = read(proofRoot + '/restart-verification.json');
assert.equal(restart.result, 'PASS');
assert.equal(restart.tables, 495);
assert.equal(restart.originalKeys, 2);
assert.deepEqual(restart.job, { status: 'succeeded', attempts: '1' });
assert.equal(restart.usage, 1);
assert.equal(restart.originalCookiePreserved, true);
const compiled = read(proofRoot + '/compiled-file-sha256.json');
assert.equal(Object.keys(compiled).length, 81);
for (const [file, sha] of Object.entries(compiled)) {
  assert.equal(hash(path.join(staged.currentCompiledRoot, file)), sha, file);
  assert.equal(hash(file), sha, file);
}
for (const name of ['web-v2-resume-input.json', 'web-v3-resume-input.json']) {
  const input = read(root + '/' + name);
  assert.equal(input.newTestsPassedClaimed, false);
  assert.equal(input.originalWebUnmodified, true);
  assert.equal(input.backendEntriesUnchanged, true);
  for (const [file, sha] of Object.entries(input.entrySHA256)) assert.equal(hash(path.join(input.compiledOnlyRoot, file)), sha);
}

const technicalChecks = ['operations-delivery-types', 'operations-delivery-lint', 'operations-final-web-build', 'operations-current-openapi'];
for (const label of technicalChecks) assert.equal(read(root + '/' + label + '-command.json').result, 'PASS', label);
for (const binding of read(root + '/operations-delivery-types-command.json').bindings) {
  if (/\.tsx?$/.test(binding.file)) assert.equal(hash(binding.file), binding.sha256, binding.file);
}
for (const binding of read(root + '/operations-final-web-build-command.json').bindings) {
  if (/^(apps|packages|migrations)\//.test(binding.file)) assert.equal(hash(binding.file), binding.sha256, binding.file);
}
const auditFile = root + '/operations-final-process-audit.json';
const audit = read(auditFile);
assert.equal(audit.result, 'PASS_STRICT_NATIVE_RECOVERY_PROCESS_CLOSURE');
assert.equal(audit.roots, 4);
assert.equal(audit.ports, 16);
assert.equal(audit.creationIdentities, 178);
assert.equal(audit.privateProcesses, 0);
assert.equal(audit.privateListeners, 0);
assert.equal(audit.mainOriginalProcesses, 4);
assert.equal(hash(auditFile), staged.independentPostExitClosure.sha256);
const lifecycle = read(root + '/lifecycle-resolution.json');
assert.equal(lifecycle.result, 'PASS_INDEPENDENT_POST_EXIT_LIFECYCLE_REVIEW');
assert.equal(lifecycle.originalInternalProofResult, 'FAIL');
assert.deepEqual(lifecycle.preExitAlive.map(process => process.name).sort(), ['esbuild.exe', 'node.exe']);
assert.equal(lifecycle.futureWholeProducerNotReplayed, true);
const mainFile = 'docs/evidence/T20/postgres-speaker-focus/runtime/preservation-operations-metrics-final.json';
const main = read(mainFile);
assert.equal(main.result, 'PASS');
assert.equal(main.originalBusinessRows, 3310);
assert.equal(main.missingOrChangedOriginalBusinessRows, 0);
assert.equal(main.bothOriginalKeysExact, true);
assert.equal(main.removedObservedExpiredAuthenticationRows, 8);
assert.equal(main.expiredSessionsRestored, false);
assert.equal(main.mainRestartedForThisIncrement, false);
assert.equal(main.postgresRuntimeVersion, 126);

const backlog = read('docs/backlog.json');
assert.equal(backlog.requirements.length, 134);
assert.equal(backlog.tasks.length, 38);
assert.equal(backlog.capabilityGroups.length, 26);
assert.equal(backlog.tasks.filter(task => task.status === 'verified').length, 27);
assert.equal(backlog.tasks.filter(task => task.status === 'pending').length, 9);
assert.deepEqual(backlog.tasks.filter(task => task.status === 'in_progress').map(task => task.id).sort(), ['T20', 'T35']);
assert.equal(backlog.tasks.find(task => task.id === 'T16').status, 'verified');

if (mode === 'documents') {
  const note = '2026-11-26 增量127跨场景运营检查点：SQLite与原生PG管理员看板已接通，15统计对象/11场景、上海7/30/90自然日、当前资产和成员登记、UTC核心任务额度、分类型币种的已知费用及未知覆盖、实际JSON下载。原生未迁移模块保持不可用/total=null，不冒充零；仅核心provider_usage，不声明正式账单或席位权益。33不同后端检查/4文件（10单元+10 SQLite+12原生+1迁移，其余44迁移未执行），10编译按1+4+2+3和8类GUI按7+1分阶段有通过证据；样式变更2项视觉复查不增加类别数。原始proof FAIL全部保留：200/201预期、撤权后控件已移除和手机100px全局约束已按原隔离库接续；最终内部关闭检查提前包含验证器Node及esbuild，异常路径二次finish日志碰撞保留，退出后独立严格核对4根/16端口/178捕获创建身份，私有进程和监听0。没有重做原工程/任务/权限收紧；实际worker一次回执和两API/PG重启后495表、两原密钥及81当前编译保持。当前类型/lint/构建/OpenAPI生成通过，文档检查随后记录。129首次提交后冻结，原生001—129/runtime126/下一130及SQLite052/下一053。主33223四原进程、3310原业务行和两密钥保持，8自然过期登录未复活，不重启不切库。套餐/席位权益/货架/SSO/品牌嵌入/开放SDK/Webhook/全模块费用与渠道效果/正式计费部署继续，T20完整恢复核对与生产启用仍未完成。全134/38/65/26保留，27本地verified、T20与T35 in_progress、9 pending，G2与目标active。见docs/127-operations-metrics.md。';
  const task = backlog.tasks.find(task => task.id === 'T35');
  for (const item of [task, ...backlog.requirements.filter(requirement => start.requirements.includes(requirement.id))]) {
    assert.ok(!String(item.progressNotes).includes('增量127跨场景运营检查点'));
    item.progressNotes = (item.progressNotes || '') + '\n' + note;
    for (const file of [stagedFile, auditFile, root + '/lifecycle-resolution.json', root + '/visual-review.json', 'docs/127-operations-metrics.md']) {
      if (!item.evidence.includes(file)) item.evidence.push(file);
    }
    if (item.id.startsWith('R-')) {
      item.status = 'in_progress';
      item.localStatus = 'in_progress';
      // Real deployments and full sources have not been exercised in this phase.
      item.liveStatus = 'planned';
    }
  }
  fs.writeFileSync('docs/backlog.json', JSON.stringify(backlog, null, 2) + '\n');
  let plan = fs.readFileSync('PLAN.md', 'utf8');
  plan = plan.replace(/当前增量：[^\n]*/, () => '当前增量：127，T35跨场景运营看板本地已验。33后端检查、10编译检查和8类GUI分阶段取得通过证据，原FAIL与独立退出后关闭核对均保留。套餐/席位/SSO/全成本及真实运营、T20完整恢复与生产启用和全平台G2/目标继续。');
  const anchor = '\n2026-11-26 增量127开始：';
  assert.ok(plan.includes(anchor));
  fs.writeFileSync('PLAN.md', plan.replace(anchor, () => '\n' + note + '\n' + anchor));
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.ok(!readme.includes('[跨场景运营看板]'));
  fs.writeFileSync('README.md', readme.replace('# DigitalGuide 数字人平台', () => '# DigitalGuide 数字人平台\n\n[跨场景运营看板](docs/127-operations-metrics.md)：管理员可查看15类记录、资产/成员登记、核心额度和分币种费用覆盖，筛选7/30/90天并下载快照。33后端、10编译与8类GUI分阶段已验，495表/两密钥/81编译重启保持；原FAIL与独立关闭核对保留。真实计费、套餐/SSO和完整T35/G2继续，主工作台未重启切库；查看新功能需使用文档中的独立副本启动方式。'));
  fs.appendFileSync('docs/02-architecture.md', '\n\n### 增量127：跨场景运营聚合与未知费用\n\n[运营看板](127-operations-metrics.md)使用同一共享投影在SQLite及原生PG中汇总15个统计对象，不读取私人正文。SQL129增加API专用STABLE聚合接口，函数再次校验当前认证会话、管理员/租户/空间与有界日期；worker不能调用，私人表SELECT不扩大。上海自然日与UTC核心额度分列，当前资产登记不混入期间新增；未迁移对象为null而非零，费用仅按核心回执的类型/单位/币种汇总，缺额保持未知且billingVerified=false。前端按用户/租户/空间/天数绑定读取，撤权和迟到响应不保留旧统计/下载；老API不宣告功能则隐藏入口。129首次提交冻结，001—129/runtime126/下一130及SQLite052/下一053保持；正式计费、套餐/SSO、其他来源和全平台生产治理继续。\n');
  fs.appendFileSync('docs/04-roadmap-acceptance.md', '\n\n2026-11-26 增量127：[跨场景运营看板](127-operations-metrics.md)对AC-56的用量部分和AC-58取得本地阶段证据：33不同后端检查/4文件、10不同编译检查按1+4+2+3与8类GUI按7+1；未迁移模块不可用、未知费用不归零、跨空间迟到响应/当前撤权、真实快照下载及495表/两密钥/81编译和两API/PG重启保持。原FAIL与退出前Node/esbuild生命周期误判保留，独立退出后核对4根/16端口/178捕获身份、私有进程/监听0；主工作台不重启切库。此证据不关闭完整AC-56/AC-58或T35：套餐/席位/权益、货架、SSO、嵌入/API/Webhook、全部场景指标成本与正式计费仍需完成；T20完整恢复和生产启用、G2与134/38/65/26范围继续，27本地verified、T20/T35进行中、9任务pending。\n');
  write(root + '/completed-implementation-checkpoint.json', {
    result: 'PASS_STAGED_WORKSPACE_OPERATIONS_METRICS_IMPLEMENTATION',
    checkedAt: new Date().toISOString(),
    distinctBackendChecks: 33, automatedTestFiles: 4, compiledChecks: 10, guiFlows: 8,
    compiledStages: [1, 4, 2, 3], guiStages: [7, 1],
    originalProducerFailuresPreserved: true, independentPostExitClosurePassed: true,
    wholeT35Complete: false, realBilling: false, productionAccepted: false,
    goal: 'active', documentationChecksPending: true
  });
} else {
  const documentationChecks = ['operations-final-docs-build', 'operations-final-docs-check'];
  for (const label of documentationChecks) assert.equal(read(root + '/' + label + '-command.json').result, 'PASS', label);
  const sourceSHA256 = {};
  const snapshotSource = (file, sha) => {
    assert.equal(hash(file), sha, file);
    const snapshot = root + '/sources/' + sha + '/' + path.basename(file);
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    if (fs.existsSync(snapshot)) assert.equal(hash(snapshot), sha);
    else fs.copyFileSync(file, snapshot, fs.constants.COPYFILE_EXCL);
    sourceSHA256[file] = sha;
  };
  for (const binding of read(root + '/operations-final-docs-check-command.json').bindings) snapshotSource(binding.file, binding.sha256);
  for (const [file, sha] of Object.entries(parent.sourceSHA256)) if (!(file in sourceSHA256)) snapshotSource(file, sha);
  snapshotSource('apps/web/src/operations/operations.css', hash('apps/web/src/operations/operations.css'));
  const documents = {};
  for (const file of new Set([...Object.keys(parent.documents), 'docs/127-operations-metrics.md'])) documents[file] = hash(file);
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return ['sources', 'parent-documents'].includes(entry.name) ? [] : walk(path.join(directory, entry.name));
    return entry.isFile() ? [path.join(directory, entry.name).replaceAll('\\', '/')] : [];
  });
  const evidenceSHA256 = {};
  for (const file of walk(root)) if (!file.endsWith('/verification.json') && !file.endsWith('/final-hash-audit.json')) evidenceSHA256[file] = hash(file);
  evidenceSHA256[mainFile] = hash(mainFile);
  const verificationFile = root + '/verification.json';
  write(verificationFile, {
    result: 'PASS_STAGED_WORKSPACE_OPERATIONS_METRICS', checkedAt: new Date().toISOString(),
    parentFile: start.parentFile, parentSHA256: start.parentSHA256,
    previousGoalTurnClassification: 'progress', currentGoalTurnClassification: 'progress',
    goalStatus: 'active', phaseStillOpen: false, scope: start.scope, requirements: start.requirements,
    task: 'T35', taskStatus: 'in_progress', distinctBackendChecks: 33, automatedTestFiles: 4,
    stagedCases: cases, migrationTargetChecks: 1, migrationSkippedCases: 44,
    repeatedSqliteAliasCheckNotCounted: 1, compiledChecks: 10, compiledStages: [1, 4, 2, 3],
    guiChecks: 8, guiStages: [7, 1], visualRerunsForChangedPresentation: 2,
    originalProducerFailuresPreserved: true, originalInternalProducerResult: 'FAIL',
    internalLifecycleCause: 'Pre-exit closure check included the live verifier Node process and its esbuild service; independent post-exit closure passed.',
    originalSecondFinishLogCollisionPreserved: true, correctedWholeProducerNotReplayed: true,
    checks: [...technicalChecks, ...documentationChecks], sourceSHA256, documents, evidenceSHA256,
    proofFile: stagedFile, proofSHA256: hash(stagedFile), compiledFileManifest: proofRoot + '/compiled-file-sha256.json',
    currentCompiledRoot: staged.currentCompiledRoot, runtime: 126,
    lastFrozenMigration: registry.migrations.at(-1).name, nextMigration: '130',
    sqliteMigration: '052', nextSqliteMigration: '053', restartNativeTables: 495,
    originalKeys: 2, compiledFiles: 81, metricsObjects: 15, scenes: 11,
    sqliteAndNative: true, aggregateOnlyNoPrivateBodies: true, adminAndTenantWorkspaceIsolation: true,
    unavailableNotZero: true, unknownCostNotZero: true, costScope: 'core_provider_usage_only',
    billingVerified: false, realBilling: false, actualWorkerUsageReceipts: 1,
    originalTaskRepeated: false, originalProjectsRecreated: false, originalRevocationRepeated: false,
    originalCookiePreservedThroughRestart: true, currentDesktopAnd390pxVisuallyReviewed: true,
    strictClosure: { file: auditFile, sha256: hash(auditFile), roots: audit.roots, ports: audit.ports,
      creationIdentities: audit.creationIdentities, privateProcesses: 0, privateListeners: 0,
      unitFixturePidCreationCoverageClaimed: false },
    mainPreservation: mainFile, mainPreservationSHA256: hash(mainFile),
    removedObservedExpiredOriginalAuthenticationRows: 8, mainRestarted: false, mainCutOver: false,
    earlierSealedRootsReactivated: false, wholeT35Complete: false, wholeT20Complete: false,
    productionAccepted: false, remaining: [
      '套餐、购买席位和权益、资产货架、真实SSO生命周期、品牌嵌入和开放API/SDK/Webhook',
      '全部场景指标和费用来源、渠道效果、正式账单与生产部署',
      '原生尚未迁移业务模块和当前身份/独立隐私授权/可信业务回执的完整恢复核对',
      '受控升级、运维收据跨备份复制、生产见证和明确启用',
      '真实形象/声音/语气、现场音视频/识别设备与渠道及全平台G2'
    ]
  });
  let fileHashesVerified = 0;
  for (const map of [sourceSHA256, documents, evidenceSHA256]) for (const [file, sha] of Object.entries(map)) {
    assert.equal(hash(file), sha, file); fileHashesVerified++;
  }
  for (const [file, sha] of Object.entries(compiled)) {
    assert.equal(hash(path.join(staged.currentCompiledRoot, file)), sha, file); fileHashesVerified++;
  }
  write(root + '/final-hash-audit.json', {
    result: 'PASS_OPERATIONS_METRICS_FINAL_HASH_BINDINGS', checkedAt: new Date().toISOString(),
    fileHashesVerified, verificationSHA256: hash(verificationFile), distinctBackendChecks: 33,
    compiledChecks: 10, guiChecks: 8, goal: 'active', goalTurnClassification: 'progress'
  });
}
console.log(JSON.stringify({ mode, result: 'PASS', distinctBackendChecks: 33, compiledChecks: 10, guiChecks: 8, runtime: 126, nextMigration: '130', goal: 'active' }));
