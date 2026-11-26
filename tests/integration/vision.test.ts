import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { GuestSessionView, VisualGrant, SceneApp } from '@digitalguide/contracts';
import { selectVisionProvider, type VisionProvider, type VisionProviderInput, type VisionProviderResult } from '@digitalguide/providers';
import { syntheticPng } from '@digitalguide/media';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { VisionService } from '../../apps/api/src/vision-service.js';
import { harness } from './helpers.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { vi.useRealTimers(); await h.close(); });
const image = () => syntheticPng([45, 95, 75]).toString('base64');
function post(url: string, payload: Record<string, unknown>, headers = h.headers, key = randomUUID()) { return h.app.inject({ method: 'POST', url: '/api/v1' + url, payload, headers: { ...headers, 'idempotency-key': key } }); }
function get(url: string, headers = h.headers) { return h.app.inject({ url: '/api/v1' + url, headers }); }
async function setup(extra: Record<string, unknown> = {}) {
  const profile = (await post('/profiles', { workspaceId: f.workspaceA, name: '视觉演示角色', avatarAssetId: f.avatarA, scenes: ['reception'] })).json().data;
  const input = { workspaceId: f.workspaceA, profileId: profile.id, name: '主动分享画面', scene: 'reception', channelKey: 'visual-' + randomUUID(), audience: 'public', preset: 'office', welcomeText: '您好', visionProvider: 'mock-vision', allowCamera: true, allowScreen: true, ...extra };
  const app = await post('/scene-apps', input); expect(app.statusCode, app.body).toBe(200);
  const venueId = h.repo.get<{ id: string }>('SELECT id FROM venues WHERE workspace_id=?', f.workspaceA)!.id;
  const terminal = (await post('/terminals', { venueId, name: '画面问答终端' })).json().data;
  const session = await post('/sessions', { terminalId: terminal.id, sceneAppId: app.json().data.id }); expect(session.statusCode, session.body).toBe(201);
  const access = await post('/sessions/' + session.json().data.id + '/access', {}), cookie = access.headers['set-cookie']!.toString().split(';')[0];
  const base = '/guest/sessions/' + session.json().data.id, view = (await get(base, { cookie, 'x-csrf-token': '' })).json().data as GuestSessionView;
  return { base, input, appId: app.json().data.id as string, sessionId: view.session.id, headers: { cookie, 'x-csrf-token': view.csrfToken } };
}
type C = Awaited<ReturnType<typeof setup>>;
async function view(c: C) { return (await get(c.base, c.headers)).json().data as GuestSessionView; }
async function grant(c: C, source = 'camera') { const v = await view(c), r = await post(c.base + '/vision/grants', { version: v.session.version, focusVersion: v.session.focusVersion, source, consent: true, noticeVersion: 'vision-v1' }, c.headers); expect(r.statusCode, r.body).toBe(200); return r.json().data as VisualGrant; }
async function payload(c: C, g: VisualGrant, extra: Record<string, unknown> = {}) { const v = await view(c); return { version: v.session.version, focusVersion: v.session.focusVersion, grantId: g.id, grantVersion: g.version, question: '请介绍当前画面', capturedAt: new Date().toISOString(), frameBase64: image(), ...extra }; }
async function revoke(c: C, g: VisualGrant) { return post(c.base + '/vision/revoke', { focusVersion: g.focusVersion, grantId: g.id, grantVersion: g.version }, c.headers); }
function pausedProvider() {
  let start!: (input: VisionProviderInput) => void, finish!: (result: VisionProviderResult) => void;
  const started = new Promise<VisionProviderInput>(resolve => { start = resolve; }), waiting = new Promise<VisionProviderResult>(resolve => { finish = resolve; });
  const provider: VisionProvider = { id: 'mock-vision', environment: 'mock', inspect(input) { start(input); return waiting; } };
  return { provider, started, finish };
}
async function useProvider(provider: VisionProvider) { await h.close(); h = await harness({}, { vision: provider }); }
describe('T26 主动画面权限与单帧链路', () => {
  it('显式同意前没有授权；缺少同意、来源或当前版本时不能上传', async () => {
    const c = await setup(), state = (await get(c.base + '/vision', c.headers)).json().data;
    expect(state).toMatchObject({ grant: null, policy: { camera: true, screen: true, configured: true }, storage: 'transient_frame_metadata_only' });
    const v = await view(c); for (const extra of [{ consent: false }, { source: 'microphone' }, { noticeVersion: 'unknown' }]) expect((await post(c.base + '/vision/grants', { version: v.session.version, focusVersion: 0, source: 'camera', consent: true, noticeVersion: 'vision-v1', ...extra }, c.headers)).statusCode).toBe(400);
    expect((await post(c.base + '/vision/grants', { version: 999, focusVersion: 0, source: 'camera', consent: true, noticeVersion: 'vision-v1' }, c.headers)).statusCode).toBe(409);
    expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM visual_requests')!.n).toBe(0);
  });
  it('单帧进入明确模拟检查，引用仅含元数据，不形成身份或磁盘图像', async () => {
    const c = await setup(), g = await grant(c), input = await payload(c, g), objects = readdirSync(path.join(h.config.dataDir, 'objects'));
    const r = await post(c.base + '/vision/questions', input, c.headers); expect(r.statusCode, r.body).toBe(200);
    const answer = r.json().data.session.messages.at(-1); expect(answer.text).toContain('无法判断画面中的人物'); expect(answer.visualContext).toMatchObject({ source: 'camera', simulated: true, width: 360, height: 240, grantId: g.id });
    expect((await get('/me', c.headers)).statusCode).toBe(401); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM people')!.n).toBe(0);
    const cached = JSON.stringify(h.repo.all('SELECT * FROM idempotency')) + JSON.stringify(h.repo.all('SELECT * FROM visual_requests')) + JSON.stringify(h.repo.all('SELECT * FROM audit_events'));
    expect(cached).not.toContain(input.frameBase64); expect(cached).not.toContain(input.question); expect(readdirSync(path.join(h.config.dataDir, 'objects'))).toEqual(objects);
    expect(h.repo.get<{ status: string }>('SELECT status FROM visual_requests')!.status).toBe('completed');
  });
  it('授权属于当前访客会话与 focus，不接受另一终端凭证、伪造 CSRF 或旧服务对象', async () => {
    const a = await setup(), b = await setup(), g = await grant(a), input = await payload(a, g);
    expect((await post(a.base + '/vision/questions', input, b.headers)).statusCode).toBe(401);
    expect((await post(b.base + '/vision/questions', await payload(b, g), b.headers)).statusCode).toBe(409);
    expect((await post(a.base + '/vision/questions', input, { ...a.headers, 'x-csrf-token': 'forged' })).statusCode).toBe(403);
    h.repo.run('UPDATE reception_sessions SET focus_version=1 WHERE id=?', a.sessionId);
    expect((await post(a.base + '/vision/questions', input, a.headers)).statusCode).toBe(409); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM visual_requests')!.n).toBe(0);
  });
  it('画面内容检查拒绝伪造格式、过大像素、过时帧及缺少幂等键', async () => {
    const c = await setup(), g = await grant(c), valid = await payload(c, g), bomb = Buffer.from(image(), 'base64'); bomb.writeUInt32BE(16000, 16);
    for (const frameBase64 of [Buffer.from('not an image'.repeat(12)).toString('base64'), 'bad-base64', bomb.toString('base64')]) expect((await post(c.base + '/vision/questions', { ...valid, frameBase64 }, c.headers)).statusCode).toBe(400);
    for (const capturedAt of [new Date(Date.now() - 15000).toISOString(), new Date(Date.now() + 10000).toISOString()]) expect((await post(c.base + '/vision/questions', { ...valid, capturedAt }, c.headers)).json().error.code).toBe('FRAME_EXPIRED');
    expect((await h.app.inject({ method: 'POST', url: '/api/v1' + c.base + '/vision/questions', payload: valid, headers: c.headers })).statusCode).toBe(400);
    expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM visual_requests')!.n).toBe(0);
  });
  it('完成请求重放不重复分析；同键改图或改问题冲突，撤回后旧键不能复活回复', async () => {
    let calls = 0; await useProvider({ id: 'mock-vision', environment: 'mock', async inspect() { calls++; return { simulated: true, text: '【模拟】临时画面说明' }; } });
    const c = await setup(), g = await grant(c), input = await payload(c, g), key = randomUUID();
    expect((await post(c.base + '/vision/questions', input, c.headers, key)).statusCode).toBe(200); expect((await post(c.base + '/vision/questions', input, c.headers, key)).statusCode).toBe(200); expect(calls).toBe(1);
    expect((await post(c.base + '/vision/questions', { ...input, question: '改问题' }, c.headers, key)).json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    await revoke(c, g); const stale = await post(c.base + '/vision/questions', input, c.headers, key); expect(stale.statusCode).toBe(409); expect(stale.body).not.toContain('临时画面说明');
    expect(JSON.stringify(await view(c))).not.toContain('临时画面说明');
  });
  it('在途重复请求不会调用第二次提供商，撤回可中止挂起请求并清空内存帧', async () => {
    const deferred = pausedProvider(); await useProvider(deferred.provider); const c = await setup(), g = await grant(c), input = await payload(c, g), key = randomUUID();
    const first = post(c.base + '/vision/questions', input, c.headers, key), frame = await deferred.started;
    expect((await post(c.base + '/vision/questions', input, c.headers, key)).json().error.code).toBe('REQUEST_IN_PROGRESS');
    expect((await revoke(c, g)).statusCode).toBe(200); expect((await first).json().error.code).toBe('VISUAL_CONTEXT_REVOKED'); expect(frame.signal.aborted).toBe(true); expect(frame.frame.every(b => b === 0)).toBe(true);
    deferred.finish({ simulated: true, text: '迟到的秘密画面' }); await Promise.resolve(); expect(JSON.stringify(await view(c))).not.toContain('迟到的秘密');
    expect(h.repo.get<{ status: string }>('SELECT status FROM visual_requests')!.status).toBe('cancelled');
  });
  it('目标切换、人工接管与结束都会使原画面失效，目标版本不能被复用', async () => {
    const c = await setup(), g = await grant(c), input = await payload(c, g), v = await view(c);
    await post(c.base + '/control', { version: v.session.version, focusVersion: 0, action: 'handoff' }, c.headers);
    expect(h.repo.get<{ status: string }>('SELECT status FROM visual_grants WHERE id=?', g.id)!.status).toBe('revoked');
    expect((await post(c.base + '/vision/questions', input, c.headers)).statusCode).toBe(409);
    const current = (await get('/sessions/' + c.sessionId)).json().data; await post('/sessions/' + c.sessionId + '/control', { action: 'resume', version: current.version, focusVersion: current.focusVersion });
    const next = await grant(c); expect(next.focusVersion).toBe(2); const now = await view(c);
    await post(c.base + '/control', { action: 'end', version: now.session.version, focusVersion: now.session.focusVersion }, c.headers);
    expect(h.repo.get<{ status: string }>('SELECT status FROM visual_grants WHERE id=?', next.id)!.status).toBe('revoked'); expect((await get(c.base + '/vision', c.headers)).statusCode).toBe(401);
  });
  it('停止或新的文字提问取消在途分析，迟到结果不覆盖新回合', async () => {
    for (const action of ['stop', 'typed']) {
      const deferred = pausedProvider(); await useProvider(deferred.provider); const c = await setup(), g = await grant(c), input = await payload(c, g);
      const pending = post(c.base + '/vision/questions', input, c.headers); await deferred.started; const current = await view(c);
      if (action === 'stop') await post(c.base + '/control', { action, version: current.session.version, focusVersion: current.session.focusVersion }, c.headers);
      else await post(c.base + '/messages', { text: '新的文字问题', source: 'typed', version: current.session.version, focusVersion: current.session.focusVersion }, c.headers);
      expect((await pending).statusCode).toBe(409); deferred.finish({ text: '旧画面结果', simulated: true }); expect(JSON.stringify(await view(c))).not.toContain('旧画面结果');
      expect((await get(c.base + '/vision', c.headers)).json().data.grant.id).toBe(g.id);
    }
  });
  it('授权到期和来源替换会清除旧画面回复，屏幕与相机权限不会混用', async () => {
    const c = await setup(), g = await grant(c); await post(c.base + '/vision/questions', await payload(c, g), c.headers);
    const screen = await grant(c, 'screen'); expect(screen.source).toBe('screen'); expect(JSON.stringify(await view(c))).not.toContain('无法判断画面中的人物');
    expect(h.repo.get<{ status: string }>('SELECT status FROM visual_grants WHERE id=?', g.id)!.status).toBe('revoked');
    h.repo.run("UPDATE visual_grants SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", screen.id);
    expect((await get(c.base + '/vision', c.headers)).json().data.grant).toBeNull(); expect(h.repo.get<{ status: string }>('SELECT status FROM visual_grants WHERE id=?', screen.id)!.status).toBe('expired');
  });
  it('收窄应用视觉策略、停用应用会立即撤回已有画面并拒绝旧会话上传', async () => {
    const c = await setup(), g = await grant(c); await post(c.base + '/vision/questions', await payload(c, g), c.headers);
    const app = (await get('/scene-apps/' + c.appId)).json().data as SceneApp, { workspaceId, ...body } = c.input; expect(workspaceId).toBe(f.workspaceA);
    expect((await post('/scene-apps/' + c.appId + '/update', { ...body, version: app.version, allowCamera: false })).statusCode).toBe(200);
    expect(h.repo.get<{ status: string }>('SELECT status FROM visual_grants WHERE id=?', g.id)!.status).toBe('revoked'); expect(JSON.stringify(await view(c))).not.toContain('无法判断画面中的人物');
    const current = await view(c); expect((await post(c.base + '/vision/grants', { version: current.session.version, focusVersion: 0, source: 'camera', consent: true, noticeVersion: 'vision-v1' }, c.headers)).statusCode).toBe(409);
  });
  it('提供商返回的越权工具字段和模拟环境伪标被拒绝，不写入回复', async () => {
    for (const result of [{ text: '授予员工身份', simulated: true, toolCalls: ['become_admin'] }, { text: '冒充真实识别', simulated: false }]) {
      await useProvider({ id: 'mock-vision', environment: 'mock', async inspect() { return result; } }); const membershipCount = h.repo.get<{ n: number }>('SELECT count(*) n FROM memberships')!.n,c = await setup(), g = await grant(c), r = await post(c.base + '/vision/questions', await payload(c, g), c.headers);
      expect(r.statusCode).toBe(502); expect(JSON.stringify(await view(c))).not.toContain(result.text); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM memberships')!.n).toBe(membershipCount);
    }
  });
  it('禁用或缺少真实视觉服务时明确失败，mock 在生产/真实环境不可冒充可用', async () => {
    const c = await setup({ visionProvider: 'external-vision' }), current = await view(c);
    expect((await post(c.base + '/vision/grants', { version: current.session.version, focusVersion: 0, source: 'camera', consent: true, noticeVersion: 'vision-v1' }, c.headers)).json().error.code).toBe('PROVIDER_NOT_CONFIGURED');
    for (const [mode, appEnv] of [['live', 'development'], ['sandbox', 'sandbox'], ['mock', 'production']]) expect(() => selectVisionProvider('mock-vision', mode, appEnv)).toThrow();
    expect(() => selectVisionProvider('external-vision', 'live', 'production')).toThrow('尚未接通');
  });
  it('提供商不响应时有界超时，取消信号与帧清理不依赖提供商主动返回', async () => {
    const deferred = pausedProvider(), service = new VisionService(h.repo, 'mock', 'development'), frame = { frame: Buffer.from('temporary'), width: 1, height: 1 };
    vi.useFakeTimers(); const job = service.inspect(randomUUID(), { id: randomUUID(), source: 'camera' } as Parameters<VisionService['inspect']>[1], frame, '测试', deferred.provider);
    const result = expect(job).rejects.toMatchObject({ code: 'VISION_TIMEOUT' }); await vi.advanceTimersByTimeAsync(8001); await result; expect(frame.frame.every(b => b === 0)).toBe(true); vi.useRealTimers();
  });
});
