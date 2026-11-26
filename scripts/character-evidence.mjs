// Records existing test/process/media evidence; does not execute tests or change task states.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = process.cwd(), folder = 'docs/evidence/T23';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const backendFiles = [folder + '/full-backend-results.json', folder + '/final-core-results.json'];
const browserFiles = [folder + '/browser-final/e2e-results.json', folder + '/browser-regression-fixed/e2e-results.json', folder + '/browser-characters-final/e2e-results.json'];
const backendCases = new Map(), browserCases = new Map();
const backend = backendFiles.map(file => {
  const report = read(file);
  assert.equal(report.success, true);
  for (const suite of report.testResults) {
    for (const test of suite.assertionResults) {
      backendCases.set(path.relative(root, suite.name).replaceAll('\\', '/') + '::' + test.fullName, test.status);
    }
  }
  return { file, passed: report.numPassedTests, failed: report.numFailedTests, total: report.numTotalTests };
});
function scan(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests) {
        browserCases.set(spec.file + '::' + spec.title + '::' + test.projectName, test.results.at(-1)?.status);
      }
    }
    scan(suite.suites || []);
  }
}
const browser = browserFiles.map(file => {
  const report = read(file);
  scan(report.suites);
  return { file, passed: report.stats.expected, failed: report.stats.unexpected, flaky: report.stats.flaky, skipped: report.stats.skipped };
});
assert.equal(backendCases.size, 429);
assert.equal(browserCases.size, 54);
assert.ok([...backendCases.values()].every(status => status === 'passed'));
assert.ok([...browserCases.values()].every(status => status === 'passed'));

