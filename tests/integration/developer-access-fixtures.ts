import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { Repository } from '../../packages/database/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { harness } from './helpers.js';
import { nativeRuntimeFixture } from './postgres-runtime-helpers.js';
import { createPostgresClient } from '../../packages/postgres/src/config.js';
import { observeRecoveryClusters } from '../../scripts/native-recovery-owned.js';
const evidence = 'docs/evidence/T35/developer-access';
export type DeveloperHeaders = { cookie: string; 'x-csrf-token': string };
export interface DeveloperFixture { app: FastifyInstance; root: string; query: (sql: string, ...args: SQLInputValue[]) => Promise<Record<string, unknown>[]>; login: (userId: string) => Promise<DeveloperHeaders>; restart: () => Promise<void>; close: () => Promise<void>; nativeCall?: (hash: string | null, credentialId?: string) => Promise<unknown>; workerCall?: () => Promise<unknown> }
function committed(file: string, details: object) { const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex'), marker = evidence + '/' + path.basename(file).slice(0, 3) + '-first-committed.json'; if (fs.existsSync(marker)) { if (JSON.parse(fs.readFileSync(marker, 'utf8')).sha256 !== sha256) throw new Error('Committed developer migration changed'); } else fs.writeFileSync(marker, JSON.stringify({ checkedAt: new Date().toISOString(), file, sha256, ...details }, null, 2) + '\n', { flag: 'wx' }); }
async function login(app: FastifyInstance, userId: string) { const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { accountId: userId } }); if (r.statusCode !== 200) throw new Error('Synthetic developer fixture login failed'); const cookie = r.headers['set-cookie']!.toString().split(';')[0], me = await app.inject({ url: '/api/v1/me', headers: { cookie } }); if (me.statusCode !== 200) throw new Error('Synthetic developer fixture identity failed'); return { cookie, 'x-csrf-token': me.json().data.csrfToken as string }; }
export async function sqliteDeveloperFixture(): Promise<DeveloperFixture> {
  const h = await harness(); let repo = h.repo;
  committed('migrations/sqlite/060-developer-access.sql', { dataDir: h.config.dataDir });
  const fixture: DeveloperFixture = { app: h.app, root: h.config.dataDir, query: async (sql, ...args) => { if (/^SELECT/i.test(sql)) return repo.all(sql, ...args); repo.run(sql, ...args); return []; }, login: id => login(fixture.app, id), restart: async () => { await fixture.app.close(); repo.close(); repo = new Repository(h.config.dataDir, h.config.root, { environment: 'mock', appEnv: h.config.appEnv }); fixture.app = await createApp(h.config, repo); }, close: async () => { await fixture.app.close(); repo.close(); } };
  return fixture;
}
export async function nativeDeveloperFixture(): Promise<DeveloperFixture> {
  const x = await nativeRuntimeFixture({ onInitialized: async (result, cluster) => { committed('migrations/postgres/139-native-developer-access.sql', { root: cluster.root, schema: result.schema, runtime: 136 }); await observeRecoveryClusters(evidence + '/observed-developer-native-' + path.basename(cluster.root) + '.json', cluster.observedPids, cluster.port); fs.writeFileSync(evidence + '/native-' + path.basename(cluster.root) + '.json', JSON.stringify({ root: cluster.root, port: cluster.port, schema: result.schema }), { flag: 'wx' }); } });
  const fixture: DeveloperFixture = { app: x.app, root: x.cluster.root, query: async (sql, ...args) => x.owner(async db => { let i = 0; return (await db.query(sql.replace(/\?/g, () => '$' + (++i)), args)).rows; }), login: id => login(fixture.app, id), restart: async () => { await fixture.app.close(); fixture.app = await createApp(x.config); }, close: async () => { await fixture.app.close(); await x.close(); }, nativeCall: async (hash, credentialId) => { const db = createPostgresClient(x.result.api.connection); await db.connect(); try { await db.query('SET search_path TO "' + x.result.schema + '",pg_catalog,pg_temp'); return (await db.query('SELECT dg_native_developer_read($1,$2,\'context\',\'\',\'\',20) value', [credentialId ?? null, hash])).rows[0].value; } finally { await db.end(); } }, workerCall: async () => { const db = createPostgresClient(x.result.worker.connection); await db.connect(); try { await db.query('SET search_path TO "' + x.result.schema + '",pg_catalog,pg_temp'); return await db.query("SELECT dg_native_developer_read(NULL,NULL,'context','','',20)"); } finally { await db.end(); } } };
  return fixture;
}
