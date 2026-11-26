import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../../apps/api/src/config.js';
import { createApp } from '../../apps/api/src/app.js';
import { Repository } from '../../packages/database/src/index.js';
import { NativePostgresDatabase } from '../../packages/postgres/src/runtime-database.js';
import { createPostgresClient } from '../../packages/postgres/src/config.js';
import { fixtureIds as F } from '../../packages/test-fixtures/src/seed.js';
import { webhookReceiver } from '../../packages/test-fixtures/src/webhook-receiver.js';
import { WebhookRuntime } from '../../packages/enterprise/src/webhook-runtime.js';
import { WebhookQueue } from '../../packages/enterprise/src/webhook-queue.js';
import { NativeWebhookStore, SqliteWebhookStore } from '../../packages/enterprise/src/webhook-worker-store.js';
import { dispatchWebhook, type WebhookStore } from '../../packages/enterprise/src/webhook-dispatcher.js';
import { harness } from './helpers.js';
import { nativeRuntimeFixture } from './postgres-runtime-helpers.js';
import { observeRecoveryClusters } from '../../scripts/native-recovery-owned.js';
const evidence = 'docs/evidence/T35/developer-webhooks';
export type WebhookHeaders = { cookie: string; 'x-csrf-token': string };
export interface WebhookFixture {
  app: FastifyInstance; root: string; config: Config; runtime: WebhookRuntime; queue: WebhookQueue; store: WebhookStore;
  receiver: Awaited<ReturnType<typeof webhookReceiver>>; destinations: string[]; secrets: string[];
  query: (sql: string, ...args: SQLInputValue[]) => Promise<Record<string, unknown>[]>;
  sourceQuery: (sql: string, ...args: SQLInputValue[]) => Promise<Record<string, unknown>[]>;
  login: (id: string) => Promise<WebhookHeaders>; rotate: () => void; registryUnavailable: (value: boolean) => void;
  restart: () => Promise<void>; close: () => Promise<void>;
  roleQuery?: (role: 'api' | 'worker', sql: string, args?: unknown[]) => Promise<unknown>;
}
export const dispatchFixture = async (x: WebhookFixture, options: Parameters<typeof dispatchWebhook>[3] = {}): Promise<{result: 'idle' | 'processed'; status?: string}> => dispatchWebhook(x.store, x.queue, x.runtime, options);
function committed(file: string, details: object) {
  const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex'), marker = evidence + '/' + path.basename(file).slice(0, 3) + '-first-committed.json';
  if (fs.existsSync(marker)) { if (JSON.parse(fs.readFileSync(marker, 'utf8')).sha256 !== sha256) throw new Error('Committed webhook migration changed'); }
  else fs.writeFileSync(marker, JSON.stringify({ checkedAt: new Date().toISOString(), file, sha256, ...details }, null, 2) + '\n', { flag: 'wx' });
}
async function login(app: FastifyInstance, id: string) { const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { accountId: id } }); if (r.statusCode !== 200) throw new Error('Synthetic webhook login failed'); const cookie = r.headers['set-cookie']!.toString().split(';')[0], me = await app.inject({ url: '/api/v1/me', headers: { cookie } }); if (me.statusCode !== 200) throw new Error('Synthetic webhook me failed'); return { cookie, 'x-csrf-token': me.json().data.csrfToken as string }; }
async function privateConfig(dataDir: string, root: string) {
  const directory = dataDir + '-webhooks-private', registry = path.join(directory, 'receivers.private.json'); fs.mkdirSync(directory, { recursive: true });
  const secrets = [randomBytes(32).toString('base64url')], receiver = await webhookReceiver(() => secrets[secrets.length - 1]);
  const destinations = [randomUUID(), randomUUID(), randomUUID()], definition = { version: 1, environment: 'mock', appEnv: 'development', destinations: destinations.map((id, index) => ({ id, tenantId: index === 2 ? F.tenantB : F.tenantA, workspaceId: [F.workspaceA, F.workspacePrivate, F.workspaceB][index], name: '合成回调接收端' + (index + 1), mode: 'local_test', url: receiver.url, secretFile: path.join(directory, 'receiver.key') })) };
  const save = () => { fs.writeFileSync(registry, JSON.stringify(definition), { mode: 0o600 }); fs.writeFileSync(definition.destinations[0].secretFile, secrets[secrets.length - 1], { mode: 0o600 }); }; save();
  fs.writeFileSync(evidence + '/synthetic-provider-' + path.basename(root) + '.json', JSON.stringify({ root, port: receiver.port, mode: 'owned_loopback_only', externalDelivery: false }), { flag: 'wx' });
  return { registry, receiver, destinations, secrets, rotate: () => { secrets.push(randomBytes(32).toString('base64url')); save(); }, registryUnavailable: (value: boolean) => { if (value) fs.writeFileSync(registry, '{}'); else save(); } };
}
export async function sqliteWebhookFixture(): Promise<WebhookFixture> {
  const root = path.resolve('storage/test-runs/' + randomUUID()), privateFiles = await privateConfig(root, root);
  const h = await harness({ dataDir: root, developerWebhooksFile: privateFiles.registry }); let repo = h.repo;
  committed('migrations/sqlite/061-developer-webhooks.sql', { dataDir: root });
  const query = async (sql: string, ...args: SQLInputValue[]) => { if (/^SELECT\b/i.test(sql)) return repo.all<Record<string, unknown>>(sql, ...args); repo.run(sql, ...args); return []; };
  const x: WebhookFixture = { app: h.app, root, config: h.config, ...privateFiles, runtime: new WebhookRuntime(h.config), queue: new WebhookQueue(h.config), store: new SqliteWebhookStore(repo), query, sourceQuery: query, login: id => login(x.app, id),
    restart: async () => { await x.app.close(); repo.close(); repo = new Repository(root, h.config.root, { environment: 'mock', appEnv: 'development' }); x.store = new SqliteWebhookStore(repo); x.app = await createApp(h.config, repo); },
    close: async () => { try { await x.app.close(); } finally { repo.close(); await privateFiles.receiver.close(); } } };
  return x;
}
export async function nativeWebhookFixture(): Promise<WebhookFixture> {
  const h = await nativeRuntimeFixture({ onInitialized: async (result, cluster) => { committed('migrations/postgres/140-native-developer-webhooks.sql', { root: cluster.root, schema: result.schema, runtime: 137 }); await observeRecoveryClusters(evidence + '/observed-webhook-native-' + path.basename(cluster.root) + '.json', cluster.observedPids, cluster.port); fs.writeFileSync(evidence + '/native-' + path.basename(cluster.root) + '.json', JSON.stringify({ root: cluster.root, port: cluster.port, schema: result.schema }), { flag: 'wx' }); } });
  let worker = h.workerDb; const privateFiles = await privateConfig(h.config.dataDir, h.cluster.root), config = { ...h.config, developerWebhooksFile: privateFiles.registry }; await h.app.close();
  const roleQuery = async (role: 'api' | 'worker', sql: string, args: unknown[] = []) => { const db = createPostgresClient(h.result[role].connection); await db.connect(); try { await db.query('SET search_path TO "' + h.result.schema + '",pg_catalog,pg_temp'); return (await db.query(sql, args)).rows; } finally { await db.end(); } };
  const x: WebhookFixture = { app: await createApp(config), root: h.cluster.root, config, ...privateFiles, runtime: new WebhookRuntime(config), queue: new WebhookQueue(config, true), store: new NativeWebhookStore(worker),
    query: (sql, ...args) => h.owner(async db => { let i = 0; return (await db.query(sql.replace(/\?/g, () => '$' + (++i)), args)).rows; }),
    sourceQuery: async (sql, ...args) => { let i = 0; return await roleQuery('worker', sql.replace(/\?/g, () => '$' + (++i)), args) as Record<string, unknown>[]; }, roleQuery, login: id => login(x.app, id),
    restart: async () => { await x.app.close(); await worker.close(); worker = await NativePostgresDatabase.open(h.result.worker, 'worker'); x.store = new NativeWebhookStore(worker); x.app = await createApp(config); },
    close: async () => { try { await x.app.close(); await worker.close(); } finally { await privateFiles.receiver.close(); await h.close(); } } };
  return x;
}