const compiled = read(folder + '/compiled-final/proof.json');
assert.equal(compiled.result, 'PASS');
for (const [file, sha] of Object.entries(compiled.sourceHashes)) assert.equal(digest(file), sha, 'Compiled proof source changed: ' + file);
for (const file of compiled.delivery.artifacts) assert.equal(digest(file.file), file.sha256, 'Delivery bytes changed: ' + file.file);
assert.equal(compiled.ownedProcessExits.length, 8);
const runtime = read(folder + '/runtime/runtime.json');
assert.equal(runtime.result, 'PASS_LOCAL_CHARACTER_RUNTIME');
for (const [file, sha] of Object.entries(runtime.sourceHashes)) assert.equal(digest(file), sha, 'Runtime source changed: ' + file);
assert.equal(runtime.checks.length, 15);
const preview = read(folder + '/runtime/preview.json');
assert.equal(preview.result, 'PASS_LOCAL_CHARACTER_PREVIEW');
const screenshot = read(folder + '/runtime/screenshots/verification.json');
assert.equal(screenshot.result, 'PASS_LOCAL_CHARACTER_BROWSER');
assert.deepEqual(screenshot.pageErrors, []);
const preservation = read(folder + '/runtime/preservation-assessment-final.json');
assert.equal(preservation.missingOrChangedOriginalBusinessRows, 0);
assert.equal(preservation.originalBusinessRows, 704);
assert.equal(preservation.removedAuthenticationRows, 8);
assert.equal(preservation.allRemovedAuthenticationRowsObservedExpired, true);
const legacy = ['legacy-restaurant/runtime.json', 'legacy-orders/preview.json', 'legacy-billing/preview.json', 'legacy-voice/preview.json'].map(name => {
  const file = folder + '/runtime/' + name, report = read(file);
  assert.ok(report.result.startsWith('PASS'));
  return { file, result: report.result };
});
const docFile = folder + '/documentation-check.json';
const documentation = fs.existsSync(docFile) ? read(docFile) : { result: 'NOT_YET_RECORDED' };
if (documentation.result !== 'NOT_YET_RECORDED') assert.equal(documentation.result, 'PASS');
const sourceFiles = [
  'migrations/sqlite/024-character-motion.sql',
  'packages/contracts/src/character.ts', 'packages/contracts/src/character-openapi.ts', 'packages/contracts/src/index.ts',
  'packages/domain/src/character-motion.ts', 'packages/domain/src/index.ts', 'packages/database/src/index.ts',
  'packages/media/src/character-glb.ts', 'packages/media/src/character-puppet.ts', 'packages/media/src/character-quality.ts', 'packages/media/src/character-video.ts',
  'apps/api/src/character-service.ts', 'apps/api/src/character-motion-plans.ts', 'apps/api/src/character-jobs.ts', 'apps/api/src/character-routes.ts',
  'apps/api/src/asset-consent-actions.ts', 'apps/api/src/app.ts',
  'apps/worker/src/character-jobs.ts', 'apps/worker/src/main.ts',
  'apps/web/src/studio/CharacterLibrary.tsx', 'apps/web/src/studio/CharacterProduction.tsx', 'apps/web/src/studio/CharacterShared.tsx',
  'apps/web/src/studio/CharactersPage.tsx', 'apps/web/src/studio/character.css', 'apps/web/src/studio/StudioPage.tsx', 'apps/web/src/App.tsx',
  'scripts/character-compiled-proof.ts', 'scripts/character-preview-check.ts', 'scripts/character-preview-browser.ts', 'scripts/character-preview-runtime.ts',
  'scripts/character-evidence.mjs', 'tests/e2e/characters.spec.ts', 'tests/e2e/timeline.spec.ts',
  'docs/22-character-motion.md', 'README.md', 'PLAN.md', 'docs/backlog.json', 'docs/01-product-design.md', 'docs/02-architecture.md',
  'docs/03-data-api.md', 'docs/04-roadmap-acceptance.md', 'scripts/build-docs.mjs', 'docs/07-requirements-traceability.md',
  'docs/08-competitor-capability-matrix.md', 'DigitalGuide-平台建设总文档.md', 'docs/api/openapi.json'
];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file.replaceAll('\\', '/')];
  });
}
const evidenceFiles = walk(folder).filter(file => file !== folder + '/verification.json');
const manifest = {
  task: 'T23',
  result: documentation.result === 'PASS' ? 'VERIFIED_LOCAL_SCOPE' : 'APPLICATION_VERIFIED_DOCUMENTATION_PENDING',
  recordedAt: new Date().toISOString(),
  requirements: ['R-068', 'R-069', 'R-070', 'R-071'],
  acceptance: ['AC-33', 'AC-34'],
  scope: '四类来源、独立形象用途、变体/修订、实际素材检查、明确模拟准备、静态GLB、原创二维动作/幅度开合口及实际时间线/有声成片；不替代T31或完整G1/G2。',
  checks: {
    backendPhases: backend,
    distinctBackendCasesWithPassingEvidence: backendCases.size,
    browserPhases: browser,
    distinctBrowserCasesWithPassingEvidence: browserCases.size,
    phaseBoundary: '完整428后端通过后新增区间保留用例，最终相关23通过；完整浏览器53通过/1登录等待失败，修正等待后6通过，末轮形象4通过。不是一次429/54全量通过。',
    statics: [
      { command: 'pnpm typecheck', exitCode: 0, evidence: 'terminal execution observed in this task after final runtime script' },
      { command: 'pnpm lint', exitCode: 0, evidence: 'terminal execution observed in this task' },
      { command: 'pnpm api:spec', exitCode: 0, evidence: 'terminal execution observed in this task; generated spec hashed below' },
      { command: 'pnpm build', exitCode: 0, evidence: 'owned terminal session 70604 exited 0; current compiled source hashes matched' }
    ],
    compiled: {
      file: folder + '/compiled-final/proof.json',
      enqueueStatuses: compiled.enqueueStatuses,
      singleActiveTask: compiled.singleActiveTask,
      crash: compiled.crash,
      pairedEffects: compiled.pairedEffects,
      nativeVideo: compiled.nativeVideo,
      deliveryResolution: [1920, 1080],
      explicitCompiledReplayByteIdentical: compiled.delivery.explicitCompiledReplayByteIdentical,
      regularWorkerMediaChild: compiled.delivery.regularWorkerMediaChild,
      restart: compiled.restart,
      sourceRevocation: compiled.sourceRevocation,
      ownedProcessExits: compiled.ownedProcessExits.length
    },
    runtime: { file: folder + '/runtime/runtime.json', checks: runtime.checks.length, sessionHandle: runtime.sessionHandle, schema: '024', ports: [4301, 5174], loopbackOnly: true },
    browserPreview: { file: folder + '/runtime/screenshots/verification.json', decodedMotionVideo: screenshot.decodedMotionVideo, decodedAssociatedSystemVoice: screenshot.decodedAssociatedSystemVoice, desktop: screenshot.desktop, mobile: screenshot.mobile, pageErrors: [] },
    preservation: {
      file: folder + '/runtime/preservation-assessment-final.json',
      rawFile: folder + '/runtime/after-final.json',
      rawFullTableResult: preservation.rawFullTableResult,
      businessTables: preservation.businessTables,
      originalBusinessRows: preservation.originalBusinessRows,
      missingOrChangedOriginalBusinessRows: 0,
      removedExpiredAuthenticationRows: preservation.removedAuthenticationRows,
      limitation: preservation.explanation
    },
    legacy,
    documentation: { file: docFile, ...documentation }
  },
  preview: { url: preview.preview, login: '林知 · 管理员；品牌与接待', projectId: preview.projectId, video: preview.video },
  notClaimed: [
    '照片/视频/真人克隆或真实3D/骨骼驱动',
    '真人声音/参考语气迁移、逐音素口型、信噪比和真人复刻质量',
    '动作MP4透明背景或自动去底、克隆模型迁移',
    '真实声纹、目标声音提取或现场多人抗噪',
    '真实摄像头/麦克风采集、通知、订单外部系统、支付、直播、发布或投放',
    '整个G1/G2或持续开发目标完成'
  ],
  remainingExternalConditions: ['T31引擎/账号/授权参考素材/兼容模型', 'T17/T31真人声音和语气供应商', 'T38麦克风/扬声器/适用SDK/授权混合音频与现场测试条件'],
  fullGoalStatus: 'active',
  nextTask: 'T24',
  sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, digest(file)])),
  evidenceHashes: Object.fromEntries(evidenceFiles.map(file => [file, digest(file)]))
};
fs.writeFileSync(folder + '/verification.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ result: manifest.result, backendCases: backendCases.size, browserCases: browserCases.size, evidenceFiles: evidenceFiles.length, sources: sourceFiles.length, documentation: documentation.result }));
