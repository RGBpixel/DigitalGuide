import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import type { DeveloperMutationResult, Me, StudioProject, ExportPlan, StudioExport, WebhookView, WebhookDeliveryView } from '../packages/contracts/src/index.js';
import { webhookReceiver, type ReceiverObservation } from '../packages/test-fixtures/src/webhook-receiver.js';
import { NativeContentProofRuntime, proofBounded, proofHash, proofPause } from './postgres-content-proof-runtime.js';
import { MemoryProof } from './native-guest-memory-proof-helpers.js';
const base = 'docs/evidence/T35/developer-webhooks', resume = process.argv[2] === 'resume', prior = process.argv[3] ?? 'webhook-compiled', label = resume ? (process.argv[4] ?? 'webhook-compiled-continued') : 'webhook-compiled', audit = process.argv[5];
for (const name of [prior, label]) assert.match(name, /^[a-z][a-z0-9-]+$/);
if (resume) assert.ok(audit, 'A fresh independent strict closure audit is required');
const c = resume ? await NativeContentProofRuntime.resume(base + '/' + label, base + '/' + prior + '/proof.json', undefined, { preservePortsWithAudit: audit! }) : await NativeContentProofRuntime.create(base + '/' + label), h = new MemoryProof(c);
const w = '20000000-0000-4000-8000-000000000001', privateW = '20000000-0000-4000-8000-000000000002', tenant = '10000000-0000-4000-8000-000000000001';
const privateDir = path.join(c.cluster.root, 'webhook-private'), keyFile = path.join(privateDir, 'receiver.key'), registry = path.join(privateDir, 'receivers.private.json'), stateFile = path.join(c.cluster.root, 'webhook-proof-state.private.json');
type Result = { receiptId: string; subscriptionId: string; deliveryId?: string; view: WebhookView };
type Intent = { url: string; body: object; key: string; data?: unknown; status?: number };
type State = { done: Record<string, boolean>; intents: Record<string, Intent>; cli: number; appId?: string; subId?: string; first?: string; retry?: string; crash?: string; manual?: string; blocked?: string; cancelled?: string; pending?: string; receiverPort?: number; observations: ReceiverObservation[]; applied: string[]; admin?: {cookie: string; headers: Record<string, string>; viewerCookie: string}; restartSnapshot?: unknown; deviceProbes?: {page: string;calls: number}[] };
const state: State = resume ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { done: {}, intents: {}, cli: 0, observations: [], applied: [] };
fs.mkdirSync(privateDir, { recursive: true }); if (!resume) fs.writeFileSync(keyFile, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
const secret = () => fs.readFileSync(keyFile, 'utf8').trim(), receiver = await webhookReceiver(secret, { port: state.receiverPort }); state.receiverPort = receiver.port;
receiver.observations.push(...state.observations); for (const id of state.applied) receiver.applied.add(id); c.secrets.push(secret());
const destinationId = resume ? JSON.parse(fs.readFileSync(registry, 'utf8')).destinations[0].id as string : randomUUID();
if (!resume) fs.writeFileSync(registry, JSON.stringify({ version: 1, environment: 'mock', appEnv: 'development', destinations: [{ id: destinationId, tenantId: tenant, workspaceId: w, name: '合成业务系统接收端', mode: 'local_test', url: receiver.url, secretFile: keyFile }] }), { flag: 'wx', mode: 0o600 });
c.save('synthetic-provider-' + label + '.json', { port: receiver.port, root: c.cluster.root, externalDelivery: false, mode: 'owned_loopback_only' });
const originalEnv = c.env.bind(c); c.env = (configFile = c.apiPath, port = c.apiA) => ({ ...originalEnv(configFile, port), DEVELOPER_WEBHOOKS_CONFIG_FILE: registry });
function retain() { state.observations = receiver.observations; state.applied = [...receiver.applied]; state.admin = { cookie: c.cookie, headers: c.headers, viewerCookie: c.viewerCookie }; fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); }
async function stage(name: string, work: () => Promise<void>, gui = false) { if (state.done[name]) return; await work(); state.done[name] = true; retain(); if (gui) h.gui.push(name); else c.add(name); console.log(JSON.stringify({ stage: name, result: 'PASS', gui })); }
async function mutate<T>(marker: string, url: string, body: object): Promise<T> { const intent = state.intents[marker] ??= { url, body, key: randomUUID() }; retain(); if (intent.data) return intent.data as T; const data = await c.good<T>(intent.url, intent.body, c.apiA, intent.key); intent.data = data; retain(); return data; }
const view = () => c.get<WebhookView>('/enterprise/webhooks?workspaceId=' + w);
async function refs() { const v = await view(); return { view: v, app: v.apps.find(a => a.id === state.appId)!, sub: v.subscriptions.find(s => s.id === state.subId)!, destination: v.destinations[0] }; }
async function input() { const { app, sub } = await refs(); return { workspaceId: w, appId: app.id, expectedAppVersion: app.version, subscriptionId: sub.id, expectedVersion: sub.version, confirmed: true }; }
const records = () => c.get<{items: WebhookDeliveryView[];nextCursor: string | null}>('/enterprise/webhooks/deliveries?workspaceId=' + w + '&subscriptionId=' + state.subId + '&limit=100');
async function record(id: string) { const found = (await records()).items.find(row => row.id === id); assert.ok(found, 'Expected persistent delivery record'); return found; }
async function test(marker: string) { return (await mutate<Result>(marker, '/enterprise/webhooks/test', await input())).deliveryId!; }
async function dispatch() { const number = ++state.cli; retain(); const process = c.start('webhook-dispatch-' + number, globalThis.process.execPath, ['dist/developer-webhooks.mjs', '--once'], c.env(c.workerPath)); const result = await proofBounded(process.closed, 15000, 'Dedicated webhook dispatcher did not close'); assert.equal(result.code, 0, 'Dedicated dispatcher failed'); retain(); return JSON.parse(process.stdout().trim().split('\n').at(-1)!) as {result: string;deliveryId?: string;status?: string}; }
async function waitDue(id: string) { const wait = Date.parse((await record(id)).availableAt) - Date.now(); assert.ok(wait < 6500, 'Unexpected first retry delay'); if (wait > 0) await proofPause(wait + 50); }
const dialog = (page: Page) => page.getByRole('dialog'), card = (page: Page) => page.locator('[data-webhook-subscription-id="' + state.subId + '"]'), delivery = (page: Page, id: string) => page.locator('[data-webhook-delivery-id="' + id + '"]');
async function ready(page: Page) { await expect(page.getByRole('heading', { name: '事件回调', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '刷新状态', exact: true })).toBeEnabled(); }
async function confirm(page: Page, action: string, marker: string, status = 200) {
  const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/enterprise/webhooks/' + action);
  await dialog(page).getByLabel('我已核对当前空间、应用、接收端和操作范围', { exact: true }).check(); await dialog(page).getByRole('button', { name: /^确认/ }).click();
  const r = await response, request = r.request(); state.intents[marker] = { url: '/enterprise/webhooks/' + action, body: request.postDataJSON() as object, key: request.headers()['idempotency-key'], status: r.status() }; retain(); assert.equal(r.status(), status, marker);
  if (status !== 200) return undefined;
  const result = (await r.json() as {data: Result}).data; state.intents[marker].data = result; retain(); await expect(dialog(page)).toBeHidden(); return result;
}
function files() { const walk = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); return walk(path.join(c.compiledRoot, 'dist')).map(file => ({ file: path.relative(c.compiledRoot, file).replaceAll('\\', '/'), sha256: proofHash(file) })); }
let finishing = false;
try {
  if (resume) { await c.prepareResume({skipSyntheticLogins: true}); c.cookie = state.admin!.cookie; c.headers = state.admin!.headers; c.viewerCookie = state.admin!.viewerCookie; c.secrets.push(c.cookie, c.headers['x-csrf-token'], c.viewerCookie); }
  else { await c.prepare({contentModels: false}); retain(); }
  const compiled = files(); c.save('compiled-before.json', { files: compiled, count: compiled.length, contentModels: false });
  await stage('compiled_capability_and_scoped_application', async () => {
    const me = await c.get<Me>('/me', c.apiB); assert.equal(me.developerWebhooksAvailable, true);
    if (!state.appId) { const result = await mutate<DeveloperMutationResult>('application', '/enterprise/developers/create', { workspaceId: w, name: '合成Webhook业务系统', scopes: ['projects.read', 'exports.read'], confirmed: true }); state.appId = result.view.apps.find(a => a.name === '合成Webhook业务系统')!.id; retain(); }
    assert.equal((await view()).destinations.length, 1);
  });
  await h.web(); const admin = await h.page(await h.context(c.cookie)); await admin.goto(h.origin + '/enterprise/webhooks'); await ready(admin);
  await stage('gui_create_with_specific_events_and_unchecked_confirmation', async () => {
    if (!state.subId) { await admin.getByRole('button', {name: '创建订阅', exact: true}).click(); await expect(dialog(admin).getByRole('button', {name: '确认创建订阅', exact: true})).toBeDisabled(); await dialog(admin).getByLabel('制作工程变更', {exact: true}).check(); await dialog(admin).getByLabel('制作导出状态', {exact: true}).check(); await expect(dialog(admin).getByLabel('我已核对当前空间、应用、接收端和操作范围', {exact: true})).not.toBeChecked(); const result = await confirm(admin, 'create', 'gui-create'); state.subId = result!.subscriptionId; retain(); }
    await expect(card(admin)).toBeVisible(); await h.shot(admin, 'subscriptions-desktop');
  }, true);
  await stage('gui_test_queues_and_actual_compiled_dispatcher_verifies_hmac', async () => {
    if (!state.first) { await card(admin).getByRole('button', {name: '发送测试', exact: true}).click(); state.first = (await confirm(admin, 'test', 'gui-first-test'))!.deliveryId!; retain(); }
    if ((await record(state.first)).status !== 'delivered') { await expect(delivery(admin, state.first).getByText('等待发送', {exact: true})).toBeVisible(); assert.equal((await dispatch()).status, 'delivered'); }
    const received = receiver.observations.find(row => row.deliveryId === state.first)!; assert.ok(received?.authenticated); assert.equal(received.sessionAuthorizationPresent, false); const wire = JSON.parse(received.body); assert.equal(wire.applicationId, state.appId); assert.equal(wire.subscriptionId, state.subId); await expect(delivery(admin, state.first).getByText('接收端已确认', {exact: true})).toBeVisible({timeout: 10000}); await h.shot(admin, 'deliveries-desktop');
  }, true);
  await stage('compiled_project_and_export_transactional_metadata_events_without_media_execution', async () => {
    const project = await mutate<StudioProject>('project', '/studio/projects', {workspaceId: w, name: '合成出站回调工程', purpose: 'video'}), document = structuredClone(project.document); document.segments[0].text = '合成私人讲稿，不应出现在回调正文';
    const saved = await mutate<StudioProject>('project-save', '/studio/projects/' + project.id + '/save', {version: project.version, name: project.name, document});
    const options = {version: saved.version, kind: 'video', settings: {preset: 'hd', fps: 24, transparent: false, omitBackground: false, burnSubtitles: false}, startMs: 0, durationMs: 1000};
    const plan = await mutate<ExportPlan>('export-plan', '/studio/projects/' + project.id + '/export-plan', options); assert.equal(plan.canExport, true);
    const exported = await mutate<StudioExport>('export', '/studio/projects/' + project.id + '/exports', {...options, planHash: plan.hash, confirmed: true, rightsConfirmed: true});
    await mutate('export-cancel', '/studio/exports/' + exported.id + '/cancel', {version: exported.version});
    const events = (await c.owner(db => db.query('SELECT payload FROM developer_webhook_events WHERE source_id IN($1,$2) ORDER BY source_id,sequence', [project.id, exported.id]))).rows; assert.equal(events.length, 4); assert.ok(events.every(event => !String(event.payload).includes(document.segments[0].text)));
    for (let i = 0; i < 5; i++) { const pending = (await records()).items.filter(row => ['queued', 'retrying'].includes(row.status)); if (!pending.length) break; assert.equal((await dispatch()).status, 'delivered'); }
    assert.ok((await records()).items.filter(row => row.type !== 'webhook.test').every(row => row.status === 'delivered'));
  });
  await stage('compiled_429_retry_uses_same_delivery_event_and_raw_body', async () => {
    state.retry ??= await test('retry-test'); retain(); const old = await record(state.retry);
    if (!old.attempts) { receiver.setMode('retry'); assert.equal((await dispatch()).status, 'retrying'); }
    await waitDue(state.retry); receiver.setMode('accept'); if ((await record(state.retry)).status !== 'delivered') assert.equal((await dispatch()).status, 'delivered');
    const values = receiver.observations.filter(row => row.deliveryId === state.retry); assert.equal(values.length, 2); assert.equal(values[0].bodySHA256, values[1].bodySHA256); assert.equal(values[0].eventId, values[1].eventId);
  });
  await stage('compiled_actual_dispatcher_sigkill_expires_lease_and_receiver_deduplicates_uncertain_delivery', async () => {
    state.crash ??= await test('crash-test'); retain(); let row = await record(state.crash);
    if (!row.attempts) {
      receiver.setMode('hold'); const count = receiver.observations.length, number = ++state.cli; retain(); const child = c.start('webhook-crash-' + number, process.execPath, ['dist/developer-webhooks.mjs', '--once'], c.env(c.workerPath)); await receiver.waitForCount(count + 1); assert.equal(child.child.exitCode, null); await c.stop(child, 'SIGKILL'); assert.equal((await child.closed).signal, 'SIGKILL'); c.save('dispatcher-sigkill.json', {result: 'PASS', pid: child.child.pid, signal: 'SIGKILL', deliveryId: state.crash, receiverObservedRequestBeforeKill: true, exactCreationIdentityCaptured: false}); receiver.release(); retain();
    }
    row = await record(state.crash); if (row.status === 'sending') { const until = String((await c.owner(db => db.query('SELECT lease_until FROM developer_webhook_deliveries WHERE id=$1', [state.crash]))).rows[0].lease_until), wait = Date.parse(until) - Date.now(); if (wait > 0) await proofPause(wait + 60); assert.equal((await dispatch()).result, 'idle'); }
    await waitDue(state.crash); receiver.setMode('accept'); if ((await record(state.crash)).status !== 'delivered') assert.equal((await dispatch()).status, 'delivered');
    const values = receiver.observations.filter(value => value.deliveryId === state.crash); assert.equal(values.length, 2); assert.equal(values[0].duplicate, false); assert.equal(values[1].duplicate, true); assert.equal(values[0].bodySHA256, values[1].bodySHA256); const attempts = (await record(state.crash)).recentAttempts; assert.equal(attempts.find(a => a.attempt === 1)!.outcome, 'unknown'); assert.equal(attempts.find(a => a.attempt === 1)!.code, 'LEASE_EXPIRED');
  });
  await stage('gui_manual_retry_keeps_delivery_and_signed_body', async () => {
    state.manual ??= await test('manual-retry-test'); retain(); if (!(await record(state.manual)).attempts) { receiver.setMode('reject'); assert.equal((await dispatch()).status, 'failed'); }
    if ((await record(state.manual)).status !== 'delivered') { await admin.reload(); await ready(admin); await delivery(admin, state.manual).getByRole('button', {name: '重试此条投递', exact: true}).click(); await expect(dialog(admin).getByRole('button', {name: '确认重试投递', exact: true})).toBeDisabled(); await confirm(admin, 'retry', 'gui-manual-retry'); receiver.setMode('accept'); assert.equal((await dispatch()).status, 'delivered'); }
    const values = receiver.observations.filter(row => row.deliveryId === state.manual); assert.equal(values.length, 2); assert.equal(values[0].bodySHA256, values[1].bodySHA256);
  }, true);
  await stage('gui_old_subscription_version_rejected_by_actual_server', async () => {
    await admin.reload(); await ready(admin); await card(admin).getByRole('button', {name: '调整订阅', exact: true}).click(); const current = await refs();
    await mutate('concurrent-config', '/enterprise/webhooks/control', {...await input(), topics: current.sub.topics, enabled: true, configurationToken: current.destination.configurationToken});
    await confirm(admin, 'control', 'gui-stale-config', 409); await expect(admin.getByRole('alert').filter({hasText: '已被更新'})).toBeVisible(); await expect(dialog(admin)).toBeHidden();
  }, true);
  await stage('gui_config_rotation_blocks_old_send_and_reconfirmation_cancels_old_generation', async () => {
    state.blocked ??= await test('old-key-test'); retain(); if ((await record(state.blocked)).status === 'queued') { fs.writeFileSync(keyFile, randomBytes(32).toString('base64url')); c.secrets.push(secret()); const before = receiver.observations.length; assert.equal((await dispatch()).status, 'blocked'); assert.equal(receiver.observations.length, before); }
    await admin.reload(); await ready(admin); await expect(card(admin).getByText('需重新核对', {exact: true})).toBeVisible(); await card(admin).getByRole('button', {name: '调整订阅', exact: true}).click(); await confirm(admin, 'control', 'gui-reconfirm'); assert.equal((await record(state.blocked)).status, 'cancelled');
  }, true);
  await stage('gui_disable_and_reenable_cancel_pending_without_replaying_history', async () => {
    state.cancelled ??= await test('cancelled-test'); retain(); await admin.reload(); await ready(admin); await card(admin).getByRole('button', {name: '停用订阅', exact: true}).click(); await expect(dialog(admin).getByRole('button', {name: '确认停用订阅', exact: true})).toBeDisabled(); await confirm(admin, 'control', 'gui-disable'); assert.equal((await record(state.cancelled)).status, 'cancelled');
    await card(admin).getByRole('button', {name: '调整订阅', exact: true}).click(); await dialog(admin).getByLabel('启用此订阅', {exact: true}).check(); await confirm(admin, 'control', 'gui-enable'); assert.equal((await dispatch()).result, 'idle');
  }, true);
  await stage('gui_workspace_switch_and_viewer_cannot_manage_other_scope', async () => {
    await admin.getByLabel('选择工作空间', {exact: true}).selectOption(privateW); await expect(admin.getByRole('heading', {name: '先连接你的应用', exact: true})).toBeVisible(); await expect(card(admin)).toHaveCount(0); await admin.getByLabel('选择工作空间', {exact: true}).selectOption(w); await ready(admin); await expect(card(admin)).toBeVisible();
    const viewer = await h.page(await h.context(c.viewerCookie)); await viewer.goto(h.origin + '/enterprise/webhooks'); await expect(viewer.getByText('此页面需要企业管理员权限。', {exact: true})).toBeVisible(); await expect(viewer.getByRole('button', {name: '创建订阅', exact: true})).toHaveCount(0);
  }, true);
  await stage('gui_390px_dialog_and_synthetic_old_me_compatibility', async () => {
    const context = await h.context(c.cookie), phone = await h.page(context); await phone.setViewportSize({width: 390, height: 844}); await phone.goto(h.origin + '/enterprise/webhooks'); await ready(phone); assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await h.shot(phone, 'webhooks-mobile'); await card(phone).getByRole('button', {name: '发送测试', exact: true}).click(); await expect(dialog(phone).getByRole('button', {name: '确认排队测试', exact: true})).toBeDisabled(); await phone.screenshot({path: path.join(c.out, 'webhook-confirm-mobile.png'), fullPage: false, animations: 'disabled'}); await dialog(phone).getByRole('button', {name: '取消', exact: true}).click();
    const oldContext = await h.context(c.cookie), legacy = await h.page(oldContext); await legacy.route('**/api/v1/me', async route => { const response = await route.fetch(), value = await response.json() as {data: Me}; delete value.data.developerWebhooksAvailable; await route.fulfill({response, json: value}); }); await legacy.goto(h.origin + '/enterprise/webhooks'); await expect(legacy.getByText('当前服务尚未开放事件回调，请使用已更新的独立服务实例。', {exact: true})).toBeVisible(); await expect(legacy.getByRole('button', {name: '创建订阅', exact: true})).toHaveCount(0);
  }, true);
  await stage('two_apis_and_postgres_restart_preserve_527_tables_keys_original_cookie_and_pending_delivery', async () => {
    state.pending ??= await test('restart-pending'); state.deviceProbes = await h.devices(); retain(); c.save('device-probes.json', {result: 'PASS', pages: state.deviceProbes, requests: state.deviceProbes.reduce((sum, page) => sum + page.calls, 0)}); await h.close();
    const tables = ['developer_apps', 'developer_webhook_subscriptions', 'developer_webhook_sources', 'developer_webhook_events', 'developer_webhook_deliveries', 'developer_webhook_attempts', 'developer_webhook_changes', 'studio_projects', 'studio_exports'];
    const snapshot = () => c.owner(async db => { const rows: Record<string, unknown> = {}; for (const table of tables) rows[table] = (await db.query('SELECT to_jsonb(t) value FROM ' + table + ' t ORDER BY to_jsonb(t)::text')).rows.map(row => row.value); return rows; });
    state.restartSnapshot ??= await snapshot(); retain(); await c.observe('observed-webhook-before-full-restart'); await h.closeApis(); await c.cluster.stop(); await c.cluster.start(); c.roots.push(...c.cluster.observedPids); await h.reopenApis('webhook-restart'); assert.deepEqual(await snapshot(), state.restartSnapshot); assert.equal((await c.http('/api/v1/me', undefined, c.apiB, c.headers)).status, 200);
    for (const key of c.keys) assert.equal(proofHash(path.join(c.nativeDir, key.name)), key.sha256);
    const count = Number((await c.owner(db => db.query('SELECT count(*) n FROM pg_tables WHERE schemaname=$1', [c.schema]))).rows[0].n), views = Number((await c.owner(db => db.query('SELECT count(*) n FROM pg_views WHERE schemaname=$1', [c.schema]))).rows[0].n); assert.equal(count, 527); assert.equal(views, 2); assert.equal((await record(state.pending)).status, 'queued'); receiver.setMode('accept'); assert.equal((await dispatch()).status, 'delivered');
    c.save('restart-retention.json', {result: 'PASS', tables: count, permissionViews: views, exactBusinessTables: tables, originalKeys: 2, originalAdminCookieRetained: true, pendingDeliveryAndAttemptsPreserved: true, deliveredAfterRestart: true, mediaWorkerStarted: false, generalWorkerStarted: false});
  });
  assert.deepEqual(files(), compiled); c.save('compiled-after.json', {files: compiled, count: compiled.length});
  assert.ok(receiver.observations.every(row => row.authenticated && !row.sessionAuthorizationPresent));
  c.save('receiver-observations.json', {result: 'PASS', requests: receiver.observations.map(row => ({deliveryId: row.deliveryId, eventId: row.eventId, bodySHA256: row.bodySHA256, authenticated: row.authenticated, sessionAuthorizationPresent: row.sessionAuthorizationPresent, duplicate: row.duplicate, mode: row.mode, receivedAt: row.receivedAt})), appliedDeliveryCount: receiver.applied.size, allSignaturesValid: receiver.observations.every(row => row.authenticated), personnelCredentialsForwarded: receiver.observations.some(row => row.sessionAuthorizationPresent), redirectTargetsCalled: receiver.redirectHits, externalRequests: 0});
  assert.ok(state.deviceProbes?.length); assert.equal(state.deviceProbes.reduce((sum, page) => sum + page.calls, 0), 0);
  assert.deepEqual(h.errors, []); c.save('gui.json', {result: 'PASS', checks: h.gui, screenshots: ['subscriptions-desktop', 'deliveries-desktop', 'webhooks-mobile', 'webhook-confirm-mobile'], deviceRequests: state.deviceProbes.reduce((sum, page) => sum + page.calls, 0), oldMeCompatibility: 'synthetic_omitted_capability_flag', browserErrors: h.errors});
  retain(); await receiver.close(); finishing = true; await c.finish();
} catch (error) { retain(); await h.close(); try { await receiver.close(); } catch { /* Preserve the first failure. */ } if (!finishing) { finishing = true; await c.finish(error); } throw error; }
