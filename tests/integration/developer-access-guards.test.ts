import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixtureIds as F } from '../../packages/test-fixtures/src/seed.js';
import { sqliteDeveloperFixture, nativeDeveloperFixture, type DeveloperFixture, type DeveloperHeaders } from './developer-access-fixtures.js';
import type { DeveloperMutationResult } from '../../packages/contracts/src/developer-access.js';
import { createDeveloperCredential } from '../../packages/enterprise/src/developer-credentials.js';
for (const dialect of ['sqlite', 'postgres'] as const) describe.sequential(dialect + ' 开发者授权与事务边界补验', () => {
  let x: DeveloperFixture, admin: DeveloperHeaders, appId: string, credentialId: string, token: string;
  const post = (suffix: string, body: object, headers = admin) => x.app.inject({ method: 'POST', url: '/api/v1/' + suffix, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: body });
  const machine = (suffix: string) => x.app.inject({ url: '/api/open/v1' + suffix, headers: { authorization: 'Bearer ' + token } });
  async function snapshot() { const out: Record<string, unknown> = {}; for (const table of ['developer_apps', 'developer_credentials', 'developer_events', 'idempotency']) out[table] = await x.query('SELECT * FROM ' + table + (table === 'idempotency' ? ' ORDER BY tenant_id,actor_id,action,key' : ' ORDER BY id')); return out; }
  beforeAll(async () => {
    x = await (dialect === 'sqlite' ? sqliteDeveloperFixture() : nativeDeveloperFixture()); admin = await x.login(F.adminA);
    const created = await post('enterprise/developers/create', { workspaceId: F.workspaceA, name: '合成接入边界应用', scopes: ['projects.read', 'exports.read'], confirmed: true }); expect(created.statusCode).toBe(200); appId = (created.json().data as DeveloperMutationResult).view.apps[0].id;
    const issued = await post('enterprise/developers/issue', { workspaceId: F.workspaceA, appId, expectedVersion: 1, termDays: 7, confirmed: true }); expect(issued.statusCode).toBe(200); const value = (issued.json().data as DeveloperMutationResult).issuedCredential!; token = value.oneTimeToken!; credentialId = value.id;
  }, 180000);
  afterAll(async () => x?.close(), 90000);
  it('部分空间管理员只能核对，权限被撤回后的旧cookie不能管理应用', async () => {
    const userId = randomUUID(), created = await post('enterprise/members/create', { workspaceId: F.workspaceA, userId, name: '合成有限管理员', role: 'admin', workspaceIds: [F.workspaceA], confirmed: true }); expect(created.statusCode).toBe(200);
    const partial = await x.login(userId), view = await x.app.inject({ url: '/api/v1/enterprise/developers?workspaceId=' + F.workspaceA, headers: partial }); expect(view.statusCode).toBe(200); expect(view.json().data.canManageOrganization).toBe(false);
    expect((await post('enterprise/developers/create', { workspaceId: F.workspaceA, name: '合成拒绝创建', scopes: ['projects.read'], confirmed: true }, partial)).statusCode).toBe(403);
    expect((await post('enterprise/members/access', { workspaceId: F.workspaceA, userId, version: 1, role: 'viewer', workspaceIds: [F.workspaceA], confirmed: true })).statusCode).toBe(200);
    expect((await x.app.inject({ url: '/api/v1/enterprise/developers?workspaceId=' + F.workspaceA, headers: partial })).statusCode).toBe(401);
  });
  it('实际跨空间与跨组织工程均不可见，分页不返回正文且持久数据无密钥任何明文部分', async () => {
    const other = await x.login(F.adminB), visible: string[] = [];
    for (const [workspaceId, headers] of [[F.workspaceA, admin], [F.workspaceA, admin], [F.workspacePrivate, admin], [F.workspaceB, other]] as const) { const r = await post('studio/projects', { workspaceId, name: '合成边界工程', purpose: 'video' }, headers); expect(r.statusCode).toBe(200); const id = r.json().data.id as string; if (workspaceId === F.workspaceA) visible.push(id); else expect((await machine('/projects/' + id)).statusCode).toBe(404); }
    let cursor = '', found: string[] = [];
    do { const r = await machine('/projects?limit=1' + (cursor ? '&cursor=' + cursor : '')); expect(r.statusCode).toBe(200); const data = r.json().data; found = [...found, ...data.items.map((p: { id: string }) => p.id)]; cursor = data.nextCursor ?? ''; expect(data.items.every((p: object) => !('document' in p))).toBe(true); } while (cursor && found.length < 20);
    expect(found.sort()).toEqual(visible.sort()); const body = JSON.stringify(await snapshot()); expect(body.includes(token)).toBe(false); expect(body.includes(token.split('.')[1])).toBe(false);
    if (x.nativeCall) expect(await x.nativeCall(null, credentialId)).toMatchObject({ error: { code: 'DEVELOPER_AUTH_REQUIRED', status: 401 } });
  });
  it('回执阶段故障回滚已生成凭证、应用修订及幂等记录，原凭证仍有效', async () => {
    const before = await snapshot();
    if (dialect === 'sqlite') await x.query("CREATE TRIGGER developer_fault BEFORE INSERT ON developer_events WHEN NEW.action='credential.issued' BEGIN SELECT RAISE(ABORT,'synthetic developer receipt fault');END");
    else { await x.query("CREATE FUNCTION dg_test_developer_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='synthetic developer receipt fault';END;$$"); await x.query("CREATE TRIGGER developer_fault BEFORE INSERT ON developer_events FOR EACH ROW WHEN(NEW.action='credential.issued') EXECUTE FUNCTION dg_test_developer_fault()"); }
    try { const response = await post('enterprise/developers/issue', { workspaceId: F.workspaceA, appId, expectedVersion: 2, termDays: 7, confirmed: true }); expect(response.statusCode).toBeGreaterThanOrEqual(400); expect(response.payload.includes('dgk_')).toBe(false); } finally { await x.query('DROP TRIGGER developer_fault' + (dialect === 'postgres' ? ' ON developer_events' : '')); if (dialect === 'postgres') await x.query('DROP FUNCTION dg_test_developer_fault()'); }
    expect(await snapshot()).toEqual(before); expect((await machine('/context')).statusCode).toBe(200);
  });
  it('同一凭证并发请求原子占用剩余窗口，拒绝请求不使计数超过上限', async () => {
    if (Date.now() % 60000 > 58000) await new Promise(resolve => setTimeout(resolve, 2200));
    await x.query('UPDATE developer_rate_windows SET window_start=?,request_count=58 WHERE credential_id=?', new Date().toISOString().slice(0, 16), credentialId);
    const responses = await Promise.all(Array.from({ length: 4 }, () => machine('/context'))); expect(responses.map(r => r.statusCode).sort()).toEqual([200, 200, 429, 429]);
    expect(Number((await x.query('SELECT request_count FROM developer_rate_windows WHERE credential_id=?', credentialId))[0].request_count)).toBe(60);
  });
  it('有效老凭证始终可管理，不被最近三十条已撤销历史挤出列表', async () => {
    const at = new Date().toISOString(), expires = new Date(Date.now() + 86400000).toISOString();
    for (let i = 0; i < 31; i++) { const key = createDeveloperCredential(); await x.query('INSERT INTO developer_credentials VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', key.id, appId, F.tenantA, F.workspaceA, 'mock', 'development', key.hash, expires, at, F.adminA, at, 1); }
    const response = await x.app.inject({ url: '/api/v1/enterprise/developers?workspaceId=' + F.workspaceA, headers: admin }); expect(response.statusCode).toBe(200);
    const app = (response.json().data as DeveloperMutationResult['view']).apps.find(a => a.id === appId)!;
    expect(app.credentials).toHaveLength(30); expect(app.credentials[0].id).toBe(credentialId); expect(app.credentials[0].status).toBe('active'); expect(app.credentialHistoryTruncated).toBe(true);
  });
});
