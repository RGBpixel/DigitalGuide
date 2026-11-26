import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Repository } from '@digitalguide/database';
import { receptionSessionSchema, type GuestSessionView, type ReceptionSession } from '@digitalguide/contracts';
import { ReceptionService } from '../../apps/api/src/reception-service.js';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { await h.close(); });
function post(path: string, payload: Record<string, unknown>, headers = h.headers, key = randomUUID()) { return h.app.inject({ method: 'POST', url: '/api/v1' + path, payload, headers: { ...headers, 'idempotency-key': key } }); }
async function terminal(workspace = f.workspaceA, headers = h.headers) {
  const venue = h.repo.get<{ id: string }>('SELECT id FROM venues WHERE workspace_id=?', workspace)!;
  const response = await post('/terminals', { venueId: venue.id, name: '虚构接待终端' }, headers); expect(response.statusCode).toBe(201);
  return response.json().data.id as string;
}
async function session(terminalId: string) {
  const response = await post('/sessions', { terminalId }); expect(response.statusCode).toBe(201); return response.json().data as ReceptionSession;
}
async function guest(sessionId: string) {
  const access = await post('/sessions/' + sessionId + '/access', {}); expect(access.statusCode).toBe(200);
  const cookie = access.headers['set-cookie']!.toString().split(';')[0];
  const response = await h.app.inject({ url: '/api/v1/guest/sessions/' + sessionId, headers: { cookie } }); expect(response.statusCode).toBe(200);
  const data = response.json().data as GuestSessionView;
  return { data, headers: { cookie, 'x-csrf-token': data.csrfToken } };
}
describe('T04 匿名接待、访客能力及音频边界', () => {
  it('创建、刷新与重开数据库保留匿名消息，但没有员工身份或工具权限', async () => {
    const terminalId = await terminal(), initial = await session(terminalId), access = await guest(initial.id);
    const result = await post('/guest/sessions/' + initial.id + '/messages', { text: '您好，我想咨询接待', version: initial.version, focusVersion: 0, source: 'typed' }, access.headers);
    expect(result.statusCode).toBe(200); expect(receptionSessionSchema.safeParse(result.json().data.session).success).toBe(true);
    const reopened = new Repository(h.config.dataDir);
    try {
      expect(reopened.get<{ n: number }>('SELECT count(*) AS n FROM reception_messages WHERE session_id=?', initial.id)!.n).toBe(3);
      expect(reopened.get<{ n: number }>("SELECT count(*) AS n FROM schema_migrations WHERE name IN ('001-foundation.sql','002-reception.sql')")!.n).toBe(2);
    } finally { reopened.close(); }
    const refreshed = await h.app.inject({ url: '/api/v1/guest/sessions/' + initial.id, headers: access.headers });
    expect(refreshed.json().data.session.identity).toBe('anonymous'); expect(refreshed.json().data.capabilities).not.toContain('asset.read');
    for (const path of ['/me', '/assets', '/jobs', '/terminals', '/audit-events']) expect((await h.app.inject({ url: '/api/v1' + path, headers: access.headers })).statusCode).toBe(401);
  });
  it('访客凭证仅限当前会话；伪造、缺少 CSRF 和非授权来源被拒绝', async () => {
    const first = await session(await terminal()), second = await session(await terminal()), access = await guest(first.id);
    expect((await h.app.inject({ url: '/api/v1/guest/sessions/' + second.id, headers: access.headers })).statusCode).toBe(401);
    expect((await h.app.inject({ url: '/api/v1/guest/sessions/' + first.id, headers: { cookie: 'dg_guest=forged' } })).statusCode).toBe(401);
    const payload = { text: '不应保存', version: first.version, focusVersion: 0, source: 'typed' };
    expect((await post('/guest/sessions/' + first.id + '/messages', payload, { ...access.headers, 'x-csrf-token': h.headers['x-csrf-token'] })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/guest/sessions/' + first.id + '/messages', headers: { ...access.headers, origin: 'https://foreign.invalid', 'idempotency-key': randomUUID() }, payload })).statusCode).toBe(403);
  });
  it('模拟接近只问候一次，其他目标排队；结束后的冷却跨重启保留', async () => {
    const t = await terminal(), url = '/terminals/' + t + '/presence';
    const payload = { type: 'entered', trackId: 'temporary-A', source: 'mock_presence' };
    const key = randomUUID(), first = await post(url, payload, h.headers, key);
    expect(first.json().data.greeted).toBe(true); const sessionId = first.json().data.sessionId;
    expect((await post(url, payload, h.headers, key)).json().data.sessionId).toBe(sessionId);
    expect((await post(url, payload)).json().data).toMatchObject({ disposition: 'active', greeted: false });
    expect((await post(url, { ...payload, trackId: 'temporary-B' })).json().data).toMatchObject({ disposition: 'queued', queuePosition: 1, greeted: false });
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM reception_sessions')!.n).toBe(1);
    const row = h.repo.get<{ version: number; focus_version: number }>('SELECT version,focus_version FROM reception_sessions WHERE id=?', sessionId)!;
    await post('/sessions/' + sessionId + '/control', { action: 'end', version: row.version, focusVersion: row.focus_version });
    const reopened = new Repository(h.config.dataDir); try { expect(reopened.get<{ n: number }>('SELECT count(*) AS n FROM reception_presence')!.n).toBe(2); } finally { reopened.close(); }
    expect((await post(url, payload)).json().data.disposition).toBe('cooldown');
    expect((await post(url, { ...payload, trackId: 'temporary-C' })).json().data.disposition).toBe('queued');
    const next = await post('/terminals/' + t + '/next', {}); expect(next.statusCode).toBe(200); expect(next.json().data.id).not.toBe(sessionId);
  });
  it('同一终端并发创建只保留一个会话；不同终端互不影响', async () => {
    const t = await terminal();
    const results = await Promise.all(Array.from({ length: 10 }, () => post('/sessions', { terminalId: t })));
    expect(new Set(results.map(r => r.json().data.id)).size).toBe(1);
    expect((await session(await terminal())).terminalId).not.toBe(t);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM reception_sessions')!.n).toBe(2);
  });
  it('重复文字请求不重复回话，旧版本和归属伪造被拒绝', async () => {
    const s = await session(await terminal()), access = await guest(s.id), key = randomUUID();
    const payload = { text: '仅保存一次', version: s.version, focusVersion: 0, source: 'typed' };
    const a = await post('/guest/sessions/' + s.id + '/messages', payload, access.headers, key);
    const b = await post('/guest/sessions/' + s.id + '/messages', payload, access.headers, key);
    expect(a.statusCode).toBe(200); expect(b.json().data.session.version).toBe(a.json().data.session.version);
    expect((await post('/guest/sessions/' + s.id + '/messages', payload, access.headers)).json().error.code).toBe('VERSION_CONFLICT');
    expect((await post('/guest/sessions/' + s.id + '/messages', { ...payload, source: 'mock_audio', verifiedEmployee: true }, access.headers)).statusCode).toBe(400);
    expect(h.repo.get<{ n: number }>("SELECT count(*) AS n FROM reception_messages WHERE session_id=? AND role='visitor'", s.id)!.n).toBe(1);
  });
  it('目标/旁人/不确定的 partial/final 字幕均不落库，也不打断旧回复', async () => {
    const s = await session(await terminal()), access = await guest(s.id), marker = 'rejected-audio-must-not-persist';
    for (const attribution of ['target', 'other', 'uncertain']) for (const final of [false, true]) {
      const result = await post('/guest/sessions/' + s.id + '/events', { type: 'audio.segment', segmentId: randomUUID(), text: marker, attribution, final, focusVersion: 0, source: 'mock_audio' }, access.headers);
      expect(result.json().data).toMatchObject({ accepted: false, reason: 'SPEAKER_FOCUS_NOT_CONFIGURED' });
    }
    expect(JSON.stringify(h.repo.all('SELECT * FROM reception_messages'))).not.toContain(marker);
    expect(JSON.stringify(h.repo.all('SELECT * FROM audit_events'))).not.toContain(marker);
    expect(JSON.stringify(h.repo.all('SELECT * FROM idempotency'))).not.toContain(marker);
    expect(h.repo.get<{ reply_epoch: number }>('SELECT reply_epoch FROM reception_sessions WHERE id=?', s.id)!.reply_epoch).toBe(0);
  });
  it('手动停止取消旧回复，迟到播放确认无效', async () => {
    const s = await session(await terminal()), access = await guest(s.id), reply = s.messages[0];
    const started = await post('/guest/sessions/' + s.id + '/events', { type: 'reply.started', replyId: reply.id, replyEpoch: 0, focusVersion: 0 }, access.headers); expect(started.statusCode).toBe(200);
    const current = started.json().data.session;
    const stopped = await post('/guest/sessions/' + s.id + '/control', { action: 'stop', version: current.version, focusVersion: 0 }, access.headers);
    expect(stopped.json().data.session.messages[0].status).toBe('cancelled');
    const late = await post('/guest/sessions/' + s.id + '/events', { type: 'reply.completed', replyId: reply.id, replyEpoch: 0, focusVersion: 0 }, access.headers);
    expect(late.statusCode).toBe(409);
  });
  it('人工接管取消自动回复；访客不能解除接管，旧 focusVersion 无法确认', async () => {
    const s = await session(await terminal()), access = await guest(s.id);
    const handoff = await post('/guest/sessions/' + s.id + '/control', { action: 'handoff', version: s.version, focusVersion: 0 }, access.headers);
    expect(handoff.json().data.session.status).toBe('human'); const current = handoff.json().data.session;
    expect((await post('/guest/sessions/' + s.id + '/control', { action: 'resume', version: current.version, focusVersion: current.focusVersion }, access.headers)).statusCode).toBe(403);
    const msg = await post('/guest/sessions/' + s.id + '/messages', { text: '请工作人员帮助', version: current.version, focusVersion: current.focusVersion, source: 'typed' }, access.headers);
    expect(msg.json().data.session.messages.at(-1).role).toBe('visitor');
    const row = msg.json().data.session;
    expect((await post('/sessions/' + s.id + '/control', { action: 'resume', version: row.version, focusVersion: row.focusVersion })).statusCode).toBe(200);
    expect((await post('/guest/sessions/' + s.id + '/messages', { text: '迟到确认', version: row.version, focusVersion: 0, source: 'typed' }, access.headers)).statusCode).toBe(409);
  });
  it('终止或空闲到期后凭证失效，队列过期项不再被接待', async () => {
    const t = await terminal(), s = await session(t), access = await guest(s.id);
    await post('/terminals/' + t + '/presence', { type: 'entered', trackId: 'queued', source: 'mock_presence' });
    h.repo.run("UPDATE reception_sessions SET activity_at='2000-01-01T00:00:00.000Z' WHERE id=?", s.id);
    h.repo.run("UPDATE reception_presence SET last_seen_at='2000-01-01T00:00:00.000Z' WHERE terminal_id=?", t);
    h.repo.transaction(() => new ReceptionService(h.repo, 'mock', 'development').expire());
    expect((await h.app.inject({ url: '/api/v1/guest/sessions/' + s.id, headers: access.headers })).statusCode).toBe(401);
    expect(h.repo.get<{ status: string }>('SELECT status FROM reception_sessions WHERE id=?', s.id)!.status).toBe('expired');
    expect((await post('/terminals/' + t + '/next', {})).statusCode).toBe(409);
    expect(h.repo.get<{ n: number }>("SELECT count(*) AS n FROM outbox_events WHERE type='session.expired'")!.n).toBe(1);
  });
  it('跨租户/工作空间不可枚举终端或会话；只读成员不能管理接待', async () => {
    const t = await terminal(), s = await session(t), b = await h.login(f.adminB);
    expect((await h.app.inject({ url: '/api/v1/sessions/' + s.id, headers: b })).statusCode).toBe(404);
    expect((await post('/sessions', { terminalId: t }, b)).statusCode).toBe(404);
    expect((await h.app.inject({ url: '/api/v1/terminals', headers: b })).json().data.items).toHaveLength(0);
    const readonly = await h.login(f.viewerA); expect((await post('/sessions', { terminalId: t }, readonly)).statusCode).toBe(403);
    expect((await h.app.inject({ url: '/api/v1/terminals', headers: readonly })).statusCode).toBe(403);
  });
  it('匿名接近离开事件绑定会话，旧事件不能关闭新会话', async () => {
    const t = await terminal(), input = { type: 'entered', trackId: 'A', source: 'mock_presence' };
    const first = await post('/terminals/' + t + '/presence', input); const sessionId = first.json().data.sessionId;
    expect((await post('/terminals/' + t + '/presence', { ...input, type: 'left', sessionId: randomUUID() })).statusCode).toBe(409);
    expect((await post('/terminals/' + t + '/presence', { ...input, type: 'left', sessionId })).statusCode).toBe(200);
    expect(h.repo.get<{ status: string }>('SELECT status FROM reception_sessions WHERE id=?', sessionId)!.status).toBe('ended');
    expect((await post('/terminals/' + t + '/presence', input)).json().data.disposition).toBe('cooldown');
  });
  it('访客结束后不能再读旧消息或复用旧凭证，工作人员仍可查状态', async () => {
    const s = await session(await terminal()), access = await guest(s.id);
    const result = await post('/guest/sessions/' + s.id + '/control', { action: 'end', version: s.version, focusVersion: s.focusVersion }, access.headers);
    expect(result.json().data.session.status).toBe('ended');
    expect((await h.app.inject({ url: '/api/v1/guest/sessions/' + s.id, headers: access.headers })).statusCode).toBe(401);
    expect((await h.app.inject({ url: '/api/v1/sessions/' + s.id, headers: h.headers })).json().data.status).toBe('ended');
    expect((await post('/sessions/' + s.id + '/access', {})).statusCode).toBe(410);
  });
  it('运行会话固定角色版本；缺少场景或到期素材不能启动新接待', async () => {
    const t = await terminal();
    const profile = await post('/profiles', { workspaceId: f.workspaceA, name: '虚构接待员', avatarAssetId: f.avatarA, scenes: ['video'] });
    const profileId = profile.json().data.id;
    expect((await post('/sessions', { terminalId: t, profileId })).json().error.code).toBe('CAPABILITY_UNAVAILABLE');
    await h.app.inject({ method: 'PUT', url: '/api/v1/profiles/' + profileId, headers: { ...h.headers, 'idempotency-key': randomUUID() }, payload: { version: 1, name: '初始角色', scenes: ['reception'] } });
    const started = await post('/sessions', { terminalId: t, profileId }); expect(started.statusCode).toBe(201);
    await h.app.inject({ method: 'PUT', url: '/api/v1/profiles/' + profileId, headers: { ...h.headers, 'idempotency-key': randomUUID() }, payload: { version: 2, name: '后续修改角色', scenes: ['video'] } });
    expect((await h.app.inject({ url: '/api/v1/sessions/' + started.json().data.id, headers: h.headers })).json().data.profileName).toBe('初始角色');
    const s = started.json().data; await post('/sessions/' + s.id + '/control', { action: 'end', version: s.version, focusVersion: s.focusVersion });
    await h.app.inject({ method: 'PUT', url: '/api/v1/profiles/' + profileId, headers: { ...h.headers, 'idempotency-key': randomUUID() }, payload: { version: 3, name: '到期角色', scenes: ['reception'] } });
    h.repo.run("UPDATE assets SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", f.avatarA);
    expect((await post('/sessions', { terminalId: t, profileId })).json().error.code).toBe('ASSET_EXPIRED');
  });
  it('没有真实实时适配器时明确拒绝，模拟事件不进入 live 环境', async () => {
    const live = await harness({ providerMode: 'live' });
    try {
      const venueId = live.repo.get<{ id: string }>('SELECT id FROM venues WHERE workspace_id=?', f.workspaceA)!.id;
      const create = await live.app.inject({ method: 'POST', url: '/api/v1/terminals', headers: { ...live.headers, 'idempotency-key': randomUUID() }, payload: { venueId, name: '真实模式未配置' } });
      const terminalId = create.json().data.id;
      const start = await live.app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { ...live.headers, 'idempotency-key': randomUUID() }, payload: { terminalId } });
      expect(start.json().error.code).toBe('PROVIDER_NOT_CONFIGURED');
      const event = await live.app.inject({ method: 'POST', url: '/api/v1/terminals/' + terminalId + '/presence', headers: { ...live.headers, 'idempotency-key': randomUUID() }, payload: { type: 'entered', trackId: 'mock', source: 'mock_presence' } });
      expect(event.json().error.code).toBe('CAPABILITY_UNAVAILABLE');
    } finally { await live.close(); }
  });
});
