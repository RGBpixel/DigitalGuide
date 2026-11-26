import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../apps/api/src/app.js';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { await h.close(); });
describe('角色版本、路由及环境边界', () => {
  it('保存角色快照；过期素材、旧版本或未绑定场景拒绝路由', async () => {
    const headers = () => ({ ...h.headers, 'idempotency-key': randomUUID() });
    const payload = { workspaceId: f.workspaceA, name: '虚构跨场景讲解员', avatarAssetId: f.avatarA, voiceAssetId: f.voiceA, scenes: ['video', 'reception'] };
    const created = await h.app.inject({ method: 'POST', url: '/api/v1/profiles', headers: headers(), payload }); expect(created.statusCode).toBe(201);
    const profileId = created.json().data.id;
    const resolve = (scene: string, version = 1) => h.app.inject({ method: 'POST', url: '/api/v1/profiles/' + profileId + '/resolve', headers: headers(), payload: { scene, version } });
    expect((await resolve('reception')).json().data.readyForRealService).toBe(false);
    expect((await resolve('restaurant')).statusCode).toBe(409);
    const update = await h.app.inject({ method: 'PUT', url: '/api/v1/profiles/' + profileId, headers: headers(), payload: { name: '新版本', scenes: ['reception'], version: 1 } }); expect(update.statusCode).toBe(200);
    expect((await resolve('reception')).json().error.code).toBe('VERSION_CONFLICT');
    const versions = await h.app.inject({ url: '/api/v1/profiles/' + profileId + '/versions', headers: h.headers }); expect(versions.json().data).toHaveLength(2);
    h.repo.run("UPDATE assets SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", f.avatarA);
    expect((await resolve('reception', 2)).json().error.code).toBe('ASSET_EXPIRED');
    const other = await h.login(f.adminB);
    expect((await h.app.inject({ url: '/api/v1/profiles/' + profileId, headers: other })).statusCode).toBe(404);
  });
  it('不能跨工作空间或租户绑定素材', async () => {
    for (const assetId of [f.privateAsset, f.avatarB]) {
      const r = await h.app.inject({ method: 'POST', url: '/api/v1/profiles', headers: { ...h.headers, 'idempotency-key': randomUUID() }, payload: { workspaceId: f.workspaceA, name: '非法绑定', avatarAssetId: assetId, scenes: ['reception'] } });
      expect(r.statusCode).toBe(404);
    }
  });
  it('生产禁用演示登录；live 无适配器时明确报错，不模拟成功', async () => {
    const prod = await createApp({ ...h.config, appEnv: 'production', providerMode: 'live' }, h.repo);
    expect((await prod.inject('/api/v1/auth/demo-accounts')).statusCode).toBe(404);
    expect((await prod.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { accountId: f.adminA } })).statusCode).toBe(403);
    expect((await prod.inject({ url: '/api/v1/me', headers: h.headers })).statusCode).toBe(401);
    await prod.close();
    const live = await createApp({ ...h.config, providerMode: 'live' }, h.repo);
    const login = await live.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { accountId: f.adminA } });
    const cookie = login.headers['set-cookie']!.toString().split(';')[0];
    const me = await live.inject({ url: '/api/v1/me', headers: { cookie } });
    const result = await live.inject({ method: 'POST', url: '/api/v1/jobs', headers: { cookie, 'x-csrf-token': me.json().data.csrfToken, 'idempotency-key': randomUUID() }, payload: { workspaceId: f.workspaceA, kind: 'provider.check' } });
    expect(result.json().error.code).toBe('PROVIDER_NOT_CONFIGURED'); await live.close();
  });
});
