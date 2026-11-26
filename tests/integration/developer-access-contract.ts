import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureIds as F } from '../../packages/test-fixtures/src/seed.js';
import { createDeveloperCredential } from '../../packages/enterprise/src/developer-credentials.js';
import type { DeveloperMutationResult, DeveloperView } from '../../packages/contracts/src/developer-access.js';
import type { DeveloperFixture, DeveloperHeaders } from './developer-access-fixtures.js';
export function developerAccessContract(factory: () => Promise<DeveloperFixture>, dialect: 'sqlite' | 'postgres') {
  describe.sequential(dialect + ' 开发者应用与独立机器读取', () => {
    let x: DeveloperFixture, admin: DeveloperHeaders, viewer: DeveloperHeaders, appId: string, token: string, credentialId: string, projectId: string, exportId: string;
    const secrets: string[] = [];
    function retain() { fs.writeFileSync(path.join(x.root, 'developer-contract-state.private.json'), JSON.stringify({ appId, token, credentialId, projectId, exportId, admin, viewer, secrets }, null, 2) + '\n', { mode: 0o600 }); }
    async function post(action: string, body: object, headers = admin, key = randomUUID()) { return x.app.inject({ method: 'POST', url: '/api/v1/enterprise/developers/' + action, headers: { ...headers, 'idempotency-key': key }, payload: body }); }
    async function view() { const r = await x.app.inject({ url: '/api/v1/enterprise/developers?workspaceId=' + F.workspaceA, headers: admin }); expect(r.statusCode).toBe(200); return r.json().data as DeveloperView; }
    async function app() { return (await view()).apps.find(a => a.id === appId)!; }
    async function machine(suffix = '/context', key = token, headers: Record<string, string> = {}) { return x.app.inject({ url: '/api/open/v1' + suffix, headers: { ...headers, authorization: 'Bearer ' + key } }); }
    async function issue(key = randomUUID()) { const old = await app(), r = await post('issue', { workspaceId: F.workspaceA, appId, expectedVersion: old.version, termDays: 30, confirmed: true }, admin, key); expect(r.statusCode).toBe(200); const result = r.json().data as DeveloperMutationResult; if (result.issuedCredential?.oneTimeToken) secrets.push(result.issuedCredential.oneTimeToken); retain(); return result; }
    beforeAll(async () => { x = await factory(); admin = await x.login(F.adminA); viewer = await x.login(F.viewerA); }, 180000);
    afterAll(async () => { await x?.close(); }, 90000);
    it('人员权限、CSRF和确认条件在服务端检查', async () => {
      const body = { workspaceId: F.workspaceA, name: '合成制作读取应用', scopes: ['projects.read'], confirmed: true };
      expect((await post('create', body, viewer)).statusCode).toBe(403);
      expect((await post('create', body, { ...admin, 'x-csrf-token': 'invalid' })).statusCode).toBe(403);
      expect((await post('create', { ...body, confirmed: false })).statusCode).toBe(400);
      expect((await post('create', { ...body, workspaceId: F.workspaceB })).statusCode).toBeGreaterThanOrEqual(400);
    });
    it('创建单空间应用并保留最低事件，不接受任意读取范围', async () => {
      const r = await post('create', { workspaceId: F.workspaceA, name: '合成制作读取应用', scopes: ['projects.read'], confirmed: true }); expect(r.statusCode).toBe(200);
      const result = r.json().data as DeveloperMutationResult; appId = result.view.apps.find(a => a.name === '合成制作读取应用')!.id; retain();
      expect(result.view.canManageOrganization).toBe(true); expect(result.issuedCredential).toBeUndefined();
      expect((await post('create', { workspaceId: F.workspaceA, name: '合成拒绝范围', scopes: ['people.read'], confirmed: true })).statusCode).toBe(400);
    });
    it('只首次返回完整密钥，幂等重试保留原凭证且持久记录不含原密钥', async () => {
      const key = randomUUID(), before = Number((await x.query('SELECT count(*) n FROM auth_sessions'))[0].n), issued = await issue(key);
      token = issued.issuedCredential!.oneTimeToken!; credentialId = issued.issuedCredential!.id; retain();
      const old = (await x.query('SELECT request_hash,response FROM idempotency WHERE key=?', key))[0];
      const input = { workspaceId: F.workspaceA, appId, expectedVersion: issued.view.apps.find(a => a.id === appId)!.version - 1, termDays: 30, confirmed: true };
      const replay = await post('issue', input, admin, key); expect(replay.statusCode).toBe(200); const again = replay.json().data as DeveloperMutationResult;
      expect(again.receiptId).toBe(issued.receiptId); expect(again.issuedCredential!.id).toBe(credentialId); expect(again.issuedCredential!.oneTimeToken).toBeNull();
      for (const table of ['developer_apps', 'developer_credentials', 'developer_events', 'idempotency', 'audit_events']) { const text = JSON.stringify(await x.query('SELECT * FROM ' + table)); for (const secret of secrets) expect(text.includes(secret)).toBe(false); }
      expect(JSON.stringify(old.response).includes(token)).toBe(false); expect(Number((await x.query('SELECT count(*) n FROM auth_sessions'))[0].n)).toBe(before);
    });
    it('应用身份独立于员工会话，错误Bearer不会回退到已有人员cookie', async () => {
      const response = await machine(); expect(response.statusCode).toBe(200); expect(response.json().data.identity).toBe('organization_application');
      expect((await x.app.inject({ url: '/api/v1/me', headers: { authorization: 'Bearer ' + token } })).statusCode).toBe(401);
      expect((await x.app.inject({ url: '/api/open/v1/context', headers: admin })).statusCode).toBe(401);
      expect((await machine('/context', token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'), admin)).statusCode).toBe(401);
      expect((await machine('/context?token=forbidden-query')).statusCode).toBe(400);
      expect((await machine('/projects?workspaceId=' + F.workspacePrivate)).statusCode).toBe(400);
    });
    it('实际创建工程，公开列表及单项只返回同空间同环境元数据', async () => {
      const r = await x.app.inject({ method: 'POST', url: '/api/v1/studio/projects', headers: { ...admin, 'idempotency-key': randomUUID() }, payload: { workspaceId: F.workspaceA, name: '合成开放接口工程', purpose: 'video' } }); expect(r.statusCode).toBe(200); projectId = r.json().data.id; retain();
      for (const [w, env, appEnv] of [[F.workspacePrivate, 'mock', 'development'], [F.workspaceA, 'live', 'development'], [F.workspaceA, 'mock', 'sandbox']]) await x.query('INSERT INTO studio_projects VALUES(?,?,?,?,?,?,1,0,?,?,?,?)', randomUUID(), F.tenantA, w, '合成不可见工程', 'video', '{}', env, appEnv, new Date().toISOString(), new Date().toISOString());
      const list = await machine('/projects?limit=100'); expect(list.statusCode).toBe(200); const items = list.json().data.items;
      expect(items.some((v: { id: string }) => v.id === projectId)).toBe(true); expect(items.some((v: { name: string }) => v.name === '合成不可见工程')).toBe(false);
      const detail = await machine('/projects/' + projectId); expect(detail.statusCode).toBe(200); expect(detail.json().data.document).toBeUndefined(); expect(detail.json().data.name).toBe('合成开放接口工程');
      expect((await machine('/projects/' + randomUUID())).statusCode).toBe(404);
    });
    it('未授权的导出状态请求拒绝且计入持久限频', async () => {
      const before = Number((await x.query('SELECT request_count FROM developer_rate_windows WHERE credential_id=?', credentialId))[0].request_count);
      const r = await machine('/exports'); expect(r.statusCode).toBe(403); expect(r.json().error.code).toBe('DEVELOPER_SCOPE_REQUIRED');
      const after = Number((await x.query('SELECT request_count FROM developer_rate_windows WHERE credential_id=?', credentialId))[0].request_count); expect(after === before + 1 || after === 1).toBe(true);
    });
    it('限频在数据库持久化，满窗口拒绝而到达下一窗口可继续', async () => {
      for (let attempt = 0; attempt < 2; attempt++) { const window = new Date().toISOString().slice(0, 16); await x.query('UPDATE developer_rate_windows SET window_start=?,request_count=60 WHERE credential_id=?', window, credentialId); const r = await machine(); if (r.statusCode === 429) { expect(r.headers['retry-after']).toBe('60'); break; } expect(new Date().toISOString().slice(0, 16)).not.toBe(window); if (attempt === 1) throw new Error('No rate rejection was observed'); }
      await x.query('UPDATE developer_rate_windows SET window_start=?,request_count=60 WHERE credential_id=?', '2000-01-01T00:00', credentialId); expect((await machine()).statusCode).toBe(200);
    });
    it('两份有效密钥上限与并发修订校验不会超发', async () => {
      const old = await app(), body = { workspaceId: F.workspaceA, appId, expectedVersion: old.version, termDays: 7, confirmed: true };
      const responses = await Promise.all([post('issue', body), post('issue', body)]); expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
      for (const r of responses.filter(r => r.statusCode === 200)) secrets.push((r.json().data as DeveloperMutationResult).issuedCredential!.oneTimeToken!);
      expect(Number((await x.query('SELECT count(*) n FROM developer_credentials WHERE app_id=? AND revoked_at IS NULL AND expires_at>?', appId, new Date().toISOString()))[0].n)).toBe(2);
      expect((await post('issue', { ...body, expectedVersion: (await app()).version })).statusCode).toBe(409);
    });
    it('撤销立即拒绝原密钥，同一撤销确认复用原回执', async () => {
      const body = { workspaceId: F.workspaceA, appId, credentialId, expectedVersion: (await app()).version, confirmed: true }, key = randomUUID();
      const first = await post('revoke', body, admin, key); expect(first.statusCode).toBe(200); expect((await machine()).statusCode).toBe(401);
      const again = await post('revoke', body, admin, key); expect(again.statusCode).toBe(200); expect(again.json().data.receiptId).toBe(first.json().data.receiptId); expect(again.json().data.issuedCredential).toBeUndefined();
    });
    it('范围变更撤销现有密钥并允许新凭证读取限定的导出状态', async () => {
      const old = await app(), changed = await post('control', { workspaceId: F.workspaceA, appId, expectedVersion: old.version, name: old.name, scopes: ['projects.read', 'exports.read'], enabled: true, confirmed: true }); expect(changed.statusCode).toBe(200);
      expect(Number((await x.query('SELECT count(*) n FROM developer_credentials WHERE app_id=? AND revoked_at IS NULL', appId))[0].n)).toBe(0);
      const issued = await issue(); token = issued.issuedCredential!.oneTimeToken!; credentialId = issued.issuedCredential!.id; retain();
      exportId = randomUUID(); retain(); const at = new Date().toISOString();
      await x.query('INSERT INTO studio_exports(id,project_id,tenant_id,workspace_id,actor_id,project_version,plan_hash,kind,settings,start_ms,duration_ms,status,attempts,progress,rights_confirmed_at,environment,app_env,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?,0,1000,?,0,0,?,?,?,?,?)', exportId, projectId, F.tenantA, F.workspaceA, F.adminA, '0'.repeat(64), 'mp4', '{}', 'queued', at, 'mock', 'development', at, at);
      const r = await machine('/exports/' + exportId); expect(r.statusCode).toBe(200); expect(r.json().data.projectId).toBe(projectId); expect(r.json().data.status).toBe('queued'); expect(r.json().data.settings).toBeUndefined(); expect(r.json().data.result).toBeUndefined();
    });
    it('停用再启用不复活旧凭证，新的签发独立生效', async () => {
      let current = await app(); expect((await post('control', { workspaceId: F.workspaceA, appId, expectedVersion: current.version, name: current.name, scopes: current.scopes, enabled: false, confirmed: true })).statusCode).toBe(200); expect((await machine()).statusCode).toBe(401);
      current = await app(); expect((await post('control', { workspaceId: F.workspaceA, appId, expectedVersion: current.version, name: current.name, scopes: current.scopes, enabled: true, confirmed: true })).statusCode).toBe(200); expect((await machine()).statusCode).toBe(401);
      const issued = await issue(); token = issued.issuedCredential!.oneTimeToken!; credentialId = issued.issuedCredential!.id; retain(); expect((await machine()).statusCode).toBe(200);
    });
    it('已过期、其他环境和其他应用环境的正确密钥也拒绝', async () => {
      for (const [env, appEnv, expired] of [['mock', 'development', true], ['live', 'development', false], ['mock', 'sandbox', false]] as const) {
        const id = randomUUID(), key = createDeveloperCredential(), at = new Date(Date.now() - 8 * 86400000).toISOString(), expires = new Date(Date.now() + (expired ? -1 : 1) * 86400000).toISOString();
        await x.query('INSERT INTO developer_apps VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, F.tenantA, F.workspaceA, env, appEnv, '合成环境拒绝应用', '["projects.read"]', 1, 1, F.adminA, at, at);
        await x.query('INSERT INTO developer_credentials VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', key.id, id, F.tenantA, F.workspaceA, env, appEnv, key.hash, expires, null, F.adminA, at, 1);
        expect((await machine('/context', key.token)).statusCode).toBe(401);
      }
    });
    it('旧修订与幂等冲突不改授权，原密钥和事件不可被改写', async () => {
      const current = await app(), before = await x.query('SELECT * FROM developer_credentials WHERE app_id=? ORDER BY id', appId);
      expect((await post('control', { workspaceId: F.workspaceA, appId, expectedVersion: 1, name: current.name, scopes: current.scopes, enabled: true, confirmed: true })).statusCode).toBe(409);
      await expect(x.query('UPDATE developer_credentials SET secret_hash=? WHERE id=?', 'f'.repeat(64), credentialId)).rejects.toBeDefined();
      await expect(x.query('DELETE FROM developer_events WHERE app_id=?', appId)).rejects.toBeDefined();
      expect(await x.query('SELECT * FROM developer_credentials WHERE app_id=? ORDER BY id', appId)).toEqual(before);
    });
    it('服务重启保留原管理员登录、当前密钥与导出状态', async () => {
      const before = await x.query('SELECT * FROM developer_apps ORDER BY id'); await x.restart();
      expect(await x.query('SELECT * FROM developer_apps ORDER BY id')).toEqual(before); expect((await view()).apps.some(a => a.id === appId)).toBe(true); expect((await machine()).statusCode).toBe(200); expect((await machine('/exports/' + exportId)).statusCode).toBe(200);
    });
    if (dialect === 'postgres') it('数据库函数拒绝空摘要且worker无执行或密钥表访问授权', async () => {
      expect(await x.nativeCall!(null)).toMatchObject({ error: { code: 'DEVELOPER_AUTH_REQUIRED', status: 401 } });
      await expect(x.workerCall!()).rejects.toMatchObject({ code: '42501' });
      expect((await x.query("SELECT has_table_privilege('dg_native_worker','developer_credentials','SELECT') allowed"))[0].allowed).toBe(false);
    });
  });
}
