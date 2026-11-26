import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { syntheticPng } from '@digitalguide/media';
import { assetSchema } from '@digitalguide/contracts';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h.close(); });
describe('鉴权、隔离、素材及授权 API', () => {
  it('拒绝未登录、伪造 cookie、CSRF 和非法来源；注销后令牌失效', async () => {
    expect((await h.app.inject('/api/v1/assets')).statusCode).toBe(401);
    expect((await h.app.inject({ url: '/api/v1/me', headers: { cookie: 'dg_session=forged' } })).statusCode).toBe(401);
    const payload = { workspaceId: f.workspaceA, kind: 'provider.check' };
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/jobs', payload, headers: { cookie: h.headers.cookie } })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { accountId: f.adminA }, headers: { origin: 'https://untrusted.invalid' } })).statusCode).toBe(403);
    await h.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: h.headers });
    expect((await h.app.inject({ url: '/api/v1/me', headers: h.headers })).statusCode).toBe(401);
  });
  it('同租户私有工作空间和跨租户资产、内容、授权均不可读', async () => {
    const editor = await h.login(f.editorA);
    for (const assetId of [f.privateAsset, f.avatarB]) for (const suffix of ['', '/content', '/consents', '/versions']) expect((await h.app.inject({ url: '/api/v1/assets/' + assetId + suffix, headers: editor })).statusCode).toBe(404);
    expect((await h.app.inject({ url: '/api/v1/assets?workspaceId=' + f.workspacePrivate, headers: editor })).statusCode).toBe(404);
    const list = await h.app.inject({ url: '/api/v1/assets', headers: editor });
    expect(list.json().data.items.map((a: { id: string }) => a.id).sort()).toEqual([f.avatarA, f.voiceA]);
    const viewer = await h.login(f.viewerA);
    expect((await h.app.inject({ method: 'PATCH', url: '/api/v1/assets/' + f.avatarA, headers: { ...viewer, 'idempotency-key': randomUUID() }, payload: { version: 1, name: '越权改名' } })).statusCode).toBe(403);
    expect((await h.app.inject({ url: '/api/v1/audit-events', headers: editor })).statusCode).toBe(403);
  });
  it('校验真实媒体内容，上传/确认各自幂等，重复或跨租户消费上传被拒绝', async () => {
    const key = randomUUID(), headers = { ...h.headers, 'idempotency-key': key }, payload = { workspaceId: f.workspaceA, fileName: 'not-trusted.png', contentBase64: syntheticPng().toString('base64') };
    const upload = await h.app.inject({ method: 'POST', url: '/api/v1/assets/uploads', headers, payload });
    expect(upload.statusCode).toBe(201);
    const repeat = await h.app.inject({ method: 'POST', url: '/api/v1/assets/uploads', headers, payload });
    expect(repeat.json().data.uploadId).toBe(upload.json().data.uploadId);
    const mismatch = await h.app.inject({ method: 'POST', url: '/api/v1/assets/uploads', headers, payload: { ...payload, fileName: 'changed.png' } });
    expect(mismatch.statusCode).toBe(409);
    const bad = await h.app.inject({ method: 'POST', url: '/api/v1/assets/uploads', headers: { ...h.headers, 'idempotency-key': randomUUID() }, payload: { ...payload, contentBase64: Buffer.from('arbitrary file pretending to be PNG').toString('base64') } });
    expect(bad.json().error.code).toBe('INVALID_MEDIA');
    const assetPayload = { uploadId: upload.json().data.uploadId, name: '测试持久素材', category: 'avatar' };
    const b = await h.login(f.adminB);
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/assets', headers: { ...b, 'idempotency-key': randomUUID() }, payload: assetPayload })).statusCode).toBe(404);
    const asset = await h.app.inject({ method: 'POST', url: '/api/v1/assets', headers: { ...h.headers, 'idempotency-key': randomUUID() }, payload: assetPayload });
    expect(asset.statusCode).toBe(201);
    expect(assetSchema.safeParse(asset.json().data).success).toBe(true);
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/assets', headers: { ...h.headers, 'idempotency-key': randomUUID() }, payload: assetPayload })).statusCode).toBe(409);
    const content = await h.app.inject({ url: '/api/v1/assets/' + asset.json().data.id + '/content', headers: h.headers });
    expect(content.rawPayload).toEqual(syntheticPng());
  });
  it('乐观版本锁与回收站有效；审计不保存授权证明原文', async () => {
    const patch = () => h.app.inject({ method: 'PATCH', url: '/api/v1/assets/' + f.avatarA, headers: { ...h.headers, 'idempotency-key': randomUUID() }, payload: { version: 1, archived: true } });
    expect((await patch()).statusCode).toBe(200); expect((await patch()).statusCode).toBe(409);
    expect((await h.app.inject({ url: '/api/v1/assets/' + f.avatarA + '/content', headers: h.headers })).statusCode).toBe(409);
    const trash = await h.app.inject({ url: '/api/v1/assets?archived=true', headers: h.headers }); expect(trash.json().data.items).toHaveLength(1);
    expect(readFileSync('apps/web/src/api.ts', 'utf8')).not.toContain('SESSION_SECRET');
    expect((await h.app.inject({ url: '/api/v1/me', headers: h.headers })).body).not.toContain(h.config.sessionSecret);
  });
  it('列表分页完整且不重复；拒绝客户端租户注入和无效限制', async () => {
    const first = await h.app.inject({ url: '/api/v1/assets?limit=1', headers: h.headers });
    const next = await h.app.inject({ url: '/api/v1/assets?limit=1&cursor=' + first.json().data.nextCursor, headers: h.headers });
    expect(first.json().data.items[0].id).not.toBe(next.json().data.items[0].id);
    expect((await h.app.inject({ url: '/api/v1/assets?limit=0', headers: h.headers })).statusCode).toBe(400);
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/jobs', headers: { ...h.headers, 'idempotency-key': randomUUID() }, payload: { tenantId: f.tenantB, workspaceId: f.workspaceA, kind: 'provider.check' } })).statusCode).toBe(400);
  });
  it('损坏 JSON 和不支持的请求格式给出可修正的客户端错误', async () => {
    const malformed = await h.app.inject({ method: 'POST', url: '/api/v1/jobs', headers: { ...h.headers, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, payload: '{broken' });
    expect(malformed.statusCode).toBe(400); expect(malformed.json().error.retryable).toBe(false);
    const unsupported = await h.app.inject({ method: 'POST', url: '/api/v1/jobs', headers: { ...h.headers, 'content-type': 'application/xml', 'idempotency-key': randomUUID() }, payload: '<job/>' });
    expect(unsupported.statusCode).toBe(415); expect(unsupported.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});
