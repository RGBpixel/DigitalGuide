// Archives this submodule's actual checks. It never marks the full T24 task or goal complete.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const folder='docs/evidence/T24/content-sources',read=p=>JSON.parse(fs.readFileSync(p,'utf8')),hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const backend=read(folder+'/final-related-backend.json');assert.equal(backend.success,true);assert.equal(backend.numPassedTests,41);assert.equal(backend.numFailedTests,0);
const browserPaths=['browser-first/e2e-results.json','browser-fixed/e2e-results.json','browser-final/e2e-results.json'],cases=new Map();
function walkSuites(suites){for(const suite of suites){for(const spec of suite.specs||[])for(const test of spec.tests)cases.set(spec.file+'::'+spec.title,test.results.at(-1)?.status);walkSuites(suite.suites||[]);}}
const browser=browserPaths.map(name=>{const file=folder+'/'+name,report=read(file);walkSuites(report.suites);return{file,passed:report.stats.expected,failed:report.stats.unexpected,flaky:report.stats.flaky};});
assert.equal(cases.size,8);assert.ok([...cases.values()].every(status=>status==='passed'));
const runtime=read(folder+'/runtime/preview.json'),restart=read(folder+'/runtime/restart.json'),screen=read(folder+'/runtime/screenshots/verification.json'),preservation=read(folder+'/runtime/preservation-assessment.json'),web=read(folder+'/public-web.json');
assert.equal(runtime.result,'PASS_CONTENT_SOURCE_SUBMODULE_RUNTIME');assert.equal(runtime.sessionHandle,'75997');assert.equal(runtime.checks.length,11);
assert.equal(restart.result,'PASS_CONTENT_SOURCE_RESTART');assert.equal(screen.result,'PASS_READ_ONLY_MAIN_CONTENT_BROWSER');assert.equal(web.result,'PASS_PUBLIC_HTTPS_STATIC_FETCH');
assert.equal(preservation.originalBusinessRows,803);assert.equal(preservation.missingOrChangedOriginalBusinessRows,0);assert.equal(preservation.allRemovedAuthenticationRowsObservedExpired,true);
assert.equal(preservation.removedAuthenticationRows,13);
const legacy=['legacy-restaurant/runtime.json','legacy-orders/preview.json','legacy-billing/preview.json'].map(name=>{const file=folder+'/runtime/'+name,report=read(file);assert.ok(report.result.startsWith('PASS'));return{file,result:report.result};});
const documentationFile=folder+'/documentation-check.json',documentation=fs.existsSync(documentationFile)?read(documentationFile):{result:'NOT_YET_RECORDED'};
if(documentation.result!=='NOT_YET_RECORDED')assert.equal(documentation.result,'PASS');
const sources=[
  'migrations/sqlite/025-content-sources.sql','packages/contracts/src/content.ts','packages/contracts/src/content-openapi.ts','packages/contracts/src/index.ts',
  'packages/media/src/content-text.ts','packages/media/src/content-web.ts','packages/test-fixtures/src/content.ts',
  'apps/api/src/content-sources.ts','apps/api/src/content-source-routes.ts','apps/api/src/app.ts',
  'apps/web/src/studio/ContentSourcesPage.tsx','apps/web/src/studio/content.css','apps/web/src/studio/StudioPage.tsx','apps/web/src/studio/shared.tsx',
  'tests/unit/content-sources.test.ts','tests/integration/content-sources.test.ts','tests/e2e/content-sources.spec.ts',
  'scripts/content-source-preview.ts','scripts/content-source-preview-browser.ts','scripts/content-source-web-check.ts','scripts/content-source-evidence.mjs',
  'dist/api.mjs','dist/worker.mjs','dist/web/index.html','docs/api/openapi.json','docs/23-content-workbench.md',
  'docs/backlog.json','README.md','PLAN.md','docs/01-product-design.md','docs/02-architecture.md','docs/03-data-api.md','docs/04-roadmap-acceptance.md',
  'scripts/build-docs.mjs','DigitalGuide-平台建设总文档.md','docs/07-requirements-traceability.md','docs/08-competitor-capability-matrix.md'
];
assert.ok(fs.readFileSync('dist/api.mjs','utf8').includes('/studio/content/sources'));
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name).replaceAll('\\','/')]);}
const evidence=files(folder).filter(p=>p!==folder+'/verification.json');
const report={
  task:'T24',submodule:'content_sources_and_manual_briefs',result:'PASS_SUBMODULE_TASK_IN_PROGRESS',recordedAt:new Date().toISOString(),
  requirements:['R-072','R-073'],fullTaskRequirements:['R-072','R-073','R-074','R-076','R-078','R-079','R-080','R-127'],
  acceptanceBoundary:'Source capture/manual brief progress only; full AC-35/36/37 remain incomplete.',
  checks:{
    backend:{file:folder+'/final-related-backend.json',passed:41,total:41,files:backend.testResults.length,scope:'5 content unit + 7 content integration + 6 access integration + 5 character unit + 18 character integration'},
    browserPhases:browser,distinctBrowserCasesWithPassingEvidence:cases.size,
    failuresRetained:'First browser 6 passed/2 new locator failures; final new 2 passed. Early backend parse/test-schema failures and one main-browser populated-textarea locator failure retained. No failed run is relabeled passing.',
    statics:[{command:'pnpm lint',exitCode:0},{command:'pnpm typecheck',exitCode:0},{command:'pnpm api:spec',exitCode:0},{command:'pnpm build',exitCode:0,terminalSession:39052}],
    publicWeb:{file:folder+'/public-web.json',...web},runtime:{file:folder+'/runtime/preview.json',checks:runtime.checks.length,sessionHandle:runtime.sessionHandle,schema:'025',loopbackOnly:true},
    restart:{file:folder+'/runtime/restart.json',...restart},browserPreview:{file:folder+'/runtime/screenshots/verification.json',...screen},
    preservation:{file:folder+'/runtime/preservation-assessment.json',rawFile:folder+'/runtime/after-final.json',rawResult:preservation.rawFullTableResult,businessTables:154,businessRows:803,businessMissing:0,expiredAuthenticationRowsRemoved:13,limitation:preservation.explanation},
    legacy,documentation:{file:documentationFile,...documentation}
  },
  preview:{url:runtime.preview,login:runtime.login,sourceIds:runtime.sourceIds,briefId:runtime.briefId},
  taskStatus:'in_progress',fullGoalStatus:'active',verifiedTaskCount:21,
  notImplemented:['editable script drafts and multiple variants','reviewed generation plans','chat-based partial project edits','screen/camera/teleprompter recording','media processing task pipeline','real ASR/model writing/eye correction/tracking/restoration'],
  remainingConditions:'Continue independent T24 implementation; real model algorithms need appropriate engines/accounts/licensed material. Real speaker focus and noisy reception validation remain T38.',
  noRealBusinessOrDevicesExecuted:true,
  sourceHashes:Object.fromEntries(sources.map(p=>[p,hash(p)])),
  evidenceHashes:Object.fromEntries(evidence.map(p=>[p,hash(p)]))
};
fs.writeFileSync(folder+'/verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result:report.result,backend:41,browserCases:cases.size,sources:sources.length,evidence:evidence.length,documentation:documentation.result}));
