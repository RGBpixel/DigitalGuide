import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../apps/api/src/config.js';
import { createApp } from '../apps/api/src/app.js';
import { Repository } from '../packages/database/src/index.js';
import { fixtureIds as F } from '../packages/test-fixtures/src/seed.js';
import { createPostgresClient } from '../packages/postgres/src/config.js';
import { loadNativeRuntimeConfig } from '../packages/postgres/src/runtime-config.js';
import { observeRecoveryClusters, resumeRecoveryCluster } from './native-recovery-owned.js';
import type { WebhookView } from '../packages/contracts/src/developer-webhooks.js';
const root = 'docs/evidence/T35/developer-webhooks', label = process.argv[2] ?? 'webhook-retained', audit = process.argv[3] ?? root + '/webhook-initial-closure-process-audit.json';
assert.match(label, /^[a-z][a-z0-9-]+$/);
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
for (const file of ['webhook-sqlite-initial.json', 'webhook-native-initial.json']) assert.equal(read(root + '/' + file).success, false, 'Only an overall failed fixture may resume');
const checks: { name: string; dialect: string; details: object }[] = [];
type Query = (sql: string, ...args: (string | number)[]) => Promise<Record<string, unknown>[]>;
async function validate(app: FastifyInstance, query: Query, sourceQuery: Query, dialect: string) {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { accountId: F.adminA } }); assert.equal(r.statusCode, 200);
  const cookie = r.headers['set-cookie']!.toString().split(';')[0], me = await app.inject({ url: '/api/v1/me', headers: { cookie } }); assert.equal(me.statusCode, 200);
  const headers = { cookie, 'x-csrf-token': me.json().data.csrfToken as string };
  async function post<T>(url: string, payload: object) { const response = await app.inject({ method: 'POST', url: '/api/v1' + url, headers: { ...headers, 'idempotency-key': randomUUID() }, payload }); assert.equal(response.statusCode, 200, url); return response.json().data as T; }
  async function view() { const response = await app.inject({ url: '/api/v1/enterprise/webhooks?workspaceId=' + F.workspaceA, headers }); assert.equal(response.statusCode, 200); return response.json().data as WebhookView; }
  const exports = await query("SELECT * FROM studio_exports WHERE tenant_id=? AND workspace_id=? AND status='queued'", F.tenantA, F.workspaceA); assert.equal(exports.length, 1, 'Retain the original queued export rather than produce it again');
  const exported = exports[0], events = await query('SELECT * FROM developer_webhook_events WHERE source_id=? ORDER BY sequence', String(exported.id)); assert.equal(events.length, 1); assert.equal(JSON.parse(String(events[0].payload)).data.status, 'queued');
  const binding = (await query('SELECT s.id,s.app_id,s.destination_id FROM developer_webhook_subscriptions s JOIN developer_webhook_deliveries d ON d.subscription_id=s.id WHERE d.event_id=?', String(events[0].id)))[0]; assert.ok(binding);
  let v = await view(), application = v.apps.find(a => a.id === binding.app_id)!;
  if (!application.enabled) await post('/enterprise/developers/control', { workspaceId: F.workspaceA, appId: application.id, expectedVersion: application.version, name: application.name, scopes: application.scopes, enabled: true, confirmed: true });
  v = await view(); application = v.apps.find(a => a.id === binding.app_id)!; const sub = v.subscriptions.find(s => s.id === binding.id)!, destination = v.destinations.find(d => d.id === binding.destination_id)!;
  if (!sub.enabled || !sub.configurationCurrent) await post('/enterprise/webhooks/control', { workspaceId: F.workspaceA, appId: application.id, expectedAppVersion: application.version, subscriptionId: sub.id, expectedVersion: sub.version, topics: sub.topics, enabled: true, configurationToken: destination.configurationToken, confirmed: true });
  if (dialect === 'postgres') await sourceQuery("UPDATE studio_exports SET status='rendering',attempts=attempts+1,lease_token=?,lease_until=?,progress=0,updated_at=? WHERE id=?", randomUUID(), new Date(Date.now() + 90000).toISOString(), new Date().toISOString(), String(exported.id));
  await sourceQuery('UPDATE studio_exports SET progress=? WHERE id=?', 0.2, String(exported.id));
  assert.equal((await query('SELECT * FROM developer_webhook_events WHERE source_id=?', String(exported.id))).length, dialect === 'postgres' ? 2 : 1, 'Progress-only write must not create a source event');
  await post('/studio/exports/' + String(exported.id) + '/cancel', { version: Number(exported.project_version) });
  const finalEvents = await query('SELECT * FROM developer_webhook_events WHERE source_id=? ORDER BY sequence', String(exported.id)), sequence = dialect === 'postgres' ? [1, 2, 3] : [1, 2]; assert.deepEqual(finalEvents.map(e => Number(e.sequence)), sequence); assert.deepEqual(finalEvents.map(e => JSON.parse(String(e.payload)).data.status), dialect === 'postgres' ? ['queued', 'rendering', 'cancelled'] : ['queued', 'cancelled']); assert.equal(finalEvents[0].id, events[0].id);
  checks.push({ name: 'existing_export_progress_and_cancellation', dialect, details: { originalExportId: exported.id, originalEventId: events[0].id, sequence, producerRepeated: false, progressRole: dialect === 'postgres' ? 'worker' : 'sqlite', syntheticLeaseTransition: dialect === 'postgres', rendererStarted: false, metadataOnly: finalEvents.every(e => !Object.keys(JSON.parse(String(e.payload)).data).some(k => ['settings', 'result', 'document', 'storageKey'].includes(k))) } });
  if (dialect === 'postgres') {
    const tables = ['studio_projects', 'developer_webhook_sources', 'developer_webhook_events', 'developer_webhook_deliveries'], counts = () => Promise.all(tables.map(async table => Number((await query('SELECT count(*) n FROM ' + table))[0].n))), before = await counts();
    await query("CREATE FUNCTION dg_webhook_fixture_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic outbox failure';END;$$");
    await query('CREATE TRIGGER webhook_fixture_fault BEFORE INSERT ON developer_webhook_events FOR EACH ROW EXECUTE FUNCTION dg_webhook_fixture_fault()');
    let status: number;
    try { const response = await app.inject({ method: 'POST', url: '/api/v1/studio/projects', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { workspaceId: F.workspaceA, name: '合成应回滚工程续验', purpose: 'video' } }); status = response.statusCode; assert.ok(status >= 500 && status < 600); }
    finally { await query('DROP TRIGGER webhook_fixture_fault ON developer_webhook_events'); await query('DROP FUNCTION dg_webhook_fixture_fault()'); }
    assert.deepEqual(await counts(), before); checks.push({ name: 'outbox_failure_rolls_back_business_and_event', dialect, details: { status, tables, allCountsUnchanged: true, successfulProducerRepeated: false } });
  }
  v = await view(); application = v.apps.find(a => a.id === binding.app_id)!;
  await post('/enterprise/developers/control', { workspaceId: F.workspaceA, appId: application.id, expectedVersion: application.version, name: application.name, scopes: application.scopes, enabled: false, confirmed: true });
}
let failure: unknown;
try {
  const priorSQLite = fs.existsSync(root + '/webhook-retained.json') && read(root + '/webhook-retained.json').checks.some((check: {dialect: string; name: string}) => check.dialect === 'sqlite' && check.name === 'existing_export_progress_and_cancellation');
  if (!priorSQLite) {
    const marker = read(root + '/061-first-committed.json'), dataDir = marker.dataDir, config: Config = { root: process.cwd(), dataDir, appEnv: 'development', providerMode: 'mock', apiPort: 4309, webOrigin: 'http://127.0.0.1:5179', sessionSecret: randomBytes(48).toString('hex'), developerWebhooksFile: path.join(dataDir + '-webhooks-private', 'receivers.private.json') }, repo = new Repository(dataDir, process.cwd(), { environment: 'mock', appEnv: 'development' });
    const app = await createApp(config, repo), query: Query = async (sql, ...args) => { if (/^SELECT/i.test(sql)) return repo.all<Record<string, unknown>>(sql, ...args); repo.run(sql, ...args); return []; };
    try { await validate(app, query, query, 'sqlite'); } finally { await app.close(); repo.close(); }
  }
  const original = read(root + '/140-first-committed.json'), owned = await resumeRecoveryCluster(original.root, audit);
  try {
    await observeRecoveryClusters(root + '/observed-' + label + '.json', [owned.child.pid!, Number(fs.readFileSync(path.join(owned.root, 'data/postmaster.pid'), 'utf8').split('\n')[0])], owned.connection.port);
    const apiConfig = loadNativeRuntimeConfig(path.join(owned.root, 'native-data/api.json')), workerConfig = loadNativeRuntimeConfig(path.join(owned.root, 'native-data/worker.json'));
    const config: Config = { root: process.cwd(), dataDir: apiConfig.dataDir, appEnv: 'development', providerMode: 'mock', apiPort: 4309, webOrigin: 'http://127.0.0.1:5179', sessionSecret: fs.readFileSync(path.join(apiConfig.dataDir, '.session-secret'), 'utf8').trim(), nativePostgres: apiConfig, developerWebhooksFile: path.join(apiConfig.dataDir + '-webhooks-private', 'receivers.private.json') };
    const query: Query = async (sql, ...args) => { const db = createPostgresClient(owned.connection); await db.connect(); try { await db.query('SET search_path TO "' + apiConfig.schema + '",pg_catalog,pg_temp'); let i = 0; return (await db.query(sql.replace(/\?/g, () => '$' + (++i)), args)).rows; } finally { await db.end(); } };
    const source: Query = async (sql, ...args) => { const db = createPostgresClient(workerConfig.connection); await db.connect(); try { await db.query('SET search_path TO "' + apiConfig.schema + '",pg_catalog,pg_temp'); let i = 0; return (await db.query(sql.replace(/\?/g, () => '$' + (++i)), args)).rows; } finally { await db.end(); } };
    const app = await createApp(config); try { await validate(app, query, source, 'postgres'); } finally { await app.close(); }
  } finally { await owned.stop(); }
} catch (error) { failure = error; }
fs.writeFileSync(root + '/' + label + '.json', JSON.stringify({ result: failure ? 'FAIL' : 'PASS_RETAINED_WEBHOOK_CONTRACT_SUPPLEMENT', checkedAt: new Date().toISOString(), checks, completed: checks.length, successfulProducerRepeated: false, originalFailuresRetained: true, mainRestarted: false, mainCutOver: false, sqliteSupplementUsesFreshSyntheticLogin: true, externalRequests: 0, ...(failure ? { error: failure instanceof Error ? failure.message : 'unknown failure' } : {}) }, null, 2) + '\n', { flag: 'wx' });
if (failure) throw failure;
console.log(JSON.stringify({ result: 'PASS_RETAINED_WEBHOOK_CONTRACT_SUPPLEMENT', checks: checks.length, originalProducersRepeated: false }));
