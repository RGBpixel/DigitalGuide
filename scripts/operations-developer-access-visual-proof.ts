import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { NativeContentProofRuntime, proofHash } from './postgres-content-proof-runtime.js';
import { MemoryProof } from './native-guest-memory-proof-helpers.js';
import { observeRecoveryClusters } from './native-recovery-owned.js';
import type { DeveloperMutationResult } from '../packages/contracts/src/index.js';
const base = 'docs/evidence/T35/developer-access', c = await NativeContentProofRuntime.create(base + '/developer-visual-compiled'), h = new MemoryProof(c), w = '20000000-0000-4000-8000-000000000001';
let finishing = false;
try {
  await c.prepare({ contentModels: false });
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const compiled = Object.fromEntries(walk('dist').map(f => [f.replaceAll('\\', '/'), proofHash(f)])); c.save('compiled-file-sha256.json', compiled);
  const prior = JSON.parse(fs.readFileSync(base + '/developer-compiled/compiled-file-sha256.json', 'utf8')) as Record<string, string>; let serverFiles = 0;
  for (const [file, sha] of Object.entries(compiled)) if (!file.startsWith('dist/web/')) { assert.equal(prior[file], sha, file); serverFiles++; }
  const created = await c.good<DeveloperMutationResult>('/enterprise/developers/create', { workspaceId: w, name: '合成开发者视觉样本', scopes: ['projects.read', 'exports.read'], confirmed: true });
  const app = created.view.apps[0], issued = await c.good<DeveloperMutationResult>('/enterprise/developers/issue', { workspaceId: w, appId: app.id, expectedVersion: app.version, termDays: 30, confirmed: true });
  const secret = issued.issuedCredential!.oneTimeToken!; c.secrets.push(secret, secret.split('.')[1]);
  fs.writeFileSync(path.join(c.cluster.root, 'developer-visual-state.private.json'), JSON.stringify({ appId: app.id, credentialId: issued.issuedCredential!.id, secret, admin: { cookie: c.cookie, headers: c.headers } }, null, 2) + '\n', { mode: 0o600 });
  await h.web(); const page = await h.page(await h.context(c.cookie)); await page.goto(h.origin + '/enterprise/developers'); await expect(page.getByRole('button', { name: '刷新状态', exact: true })).toBeEnabled();
  const card = page.locator('[data-developer-app-id="' + app.id + '"]'); await expect(card).toContainText('合成开发者视觉样本'); await expect(page.getByLabel('新签发的应用密钥', { exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await h.shot(page, 'developer-styled-desktop'); h.gui.push('current_98_file_web_build_renders_padded_desktop_cards_buttons_and_metadata_without_plaintext');
  await page.setViewportSize({ width: 390, height: 844 }); await card.getByRole('button', { name: '配置应用', exact: true }).click(); const dialog = page.getByRole('dialog'); await expect(dialog.getByLabel('我已核对当前空间、应用和操作范围', { exact: true })).not.toBeChecked(); await expect(dialog.getByRole('button', { name: '确认保存配置', exact: true })).toBeDisabled();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await dialog.getByRole('button', { name: '取消', exact: true }).scrollIntoViewIfNeeded(); await h.shot(page, 'developer-styled-mobile'); await dialog.getByRole('button', { name: '取消', exact: true }).click(); h.gui.push('current_390px_dialog_retains_styles_unselected_confirmation_and_reachable_cancel');
  assert.deepEqual(h.errors, []); assert.ok((await h.devices()).every(v => v.calls === 0));
  for (const [file, sha] of Object.entries(compiled)) { assert.equal(proofHash(file), sha, file); assert.equal(proofHash(path.join(c.compiledRoot, file)), sha, file); }
  for (const p of c.running) for (const value of c.secrets.filter(s => s.length >= 16)) assert.ok(!p.stdout().includes(value) && !p.stderr().includes(value), 'Private credential in process log');
  c.save('developer-visual-summary.json', { result: 'PASS', guiFlows: h.gui, priorBusinessAndGuiRootReopened: false, priorBusinessChecksRepeated: false, setupUsesNewSyntheticApplication: true, unchangedServerCompiledFiles: serverFiles, compiledFiles: Object.keys(compiled).length, webFiles: Object.keys(compiled).filter(f => f.startsWith('dist/web/')).length, workerStarted: false, contentModelsRead: false, wholeG2Complete: false });
  await observeRecoveryClusters(base + '/observed-developer-visual-live.json', [process.pid, ...c.roots, ...c.cluster.observedPids], c.web); await h.close(); await c.observe('observed-developer-visual-final'); finishing = true; await c.finish(); console.log(JSON.stringify({ result: 'PASS_CURRENT_DEVELOPER_VISUAL_BUILD', guiChecks: h.gui.length, unchangedServerCompiledFiles: serverFiles }));
} catch (error) { if (finishing) throw error; try { await observeRecoveryClusters(base + '/observed-developer-visual-failure.json', [process.pid, ...c.roots, ...c.cluster.observedPids], c.web); } finally { await h.close(); finishing = true; await c.finish(error); } }
