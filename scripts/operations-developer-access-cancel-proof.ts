import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect, type Route } from '@playwright/test';
import type { DeveloperMutationResult } from '../packages/contracts/src/index.js';
import { NativeContentProofRuntime, proofBounded, proofHash } from './postgres-content-proof-runtime.js';
import { MemoryProof } from './native-guest-memory-proof-helpers.js';
import { observeRecoveryClusters } from './native-recovery-owned.js';
const base = 'docs/evidence/T35/developer-access', c = await NativeContentProofRuntime.create(base + '/developer-cancel-compiled'), h = new MemoryProof(c), w = '20000000-0000-4000-8000-000000000001';
let finishing = false;
try {
  await c.prepare({ contentModels: false });
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const compiled = Object.fromEntries(walk('dist').map(f => [f.replaceAll('\\', '/'), proofHash(f)])); c.save('compiled-file-sha256.json', compiled);
  const prior = JSON.parse(fs.readFileSync(base + '/developer-compiled/compiled-file-sha256.json', 'utf8')) as Record<string, string>; let unchangedServerFiles = 0;
  for (const [file, sha] of Object.entries(compiled)) if (!file.startsWith('dist/web/')) { assert.equal(prior[file], sha, file); unchangedServerFiles++; }
  const created = await c.good<DeveloperMutationResult>('/enterprise/developers/create', { workspaceId: w, name: '合成取消签发样本', scopes: ['projects.read'], confirmed: true }), app = created.view.apps[0];
  await h.web(); const page = await h.page(await h.context(c.cookie)); await page.goto(h.origin + '/enterprise/developers'); await expect(page.getByRole('button', { name: '刷新状态', exact: true })).toBeEnabled();
  let held: Route | undefined, response: Awaited<ReturnType<Route['fetch']>> | undefined, credentialId = '', notify = () => {};
  const fetched = new Promise<void>(resolve => { notify = resolve; });
  await page.context().route('**/api/v1/enterprise/developers/issue', async route => {
    held = route; response = await route.fetch(); assert.equal(response.status(), 200);
    const result = (await response.json() as { data: DeveloperMutationResult }).data, secret = result.issuedCredential!.oneTimeToken!; credentialId = result.issuedCredential!.id; c.secrets.push(secret, secret.split('.')[1]);
    fs.writeFileSync(path.join(c.cluster.root, 'developer-cancel-state.private.json'), JSON.stringify({ appId: app.id, credentialId, secret, key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() }, null, 2) + '\n', { mode: 0o600 }); notify();
  });
  const card = page.locator('[data-developer-app-id="' + app.id + '"]'); await card.getByRole('button', { name: '签发凭证', exact: true }).click(); await page.getByRole('dialog').getByLabel('我已核对当前空间、应用和操作范围', { exact: true }).check(); await page.getByRole('button', { name: '确认签发凭证', exact: true }).click(); await proofBounded(fetched, 20000, 'The actual committed credential response was not held');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await held!.fulfill({ response: response! });
  await expect(page.getByText('此操作已处理，完整密钥不会重复显示；若未保存，请撤销后重新签发。', { exact: true })).toBeVisible(); await expect(page.getByLabel('新签发的应用密钥', { exact: true })).toHaveCount(0); await expect(card.locator('[data-developer-credential-id="' + credentialId + '"]')).toContainText('有效');
  assert.equal(Number((await c.owner(db => db.query('SELECT count(*) n FROM developer_credentials WHERE app_id=$1', [app.id]))).rows[0].n), 1); assert.equal(Number((await c.owner(db => db.query("SELECT count(*) n FROM developer_events WHERE app_id=$1 AND action='credential.issued'", [app.id]))).rows[0].n), 1);
  await h.shot(page, 'developer-cancelled-disclosure'); h.gui.push('cancelled_pending_issue_does_not_reveal_late_key_or_claim_display_and_explains_revoke_reissue');
  assert.deepEqual(h.errors, []); assert.ok((await h.devices()).every(v => v.calls === 0));
  for (const [file, sha] of Object.entries(compiled)) { assert.equal(proofHash(file), sha, file); assert.equal(proofHash(path.join(c.compiledRoot, file)), sha, file); }
  for (const p of c.running) for (const secret of c.secrets.filter(s => s.length >= 16)) assert.ok(!p.stdout().includes(secret) && !p.stderr().includes(secret), 'Private credential in process log');
  c.save('developer-cancel-summary.json', { result: 'PASS', guiFlows: h.gui, compiledFiles: Object.keys(compiled).length, webFiles: Object.keys(compiled).filter(f => f.startsWith('dist/web/')).length, unchangedServerCompiledFiles: unchangedServerFiles, priorSuccessfulRootsReopened: false, originalBusinessChecksRepeated: false, oneCredentialAndOneIssueEvent: true, workerStarted: false, contentModelsRead: false, wholeG2Complete: false });
  await observeRecoveryClusters(base + '/observed-developer-cancel-live.json', [process.pid, ...c.roots, ...c.cluster.observedPids], c.web); await h.close(); await c.observe('observed-developer-cancel-final'); finishing = true; await c.finish(); console.log(JSON.stringify({ result: 'PASS_CANCELLED_DEVELOPER_DISCLOSURE', guiChecks: 1, unchangedServerCompiledFiles: unchangedServerFiles }));
} catch (error) { if (finishing) throw error; try { await observeRecoveryClusters(base + '/observed-developer-cancel-failure.json', [process.pid, ...c.roots, ...c.cluster.observedPids], c.web); } finally { await h.close(); finishing = true; await c.finish(error); } }
