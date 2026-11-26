import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, type Page, type Route } from '@playwright/test';
import type { DeveloperMutationResult, DeveloperView, Me, StudioProject, ExportPlan, StudioExport } from '../packages/contracts/src/index.js';
import { NativeContentProofRuntime, proofHash, proofBounded } from './postgres-content-proof-runtime.js';
import { MemoryProof } from './native-guest-memory-proof-helpers.js';
import { observeRecoveryClusters } from './native-recovery-owned.js';
const base = 'docs/evidence/T35/developer-access', resume = process.argv[2] === 'resume';
const priorLabel = process.argv[3] ?? 'developer-compiled', label = resume ? (process.argv[4] ?? 'developer-compiled-continued') : 'developer-compiled', audit = process.argv[5];
for (const name of [priorLabel, label]) assert.match(name, /^[a-z][a-z0-9-]+$/);
if (resume) assert.ok(audit, 'A fresh strict audit is required to continue the original failed instance');
const c = resume ? await NativeContentProofRuntime.resume(base + '/' + label, base + '/' + priorLabel + '/proof.json', undefined, { preservePortsWithAudit: audit! }) : await NativeContentProofRuntime.create(base + '/' + label);
const h = new MemoryProof(c), stateFile = path.join(c.cluster.root, 'developer-proof-state.private.json');
type Headers = { cookie: string; 'x-csrf-token': string };
type Mutation = { key: string; body: object; receiptId?: string; credentialId?: string; token?: string; status?: number };
const state: Record<string, unknown> = resume ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const done = (state.done ?? {}) as Record<string, boolean>, mutations = (state.mutations ?? {}) as Record<string, Mutation>;
const w = '20000000-0000-4000-8000-000000000001', privateW = '20000000-0000-4000-8000-000000000002';
const ack = '我已核对当前空间、应用和操作范围'; let finishing = false;
function retain() { state.done = done; state.mutations = mutations; state.admin = { cookie: c.cookie, headers: c.headers, viewerCookie: c.viewerCookie }; fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); }
async function stage(name: string, work: () => Promise<void>) { if (done[name]) return; await work(); done[name] = true; retain(); c.add(name); }
async function gui(name: string, work: () => Promise<void>) { if (done[name]) return; await work(); done[name] = true; retain(); h.gui.push(name); }
function remember(result: DeveloperMutationResult, key: string) { const issued = result.issuedCredential; if (issued?.oneTimeToken) { mutations[key].credentialId = issued.id; mutations[key].token = issued.oneTimeToken; c.secrets.push(issued.oneTimeToken, issued.oneTimeToken.split('.')[1]); } mutations[key].receiptId = result.receiptId; retain(); }
const card = (p: Page) => p.locator('[data-developer-app-id="' + state.appId + '"]');
const dialog = (p: Page) => p.getByRole('dialog');
async function ready(p: Page) { await expect(p.getByRole('heading', { name: '开发者接入', exact: true })).toBeVisible(); await expect(p.getByRole('button', { name: '刷新状态', exact: true })).toBeEnabled(); }
async function open(p: Page) { await p.goto(h.origin + '/enterprise/developers'); await ready(p); }
async function machine(suffix: string, token: string, status = 200, port = c.apiB) { const r = await c.http('/api/open/v1' + suffix, undefined, port, { authorization: 'Bearer ' + token }); assert.equal(r.status, status, 'Machine request failed: ' + suffix); return r.body.data; }
async function view() { return c.get<DeveloperView>('/enterprise/developers?workspaceId=' + w); }
async function current() { return (await view()).apps.find(app => app.id === state.appId)!; }
async function confirm(p: Page, action: string, marker: string, status = 200) {
  const request = p.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/enterprise/developers/' + action).then(r => { mutations[marker] = { key: r.headers()['idempotency-key'], body: r.postDataJSON() }; retain(); });
  const response = p.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/enterprise/developers/' + action);
  await dialog(p).getByLabel(ack, { exact: true }).check(); await dialog(p).getByRole('button', { name: /^确认/ }).click(); await request;
  const r = await response; mutations[marker].status = r.status(); retain(); assert.equal(r.status(), status, 'Developer GUI mutation failed: ' + marker);
  if (status !== 200) return undefined;
  const result = (await r.json()).data as DeveloperMutationResult; remember(result, marker);
  if (action === 'create') { state.appId = result.view.apps.find(app => app.name === '合成业务系统')!.id; retain(); }
  await expect(dialog(p)).toBeHidden(); return result;
}
async function issue(p: Page, marker: string) {
  if (mutations[marker]?.token) return;
  await card(p).getByRole('button', { name: '签发凭证', exact: true }).click(); await expect(dialog(p).getByLabel(ack, { exact: true })).not.toBeChecked();
  await confirm(p, 'issue', marker); const shown = await p.getByLabel('新签发的应用密钥', { exact: true }).inputValue();
  assert.ok(shown === mutations[marker].token, 'The first credential response was not displayed correctly');
}
async function hideSecret(p: Page) { if (await p.getByRole('button', { name: '关闭密钥显示', exact: true }).count()) await p.getByRole('button', { name: '关闭密钥显示', exact: true }).click(); await expect(p.getByLabel('新签发的应用密钥', { exact: true })).toHaveCount(0); }
async function backendRevoke(marker: string, credentialId: string) { if (mutations[marker]?.receiptId) return; const app = await current(); mutations[marker] = { key: randomUUID(), body: { workspaceId: w, appId: state.appId, credentialId, expectedVersion: app.version, confirmed: true } }; retain(); const result = await c.good<DeveloperMutationResult>('/enterprise/developers/revoke', mutations[marker].body, c.apiA, mutations[marker].key); remember(result, marker); }
try {
  if (resume) { await c.prepareResume({ skipSyntheticLogins: true }); const admin = state.admin as { cookie: string; headers: Headers; viewerCookie: string }; c.cookie = admin.cookie; c.headers = admin.headers; c.viewerCookie = admin.viewerCookie; c.secrets.push(c.cookie, c.headers['x-csrf-token'], c.viewerCookie); for (const m of Object.values(mutations)) if (m.token) c.secrets.push(m.token, m.token.split('.')[1]); assert.equal((await c.http('/api/v1/me', undefined, c.apiB, c.headers)).status, 200); }
  else await c.prepare({ contentModels: false });
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const compiled = Object.fromEntries(walk('dist').map(f => [f.replaceAll('\\', '/'), proofHash(f)])); c.save('compiled-file-sha256.json', compiled);
  await stage('actual_compiled_api_creates_current_and_private_projects_and_queued_production_export', async () => {
    if (!state.projectId) { const project = await c.good<StudioProject>('/studio/projects', { workspaceId: w, name: '合成开放接口制作工程', purpose: 'video' }); state.projectId = project.id; state.projectVersion = project.version; retain(); }
    if (!state.privateProjectId) { const project = await c.good<StudioProject>('/studio/projects', { workspaceId: privateW, name: '合成不可见内部工程', purpose: 'video' }); state.privateProjectId = project.id; retain(); }
    if (!state.exportId) { const input = { version: state.projectVersion, kind: 'video', settings: { preset: 'hd', fps: 24, transparent: false, omitBackground: false, burnSubtitles: false }, startMs: 0, durationMs: 1000 }; const plan = await c.good<ExportPlan>('/studio/projects/' + state.projectId + '/export-plan', input); assert.equal(plan.canExport, true); const exported = await c.good<StudioExport>('/studio/projects/' + state.projectId + '/exports', { ...input, planHash: plan.hash, confirmed: true, rightsConfirmed: true }); state.exportId = exported.id; retain(); }
    assert.equal((await c.get<{ status: string }>('/studio/exports/' + state.exportId)).status, 'queued');
    await observeRecoveryClusters(base + '/observed-developer-compiled-live-' + label + '.json', [process.pid, ...c.roots, ...c.cluster.observedPids], c.apiA);
  });
  await h.web(); const context = await h.context(c.cookie), page = await h.page(context); await open(page);
  await gui('current_administrator_sees_scoped_read_only_integration_boundaries_and_no_existing_credential', async () => { await expect(page.getByText('组织应用 · 仅服务端使用', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '创建应用', exact: true })).toBeEnabled(); await expect(page.getByText('当前开放工程信息和制作导出状态读取。任务提交、Webhook与品牌嵌入仍在建设。', { exact: true })).toBeVisible(); await h.shot(page, 'developer-empty-desktop'); });
  await gui('actual_application_creation_requires_unselected_acknowledgment_and_explicit_reading_scopes', async () => {
    if (!state.appId) { await page.getByRole('button', { name: '创建应用', exact: true }).click(); await dialog(page).getByLabel('应用名称', { exact: true }).fill('合成业务系统'); await dialog(page).getByLabel('读取制作导出状态', { exact: true }).check(); await expect(dialog(page).getByLabel(ack, { exact: true })).not.toBeChecked(); await expect(dialog(page).getByRole('button', { name: '确认创建应用', exact: true })).toBeDisabled(); await confirm(page, 'create', 'create'); }
    await expect(card(page)).toContainText('读取制作工程信息'); await expect(card(page)).toContainText('读取制作导出状态'); await h.shot(page, 'developer-application-desktop');
  });
  await gui('first_key_is_displayed_once_after_explicit_issue_and_removed_on_close_and_reload', async () => {
    await issue(page, 'first'); const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })); assert.ok(!stored.includes(mutations.first.token!) && !stored.includes(mutations.first.token!.split('.')[1]), 'Credential entered browser persistent storage');
    await hideSecret(page); await page.reload(); await ready(page); await expect(page.getByLabel('新签发的应用密钥', { exact: true })).toHaveCount(0); await h.shot(page, 'developer-key-metadata');
  });
  await stage('separate_machine_auth_reads_only_scoped_metadata_and_replay_never_returns_plaintext', async () => {
    const m = mutations.first, before = Number((await c.owner(db => db.query('SELECT count(*) n FROM auth_sessions'))).rows[0].n);
    const context = await machine('/context', m.token!); assert.equal(context.identity, 'organization_application');
    const projects = await machine('/projects', m.token!) as { items: { id: string; document?: unknown }[] }; assert.ok(projects.items.some(p => p.id === state.projectId)); assert.ok(!projects.items.some(p => p.id === state.privateProjectId)); assert.ok(projects.items.every(p => p.document === undefined));
    await machine('/projects/' + state.privateProjectId, m.token!, 404); const exported = await machine('/exports/' + state.exportId, m.token!); assert.equal(exported.status, 'queued'); assert.equal(exported.settings, undefined); assert.equal(exported.result, undefined);
    const again = await c.good<DeveloperMutationResult>('/enterprise/developers/issue', m.body, c.apiB, m.key); assert.equal(again.receiptId, m.receiptId); assert.equal(again.issuedCredential!.oneTimeToken, null);
    assert.equal(Number((await c.owner(db => db.query('SELECT count(*) n FROM auth_sessions'))).rows[0].n), before);
    const dbText = await c.owner(async db => { const values = []; for (const table of ['developer_apps', 'developer_credentials', 'developer_events', 'idempotency', 'audit_events']) values.push((await db.query('SELECT * FROM ' + table)).rows); return JSON.stringify(values); });
    assert.ok(!dbText.includes(m.token!) && !dbText.includes(m.token!.split('.')[1]), 'Credential plaintext appeared in persistent data');
  });
  await gui('rotation_supports_two_keys_and_disables_a_third_active_issue', async () => { await issue(page, 'second'); await hideSecret(page); await expect(card(page).getByRole('button', { name: '签发凭证', exact: true })).toBeDisabled(); });
  await gui('confirmed_revocation_rejects_original_key_immediately_and_keeps_other_rotation_key', async () => {
    if (!mutations.revokeFirst?.receiptId) { await card(page).locator('[data-developer-credential-id="' + mutations.first.credentialId + '"]').getByRole('button', { name: '撤销凭证', exact: true }).click(); await expect(dialog(page).getByLabel(ack, { exact: true })).not.toBeChecked(); await confirm(page, 'revoke', 'revokeFirst'); }
    await machine('/context', mutations.first.token!, 401); await machine('/context', mutations.second.token!); await expect(card(page).locator('[data-developer-credential-id="' + mutations.first.credentialId + '"]')).toContainText('已撤销');
  });
  await gui('editing_scope_explains_revocation_and_requires_fresh_confirmation', async () => {
    if (!mutations.scopeChange?.receiptId) { await card(page).getByRole('button', { name: '配置应用', exact: true }).click(); await dialog(page).getByLabel('读取制作导出状态', { exact: true }).uncheck(); await expect(dialog(page)).toContainText('变更读取范围或停用应用，会立即撤销它的现有凭证'); await expect(dialog(page).getByLabel(ack, { exact: true })).not.toBeChecked(); await confirm(page, 'control', 'scopeChange'); }
    await machine('/context', mutations.second.token!, 401); await expect(card(page)).toContainText('读取制作工程信息');
  });
  await stage('new_key_after_scope_change_reads_projects_and_cannot_read_export_status', async () => { if (!mutations.third?.token) { const app = await current(); mutations.third = { key: randomUUID(), body: { workspaceId: w, appId: state.appId, expectedVersion: app.version, termDays: 30, confirmed: true } }; retain(); const value = await c.good<DeveloperMutationResult>('/enterprise/developers/issue', mutations.third.body, c.apiA, mutations.third.key); remember(value, 'third'); } await machine('/projects/' + state.projectId, mutations.third.token!); await machine('/exports/' + state.exportId, mutations.third.token!, 403); await page.reload(); await ready(page); });
  await gui('390px_configuration_dialog_keeps_scopes_confirmation_and_cancel_controls_reachable', async () => { await page.setViewportSize({ width: 390, height: 844 }); await card(page).getByRole('button', { name: '配置应用', exact: true }).click(); await expect(dialog(page).getByLabel(ack, { exact: true })).not.toBeChecked(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await dialog(page).getByLabel(ack, { exact: true }).scrollIntoViewIfNeeded(); await h.shot(page, 'developer-mobile-confirmation'); await dialog(page).getByRole('button', { name: '取消', exact: true }).click(); await page.setViewportSize({ width: 1440, height: 1100 }); });
  await gui('workspace_switch_clears_visible_secret_and_uses_only_the_new_space_application_list', async () => { await issue(page, 'fourth'); await page.getByLabel('选择工作空间', { exact: true }).selectOption(privateW); await ready(page); await expect(page.getByLabel('新签发的应用密钥', { exact: true })).toHaveCount(0); await expect(page.locator('[data-developer-app-id]')).toHaveCount(0); await page.getByLabel('选择工作空间', { exact: true }).selectOption(w); await ready(page); await expect(card(page)).toBeVisible(); await expect(page.getByLabel('新签发的应用密钥', { exact: true })).toHaveCount(0); });
  await gui('real_401_and_late_authorized_issue_response_cannot_reveal_secret_in_another_scope', async () => {
    await backendRevoke('revokeThird', mutations.third.credentialId!); state.extraId ??= randomUUID(); retain();
    if (!state.extraCreated) { await c.good('/enterprise/members/create', { workspaceId: w, userId: state.extraId, name: '合成接入复核管理员', role: 'admin', workspaceIds: [w, privateW], confirmed: true }); state.extraCreated = true; retain(); }
    if (!state.extraHeaders) { const login = await c.http('/api/v1/auth/login', { accountId: state.extraId }, c.apiB, {}); assert.equal(login.status, 200); const cookie = login.cookie!.split(';')[0], me = await c.http<Me>('/api/v1/me', undefined, c.apiB, { cookie }); state.extraHeaders = { cookie, 'x-csrf-token': me.body.data.csrfToken }; c.secrets.push(cookie, me.body.data.csrfToken); retain(); }
    const extra = await h.page(await h.context((state.extraHeaders as Headers).cookie)); await open(extra);
    let held: Route | undefined, response: Awaited<ReturnType<Route['fetch']>> | undefined, notify = () => {};
    const fetched = new Promise<void>(resolve => { notify = resolve; });
    await extra.context().route('**/api/v1/enterprise/developers/issue', async route => { held = route; response = await route.fetch(); assert.equal(response.status(), 200); mutations.lateIssue = { key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() }; const result = (await response.json() as { data: DeveloperMutationResult }).data; remember(result, 'lateIssue'); notify(); });
    await card(extra).getByRole('button', { name: '签发凭证', exact: true }).click(); await dialog(extra).getByLabel(ack, { exact: true }).check(); await dialog(extra).getByRole('button', { name: '确认签发凭证', exact: true }).click(); await proofBounded(fetched, 20000, 'The authorized issue response was not held');
    if (!state.extraRevoked) { const version = Number((await c.owner(db => db.query("SELECT version FROM enterprise_member_directory WHERE user_id=$1 AND environment='mock' AND app_env='development'", [state.extraId]))).rows[0].version); await c.good('/enterprise/members/access', { workspaceId: w, userId: state.extraId, version, role: 'viewer', workspaceIds: [w], confirmed: true }); state.extraRevoked = true; retain(); }
    await dialog(extra).getByRole('button', { name: '取消', exact: true }).click(); await extra.getByLabel('选择工作空间', { exact: true }).selectOption(privateW); await expect(extra.getByRole('heading', { name: '进入你的工作空间', exact: true })).toBeVisible(); assert.equal((await c.http('/api/v1/me', undefined, c.apiB, state.extraHeaders as Headers)).status, 401);
    try { await held!.fulfill({ response: response! }); } catch { /* The old request may have been aborted during logout. */ }
    await expect(extra.getByLabel('新签发的应用密钥', { exact: true })).toHaveCount(0); await expect(extra.locator('[data-developer-app-id]')).toHaveCount(0);
  });
  await gui('legacy_me_without_capability_hides_management_and_never_requests_developer_records', async () => {
    const me = (await c.http<Me>('/api/v1/me', undefined, c.apiB, c.headers)).body.data, { developerAccessAvailable: omitted, ...legacy } = me; void omitted;
    const ctx = await h.context(c.cookie); let calls = 0; await ctx.route('**/api/v1/me', route => route.fulfill({ status: 200, json: { data: legacy, requestId: 'synthetic-legacy-developer-capability' } })); await ctx.route('**/api/v1/enterprise/developers?*', route => { calls++; return route.abort(); }); const p = await h.page(ctx); await p.goto(h.origin + '/enterprise/developers'); await expect(p.getByText('当前服务尚未开放开发者接入，请使用已更新的独立服务实例。', { exact: true })).toBeVisible(); await expect(p.getByRole('link', { name: '开发者接入', exact: true })).toHaveCount(0); assert.equal(calls, 0); state.legacyCompatibilityUsesSyntheticMe = true; retain();
  });
  assert.deepEqual(h.errors, []); assert.ok((await h.devices()).every(d => d.calls === 0)); await observeRecoveryClusters(base + '/observed-developer-browser-' + label + '.json', [process.pid, ...c.roots, ...c.cluster.observedPids], c.web); await h.close();
  await stage('two_apis_and_actual_postgres_restart_preserve_521_tables_keys_original_cookie_and_live_revocable_credentials', async () => {
    const snapshot = () => c.owner(async db => { const rows: Record<string, string[]> = {}; for (const table of ['developer_apps', 'developer_credentials', 'developer_events', 'developer_rate_windows', 'studio_projects', 'studio_exports', 'auth_sessions']) rows[table] = (await db.query('SELECT * FROM ' + table)).rows.map(r => JSON.stringify(r)).sort(); return rows; });
    const before = await snapshot(); await c.observe('observed-developer-before-restart'); await h.closeApis(); await c.cluster.stop(); await c.cluster.start(); c.roots.push(...c.cluster.observedPids); await h.reopenApis('developer-restart'); assert.deepEqual(await snapshot(), before); assert.equal((await c.http('/api/v1/me', undefined, c.apiB, c.headers)).status, 200);
    await machine('/projects/' + state.projectId, mutations.fourth.token!); await machine('/context', mutations.first.token!, 401); await machine('/context', mutations.second.token!, 401); await machine('/context', mutations.third.token!, 401);
    for (const key of c.keys) assert.equal(proofHash(path.join(c.nativeDir, key.name)), key.sha256); const tables = Number((await c.owner(db => db.query('SELECT count(*) n FROM pg_tables WHERE schemaname=$1', [c.schema]))).rows[0].n); assert.equal(tables, 521);
    c.save('restart-retention.json', { result: 'PASS', tables, permissionViews: 2, originalKeys: 2, originalAdminCookieRetained: true, actualTargetRestart: true, currentCredentialRetained: true, revokedCredentialsStillRejected: true, originalQueuedExportRetained: true, workerStarted: false });
  });
  await stage('executed_build_matches_current_files_and_checked_logs_have_no_credential_plaintext', async () => { for (const [file, sha] of Object.entries(compiled)) { assert.equal(proofHash(file), sha, file); assert.equal(proofHash(path.join(c.compiledRoot, file)), sha, file); } for (const p of c.running) for (const secret of c.secrets.filter(s => s.length >= 16)) assert.ok(!p.stdout().includes(secret) && !p.stderr().includes(secret), 'Private credential in process logs'); });
  c.save('developer-summary.json', { result: 'PASS', compiledChecks: c.checks.length, guiFlows: h.gui, completedStages: Object.keys(done), compiledFiles: Object.keys(compiled).length, webFiles: Object.keys(compiled).filter(f => f.startsWith('dist/web/')).length, legacyCompatibilityUsesSyntheticMe: state.legacyCompatibilityUsesSyntheticMe === true, workerStarted: false, contentModelsRead: false, realIdpOrExternalBusinessActions: false, credentialsOnlyInPrivateFixtureState: true, wholeR120Complete: false, wholeG2Complete: false });
  await c.observe('observed-developer-final'); finishing = true; await c.finish(); console.log(JSON.stringify({ result: 'PASS_COMPILED_DEVELOPER_ACCESS', compiledChecks: c.checks.length, guiChecks: h.gui.length }));
} catch (error) {
  if (finishing) throw error;
  try { await observeRecoveryClusters(base + '/observed-developer-failure-' + label + '.json', [process.pid, ...c.roots, ...c.cluster.observedPids], c.web); for (const ctx of h.contexts) for (const p of ctx.pages().filter(p => !p.isClosed()).slice(-1)) await p.screenshot({ path: path.join(c.out, 'failure-' + h.contexts.indexOf(ctx) + '.png'), fullPage: true, mask: [p.getByLabel('新签发的应用密钥', { exact: true })] }); } finally { await h.close(); finishing = true; await c.finish(error); }
}
