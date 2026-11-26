import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { GuestSessionView, GuestVisitView, MemoryView, SpeakerFocusView, SpeakerReference } from '@digitalguide/contracts';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { speakerBufferStats } from '../../apps/api/src/speaker-lifecycle.js';
import { selectSpeakerProvider, selectTargetSpeechProvider } from '@digitalguide/providers';
import { harness } from './helpers.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { vi.useRealTimers(); await h.close(); });
function post(url: string, payload: Record<string, unknown>, headers = h.headers, key = randomUUID()) { return h.app.inject({ method: 'POST', url: '/api/v1' + url, payload, headers: { ...headers, 'idempotency-key': key } }); }
function get(url: string, headers = h.headers) { return h.app.inject({ url: '/api/v1' + url, headers }); }
async function setup(early = false) {
  const profile = (await post('/profiles', { workspaceId: f.workspaceA, name: '专注对话演示角色', avatarAssetId: f.avatarA, scenes: ['reception'] })).json().data;
  const input = { workspaceId: f.workspaceA, profileId: profile.id, name: '专注对话', channelKey: 'speaker-' + randomUUID(), scene: 'reception', preset: 'office', welcomeText: '您好', speakerProvider: early ? 'mock-focus-early' : 'mock-focus-final', targetSpeechProvider: 'mock-target-speech', tools: ['knowledge.search', 'reception.handoff'] };
  const a = await post('/scene-apps', input); expect(a.statusCode, a.body).toBe(200); const venueId = h.repo.get<{ id: string }>('SELECT id FROM venues WHERE workspace_id=?', f.workspaceA)!.id;
  const t = (await post('/terminals', { venueId, name: '专注对话终端' })).json().data, s = (await post('/sessions', { terminalId: t.id, sceneAppId: a.json().data.id })).json().data;
  const access = await post('/sessions/' + s.id + '/access', {}), cookie = access.headers['set-cookie']!.toString().split(';')[0], base = '/guest/sessions/' + s.id;
  const v = (await get(base, { cookie, 'x-csrf-token': '' })).json().data as GuestSessionView;
  return { base, sessionId: s.id as string, appId: a.json().data.id as string, appInput: input, headers: { cookie, 'x-csrf-token': v.csrfToken } };
}
type C = Awaited<ReturnType<typeof setup>>;
async function view(c: C) { return (await get(c.base, c.headers)).json().data as GuestSessionView; }
async function state(c: C) { const r = await get(c.base + '/speaker-focus', c.headers); expect(r.statusCode, r.body).toBe(200); return r.json().data as SpeakerFocusView; }
async function control(c: C, path: string, extra: Record<string, unknown> = {}) { const s = (await view(c)).session; return post(c.base + '/speaker-focus' + path, { version: s.version, focusVersion: s.focusVersion, ...extra }, c.headers); }
async function start(c: C, extra: Record<string, unknown> = {}) { const r = await control(c, '', { mode: 'temporary', sameVisitorConfirmed: true, consent: true, noticeVersion: 'speaker-v1', ...extra }); expect(r.statusCode, r.body).toBe(200); return r.json().data as SpeakerFocusView; }
async function sample(c: C, fixture = 'clear') { const r = await control(c, '/reference', { fixture }); expect(r.statusCode, r.body).toBe(200); return r.json().data as SpeakerFocusView; }
async function lock(c: C) { await start(c); return sample(c); }
async function event(c: C, fixture: string, text = '合成目标问题', extra: Record<string, unknown> = {}, key = randomUUID()) { const s = (await view(c)).session; return post('/sessions/' + c.sessionId + '/speaker-events', { focusVersion: s.focusVersion, segmentId: randomUUID(), sequence: 0, fixture, text, source: 'mock_speaker_event', ...extra }, h.headers, key); }
async function enroll(headers = h.headers, extra: Record<string, unknown> = {}) { const r = await post('/speaker-references', { workspaceId: f.workspaceA, label: '本人合成参考', purpose: 'speaker_focus', consent: true, noticeVersion: 'speaker-v1', retentionDays: 7, provider: 'mock-focus-final', source: 'synthetic_fixture', fixture: 'clear', ...extra }, headers); expect(r.statusCode, r.body).toBe(200); return r.json().data as SpeakerReference; }
async function useCode(c: C, ref: SpeakerReference, headers = h.headers, key = randomUUID()) { const s = (await view(c)).session; const input = { referenceVersion: ref.version, sessionId: c.sessionId, focusVersion: s.focusVersion, confirmed: true }, r = await post('/speaker-references/' + ref.id + '/authorize-use', input, headers, key); expect(r.statusCode, r.body).toBe(200); return { input, key, data: r.json().data as { useCode: string } }; }
async function person(c: C) { const s = (await view(c)).session, r = await post(c.base + '/memory', { displayName: '当前本人', roles: ['visitor'], retentionDays: 30, consent: true, noticeVersion: 'memory-v1', focusVersion: s.focusVersion }, c.headers); expect(r.statusCode).toBe(200); return r.json().data as MemoryView; }
describe('T37 临时参考、目标归属与会话控制', () => {
  it('服务对象与用途明确确认后才创建临时参考，质量不足或多人样本不能显示锁定', async () => {
    const c = await setup(), s = (await view(c)).session; expect((await state(c)).state).toBe('idle');
    expect((await post(c.base + '/speaker-focus', { version: s.version, focusVersion: 0, mode: 'temporary', sameVisitorConfirmed: false, consent: true, noticeVersion: 'speaker-v1' }, c.headers)).statusCode).toBe(400);
    expect((await start(c)).state).toBe('acquiring'); expect((await sample(c, 'too_short')).state).toBe('uncertain'); expect((await sample(c, 'overlapping')).reference?.quality).toBe('overlap');
    const locked = await sample(c); expect(locked).toMatchObject({ state: 'locked', mode: 'temporary', simulated: true, focusVersion: 1 });
    expect(JSON.stringify(locked)).not.toMatch(/mock-reference:|mock-target:|provider_reference|target_token/); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM people')!.n).toBe(0);
  });
  it('partial 仅限长短期缓冲，不展示、不落原文、不调用模型；最终目标字幕才入会话', async () => {
    const c = await setup(); await lock(c); const id = randomUUID(), before = (await view(c)).session.messages.length;
    const partial = await event(c, 'target_partial', '待确认的私密partial', { segmentId: id, sequence: 0 }); expect(partial.json().data).toMatchObject({ accepted: false, buffered: true, reason: 'awaiting_final' });
    expect((await view(c)).session.messages).toHaveLength(before); expect(speakerBufferStats(h.repo, c.sessionId).characters).toBeGreaterThan(0);
    const persisted = JSON.stringify(h.repo.all('SELECT * FROM speaker_segment_decisions')) + JSON.stringify(h.repo.all('SELECT * FROM idempotency')) + JSON.stringify(h.repo.all('SELECT * FROM audit_events'));
    expect(persisted).not.toContain('待确认的私密partial');
    const final = await event(c, 'target_final', '最终本人字幕', { segmentId: id, sequence: 1 }); expect(final.json().data.accepted).toBe(true); const messages = (await view(c)).session.messages;
    expect(messages.find(m => m.role === 'visitor')).toMatchObject({ text: '最终本人字幕', inputSource: 'verified_mock_audio' }); expect(JSON.stringify(messages)).not.toContain('私密partial'); expect(speakerBufferStats(h.repo, c.sessionId).segments).toBe(0);
  });
  it('旁人更响、旁人 partial/final、回声及噪声不进入模型或记忆，也不抢走目标', async () => {
    const c = await setup(); await lock(c); const baseline = (await view(c)).session, id = randomUUID();
    for (const [fixture, sequence] of [['other_partial', 0], ['other_final', 1]] as const) expect((await event(c, fixture, '旁人私密句不得保存', { segmentId: id, sequence })).json().data.accepted).toBe(false);
    for (const fixture of ['other_louder', 'echo_final', 'noise_final', 'other_speech_started']) expect((await event(c, fixture, '另一段旁人原文')).json().data.accepted).toBe(false);
    const after = (await view(c)).session; expect(after.messages).toEqual(baseline.messages); expect(after.replyEpoch).toBe(baseline.replyEpoch); expect((await state(c)).state).toBe('locked');
    expect(JSON.stringify(h.repo.all('SELECT * FROM reception_messages')) + JSON.stringify(h.repo.all('SELECT * FROM idempotency'))).not.toContain('旁人私密句'); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM memory_facts')!.n).toBe(0);
  });
  it('只有确认归属的最终混合样例可通过，无法分离的重叠转为不确定并保留手动回退', async () => {
    const c = await setup(); await lock(c); expect((await event(c, 'target_crowd_final', '混合样例中的目标问题')).json().data.accepted).toBe(true);
    const before = (await view(c)).session.messages.length, overlap = await event(c, 'overlap_final', '两人重叠不能拼接'); expect(overlap.json().data).toMatchObject({ accepted: false, reason: 'overlap_not_separable' }); expect((await state(c)).state).toBe('uncertain');
    expect((await event(c, 'target_final', '失锁后不能自动接纳')).json().data.accepted).toBe(false); expect((await view(c)).session.messages).toHaveLength(before);
    expect((await control(c, '/fallback', { mode: 'near_field', confirmed: true })).json().data.reason).toBe('move_closer_then_reacquire');
  });
  it('早期归属可靠的目标可以打断，旁人和仅最终归属服务的早期事件不能打断', async () => {
    for (const early of [false, true]) {
      const c = await setup(early); await lock(c); await event(c, 'target_final', '先生成一条回复'); const v = await view(c), reply = v.session.messages.at(-1)!;
      await post(c.base + '/events', { type: 'reply.started', replyId: reply.id, replyEpoch: reply.replyEpoch, focusVersion: v.session.focusVersion }, c.headers);
      const before = (await view(c)).session; await event(c, 'other_speech_started', ''); expect((await view(c)).session.replyEpoch).toBe(before.replyEpoch);
      const result = await event(c, 'target_speech_started', ''); expect(result.json().data.interrupted).toBe(early);
      const current = (await view(c)).session; expect(current.messages.find(m => m.id === reply.id)!.status).toBe(early ? 'cancelled' : 'playing');
      if (early) expect((await post(c.base + '/events', { type: 'reply.completed', replyId: reply.id, replyEpoch: reply.replyEpoch, focusVersion: v.session.focusVersion }, c.headers)).statusCode).toBe(409);
    }
  });
  it('缓冲超时、限长与释放会清理字幕，原文从不进入普通数据库', async () => {
    const c = await setup(); await lock(c); const s = (await view(c)).session, { SpeakerService } = await import('../../apps/api/src/speaker-service.js'), service = new SpeakerService(h.repo, 'mock', 'development', h.config.sessionSecret), session = h.repo.get<import('../../apps/api/src/reception-service.js').SessionRow>('SELECT * FROM reception_sessions WHERE id=?', c.sessionId)!;
    vi.useFakeTimers(); for (let n = 0; n < 4; n++) service.event(session, { fixture: 'target_partial', segmentId: randomUUID(), sequence: 0, text: '暂存原文', source: 'mock_speaker_event', focusVersion: s.focusVersion }, randomUUID());
    expect(speakerBufferStats(h.repo, c.sessionId).segments).toBe(4); expect(service.event(session, { fixture: 'target_partial', segmentId: randomUUID(), sequence: 0, text: '第五段', source: 'mock_speaker_event', focusVersion: s.focusVersion }, randomUUID()).reason).toBe('partial_buffer_limit');
    await vi.advanceTimersByTimeAsync(5001); expect(speakerBufferStats(h.repo, c.sessionId)).toEqual({ segments: 0, characters: 0 }); vi.useRealTimers();
    await event(c, 'target_partial', '释放时清理'); await control(c, '/release', { confirmed: true }); expect(speakerBufferStats(h.repo, c.sessionId).segments).toBe(0);
  });
  it('重锁递增 focusVersion 并保留本人已授权资料及来源，旧事件、旧登记和旧确认失效', async () => {
    const c = await setup(), owner = await person(c), old = (await view(c)).session;
    await post(c.base + '/messages', { text: '重锁前本人原文', source: 'typed', version: old.version, focusVersion: old.focusVersion }, c.headers); await lock(c); const generation = (await view(c)).session.focusVersion;
    const id = randomUUID(); await event(c, 'target_partial', '待清理缓存', { segmentId: id }); const reacquired = await control(c, '/reacquire', { sameVisitorConfirmed: true }); expect(reacquired.json().data.focusVersion).toBe(generation + 1); expect(speakerBufferStats(h.repo, c.sessionId).segments).toBe(0);
    expect((await event(c, 'target_final', '旧目标结果', { focusVersion: generation, segmentId: id, sequence: 1 })).json().data.reason).toBe('stale_focus');
    expect((await post(c.base + '/memory/settings', { version: owner.person!.version, focusVersion: 0 }, c.headers)).statusCode).toBe(409);
    const memory = (await get(c.base + '/memory', c.headers)).json().data as MemoryView; expect(memory.person!.id).toBe(owner.person!.id); expect((await get(c.base + '/memory/export', c.headers)).body).toContain('重锁前本人原文');
    await sample(c); expect((await event(c, 'target_final', '新参考本人原文')).json().data.accepted).toBe(true);
  });
  it('移动或失锁不会选择另一个更响的人，只有本人重新确认参考后才能接续', async () => {
    const c = await setup(); await lock(c); await event(c, 'tracking_lost', ''); expect((await state(c)).state).toBe('uncertain');
    expect((await event(c, 'other_louder', '旁人更响')).json().data.accepted).toBe(false); expect((await state(c)).state).toBe('uncertain');
    await control(c, '/reacquire', { sameVisitorConfirmed: true }); expect((await sample(c)).state).toBe('locked');
  });
  it('按键回退是十秒一次的明确授权，仍不接收旁人或未授权事件', async () => {
    const c = await setup(); await start(c); await sample(c, 'too_short'); await control(c, '/fallback', { mode: 'ptt', confirmed: true });
    expect((await event(c, 'ptt_target_final', '未按键')).json().data.accepted).toBe(false); await control(c, '/ptt', { confirmed: true });
    expect((await event(c, 'other_final', '旁人不能消费许可')).json().data.accepted).toBe(false); expect((await state(c)).pttReady).toBe(true);
    expect((await event(c, 'ptt_target_final', '已按键确认的一句')).json().data.accepted).toBe(true); expect((await event(c, 'ptt_target_final', '不能复用许可')).json().data.accepted).toBe(false);
    await control(c, '/ptt', { confirmed: true }); h.repo.run("UPDATE speaker_ptt_permits SET expires_at='2000-01-01T00:00:00.000Z' WHERE session_id=?", c.sessionId); expect((await event(c, 'ptt_target_final', '过期')).json().data.accepted).toBe(false);
    expect((await control(c, '/fallback', { mode: 'text', confirmed: true })).json().data.state).toBe('ended');
  });
  it('新服务对象使用新匿名会话和新 cookie，旧偏好、来访、字幕及确认不会带给下一位', async () => {
    const c = await setup(); await person(c); await lock(c); await event(c, 'target_final', '上一位的私密原文'); const old = await view(c);
    const handoff = await control(c, '/handoff', { confirmed: true, nextVisitorConfirmed: true }); expect(handoff.statusCode, handoff.body).toBe(200); const nextId = handoff.json().data.sessionId;
    expect(nextId).not.toBe(c.sessionId); expect((await get(c.base, c.headers)).statusCode).toBe(401); expect(handoff.body).not.toContain('私密原文');
    const raw = handoff.headers['set-cookie'] as string[]; const newCookie = raw.find(v => v.includes('/guest/sessions/' + nextId))!.split(';')[0], nextBase = '/guest/sessions/' + nextId, next = (await get(nextBase, { cookie: newCookie, 'x-csrf-token': '' })).json().data as GuestSessionView;
    expect(next.session.messages).not.toEqual(old.session.messages); expect(JSON.stringify(next)).not.toContain('私密原文'); expect(next.session.identity).toBe('anonymous');
    const headers = { cookie: newCookie, 'x-csrf-token': next.csrfToken }; expect((await get(nextBase + '/memory', headers)).json().data.person).toBeNull(); expect((await get(nextBase + '/visit', headers)).json().data.visit).toBeNull();
    expect((await get(nextBase + '/speaker-focus', headers)).json().data.state).toBe('handoff_pending'); expect((await post(nextBase + '/speaker-focus/ptt', { version: next.session.version, focusVersion: 0, confirmed: true }, headers)).statusCode).toBe(409);
    expect((await get('/me', headers)).statusCode).toBe(401);
  });
  it('同片段重复或乱序 final 不重复进入模型，多桌和跨组织不能调用或串入', async () => {
    const a = await setup(), b = await setup(); await lock(a); await lock(b); const segmentId = randomUUID(), first = await event(a, 'target_final', '唯一的目标问题', { segmentId }); expect(first.json().data.accepted).toBe(true);
    expect((await event(a, 'target_final', '重复', { segmentId, sequence: 1 })).json().data.reason).toBe('duplicate_or_out_of_order'); expect((await view(a)).session.messages.filter(m => m.role === 'visitor')).toHaveLength(1); expect((await view(b)).session.messages.filter(m => m.role === 'visitor')).toHaveLength(0);
    const other = await h.login(f.adminB), v = (await view(a)).session, body = { focusVersion: v.focusVersion, segmentId: randomUUID(), sequence: 0, fixture: 'target_final', text: '越权', source: 'mock_speaker_event' };
    expect((await post('/sessions/' + a.sessionId + '/speaker-events', body, other)).statusCode).toBe(404); expect((await post('/sessions/' + a.sessionId + '/speaker-events', body, a.headers)).statusCode).toBe(401);
    expect((await post(a.base + '/events', { type: 'audio.segment', text: '自称目标不得接纳', segmentId: randomUUID(), attribution: 'target', final: true, source: 'mock_audio', focusVersion: v.focusVersion }, a.headers)).json().data.accepted).toBe(false);
  });
  it('只有最终已确认的模拟目标字幕能成为待确认记忆来源，并标记模拟来源', async () => {
    const c = await setup(); await person(c); await lock(c); const eventId = randomUUID(); await event(c, 'other_final', '旁人偏好', { segmentId: eventId }); await event(c, 'target_final', '本人喜欢温水');
    const v = await view(c), message = v.session.messages.find(m => m.role === 'visitor')!, memory = (await get(c.base + '/memory', c.headers)).json().data as MemoryView;
    const fact = await post(c.base + '/memory/facts', { key: 'like', value: '温水', visibility: 'reception', sourceMessageId: message.id, expiresAt: memory.person!.expiresAt, focusVersion: v.session.focusVersion }, c.headers); expect(fact.statusCode, fact.body).toBe(200); expect(fact.json().data.facts[0]).toMatchObject({ sourceKind: 'verified_mock_audio', status: 'pending' });
    expect((await post(c.base + '/memory/facts', { key: 'like', value: '旁人偏好', visibility: 'reception', sourceMessageId: eventId, expiresAt: memory.person!.expiresAt, focusVersion: v.session.focusVersion }, c.headers)).statusCode).toBe(409);
  });
  it('本人删除资料会清理跨重锁来源和有工具外键的会话原文，保留最小回执', async () => {
    const c = await setup(); await person(c); await lock(c); await event(c, 'target_final', '请转人工接待'); await control(c, '/reacquire', { sameVisitorConfirmed: true }); await sample(c); await event(c, 'target_final', '重锁后的原文');
    const v = (await get(c.base + '/memory', c.headers)).json().data as MemoryView, s = (await view(c)).session;
    const erased = await post(c.base + '/memory/erase', { version: v.person!.version, focusVersion: s.focusVersion, confirmed: true }, c.headers); expect(erased.statusCode, erased.body).toBe(200);
    expect((await view(c)).session.messages).toHaveLength(0); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM memory_session_links WHERE person_id=?', v.person!.id)!.n).toBe(0);
  });
  it('临时参考在释放、空闲超时或策略撤回后清理，未接通的真实服务不会回退', async () => {
    const c = await setup(); await lock(c); const reference = h.repo.get<{ id: string }>('SELECT reference_id id FROM speaker_focus_sessions WHERE session_id=?', c.sessionId)!;
    await control(c, '/release', { confirmed: true }); expect(h.repo.get('SELECT provider_reference,target_token,status,delete_status FROM speaker_references WHERE id=?', reference.id)).toMatchObject({ provider_reference: null, target_token: null, status: 'deleted', delete_status: 'completed_mock' });
    await lock(c); h.repo.run("UPDATE reception_sessions SET activity_at='2000-01-01T00:00:00.000Z' WHERE id=?", c.sessionId); expect((await get(c.base, c.headers)).statusCode).toBe(401); expect(h.repo.get<{ n: number }>("SELECT count(*) n FROM speaker_references WHERE session_id=? AND status IN ('active','pending')", c.sessionId)!.n).toBe(0);
    for (const mode of ['live', 'sandbox']) { expect(() => selectSpeakerProvider('mock-focus-final', mode, 'development')).toThrow(); expect(() => selectTargetSpeechProvider('mock-target-speech', mode, 'development')).toThrow(); }
    expect(() => selectSpeakerProvider('external-focus', 'mock', 'development')).toThrow('尚未接通'); expect(() => selectSpeakerProvider('mock-focus-final', 'mock', 'production')).toThrow();
  });
});
describe('T37 登记参考独立授权与身份隔离', () => {
  it('登记参考重锁采用同一代数限频，不能用已登记模式无限刷新参考', async () => {
    const c = await setup(), r = await enroll(), ticket = await useCode(c, r); await start(c, { mode: 'enrolled', useCode: ticket.data.useCode }); await sample(c);
    for (let n = 0; n < 11; n++) { expect((await control(c, '/reacquire', { sameVisitorConfirmed: true })).statusCode).toBe(200); await sample(c); }
    expect((await control(c, '/reacquire', { sameVisitorConfirmed: true })).statusCode).toBe(429);
    expect(h.repo.get<{ n: number }>("SELECT count(*) n FROM speaker_references WHERE scope='temporary'")!.n).toBe(0);
  });
  it('独立到期清除模板、使用码及缓冲，场景声音策略收紧会撤销旧匹配', async () => {
    const c = await setup(); await lock(c); await event(c, 'target_partial', '必须清除');
    h.repo.run("UPDATE speaker_references SET expires_at='2000-01-01T00:00:00.000Z' WHERE session_id=?", c.sessionId);
    expect((await state(c)).state).toBe('ended'); expect(h.repo.get<{ status: string }>('SELECT status FROM speaker_references WHERE session_id=?', c.sessionId)!.status).toBe('expired'); expect(speakerBufferStats(h.repo, c.sessionId).segments).toBe(0);
    await lock(c); const s = (await view(c)).session;
    expect((await post('/scene-apps/' + c.appId + '/update', { ...c.appInput, workspaceId: undefined, version: 1, speakerProvider: 'disabled', targetSpeechProvider: 'disabled' })).statusCode).toBe(200);
    expect((await state(c)).enabled).toBe(false); expect((await state(c)).state).toBe('ended');
    expect((await event(c, 'target_final', '旧服务内容', { focusVersion: s.focusVersion })).json().data.accepted).toBe(false);
  });
  it('管理员参考确认仍校验权限和当前目标版本，按键模式不能被普通目标事件绕过', async () => {
    const c = await setup(); await start(c); const s = (await view(c)).session, payload = { version: s.version, focusVersion: s.focusVersion, fixture: 'clear' }, key = randomUUID(), path = '/sessions/' + c.sessionId + '/speaker-focus/reference';
    const editor = await h.login(f.editorA); expect((await post(path, payload, editor)).statusCode).toBe(403);
    expect((await post(path, payload, h.headers, key)).statusCode).toBe(200); await control(c, '/reacquire', { sameVisitorConfirmed: true });
    expect(h.repo.get("SELECT actor_id FROM audit_events WHERE action='speaker.reference_sample_confirmed_mock' AND resource_id=?", c.sessionId)).toMatchObject({ actor_id: f.adminA });
    expect((await post(path, payload, h.headers, key)).statusCode).toBe(409); await sample(c);
    await control(c, '/fallback', { mode: 'ptt', confirmed: true }); await control(c, '/ptt', { confirmed: true });
    expect((await event(c, 'target_final', '未按键的常规事件')).json().data).toMatchObject({ accepted: false, reason: 'ptt_confirmation_required' }); expect((await state(c)).pttReady).toBe(true);
    expect((await event(c, 'ptt_target_final', '按键本人句')).json().data.accepted).toBe(true); expect((await state(c)).pttReady).toBe(false);
  });
  it('本人重锁保留来访资料，但未提交通知须重新确认且旧确认令牌无效', async () => {
    const c = await setup(), url = c.base + '/visit';
    const draft = await post(url, { guestName: '本人', company: '合成单位', hostName: '陈墨', purpose: '演示', appointmentRef: '', version: null, focusVersion: 0 }, c.headers); expect(draft.statusCode, draft.body).toBe(200);
    const v = draft.json().data as GuestVisitView, input = { version: v.visit!.version, focusVersion: 0, confirmationToken: v.confirmation!.token, expiresAt: v.confirmation!.expiresAt, noticeVersion: 'visit-v1', confirmed: true };
    expect((await post(url + '/confirm', input, c.headers)).statusCode).toBe(200); await lock(c);
    const fresh = (await get(url, c.headers)).json().data as GuestVisitView; expect(fresh.visit).toMatchObject({ guestName: '本人', status: 'awaiting_confirmation', focusVersion: 1 });
    expect((await post(url + '/confirm', input, c.headers)).statusCode).toBe(409);
    const next = { ...input, version: fresh.visit!.version, focusVersion: 1, confirmationToken: fresh.confirmation!.token, expiresAt: fresh.confirmation!.expiresAt };
    expect((await post(url + '/confirm', next, c.headers)).statusCode).toBe(200); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM visit_deliveries')!.n).toBe(0);
  });
  it('登记只属于实际账号本人，不使用克隆素材或给管理员默认读取他人参考', async () => {
    const editor = await h.login(f.editorA), reference = await enroll(editor), viewer = await h.login(f.viewerA);
    expect((await get('/speaker-references?workspaceId=' + f.workspaceA)).json().data).toEqual([]); expect((await get('/speaker-references?workspaceId=' + f.workspaceA, editor)).json().data[0].id).toBe(reference.id);
    expect((await post('/speaker-references/' + reference.id + '/delete', { version: reference.version, confirmed: true })).statusCode).toBe(404);
    expect((await post('/speaker-references', { workspaceId: f.workspaceA, label: '未知', purpose: 'train_voice', assetId: f.voiceA, consent: true }, viewer)).statusCode).toBe(400);
    const c = await setup(); expect((await post('/speaker-references', {}, c.headers)).statusCode).toBe(401);
  });
  it('一次性使用码绑定本人参考与指定会话，只存哈希，不把参考主人当作访客身份', async () => {
    const c = await setup(), r = await enroll(), issued = await useCode(c, r);
    expect(JSON.stringify(h.repo.all('SELECT * FROM speaker_use_tickets')) + JSON.stringify(h.repo.all('SELECT * FROM idempotency')) + JSON.stringify(h.repo.all('SELECT * FROM audit_events'))).not.toContain(issued.data.useCode);
    expect((await start(c, { mode: 'enrolled', useCode: issued.data.useCode })).mode).toBe('enrolled'); expect((await sample(c, 'registered_mismatch')).state).toBe('uncertain'); expect((await sample(c, 'replay_match')).state).toBe('locked');
    expect((await event(c, 'replay_match_final', '读取员工私人资料')).json().data.accepted).toBe(true); expect((await get('/me', c.headers)).statusCode).toBe(401); expect((await get('/office/inbox?workspaceId=' + f.workspaceA, c.headers)).statusCode).toBe(401); expect((await get(c.base + '/memory', c.headers)).json().data.person).toBeNull();
    const replay = await post('/speaker-references/' + r.id + '/authorize-use', issued.input, h.headers, issued.key); expect(replay.statusCode).toBe(409); expect(replay.body).not.toContain(issued.data.useCode);
  });
  it('他人会话、过期和已用使用码不能复用，失败尝试不能通过回滚清零', async () => {
    const c = await setup(), other = await setup(), r = await enroll(), issued = await useCode(c, r), v = (await view(other)).session;
    const input = { mode: 'enrolled', useCode: issued.data.useCode, consent: true, sameVisitorConfirmed: true, noticeVersion: 'speaker-v1', version: v.version, focusVersion: 0 };
    for (let n = 0; n < 10; n++) expect((await post(other.base + '/speaker-focus', input, other.headers)).statusCode).toBe(409);
    expect((await post(other.base + '/speaker-focus', input, other.headers)).statusCode).toBe(429);
    h.repo.run("UPDATE speaker_use_tickets SET expires_at='2000-01-01T00:00:00.000Z' WHERE session_id=?", c.sessionId);
    const own = (await view(c)).session; expect((await post(c.base + '/speaker-focus', { ...input, version: own.version }, c.headers)).statusCode).toBe(409);
  });
  it('本人删除或到期会撤销活跃匹配、使用码和模板引用，声纹不提供后台权限', async () => {
    const c = await setup(), r = await enroll(), ticket = await useCode(c, r); await start(c, { mode: 'enrolled', useCode: ticket.data.useCode }); await sample(c);
    const removed = await post('/speaker-references/' + r.id + '/delete', { version: r.version, confirmed: true }); expect(removed.statusCode, removed.body).toBe(200); expect(removed.json().data).toMatchObject({ status: 'deleted', deleteStatus: 'completed_mock' }); expect((await state(c)).state).toBe('ended');
    expect(h.repo.get('SELECT provider_reference,target_token FROM speaker_references WHERE id=?', r.id)).toMatchObject({ provider_reference: null, target_token: null }); expect((await get('/me', c.headers)).statusCode).toBe(401);
  });
});
