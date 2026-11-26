import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MemoryView, GuestSessionView } from '@digitalguide/contracts';
import { memoryViewSchema } from '@digitalguide/contracts';
import { Repository } from '@digitalguide/database';
import { MemoryService, type PersonRow } from '../../apps/api/src/memory-service.js';
import { processMemoryGreetings } from '../../apps/worker/src/memory-greetings.js';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { await h.close(); });
function post(path: string, payload: Record<string, unknown>, headers = h.headers, key = randomUUID()) { return h.app.inject({ method: 'POST', url: '/api/v1' + path, payload, headers: { ...headers, 'idempotency-key': key } }); }
function get(path: string, headers = h.headers) { return h.app.inject({ url: '/api/v1' + path, headers }); }
const enrollment = { displayName: '虚构本人资料', roles: ['customer'], consent: true, noticeVersion: 'memory-v1', retentionDays: 180 };
function settings(v: MemoryView) { const p = v.person!; return { version: p.version, displayName: p.displayName, roles: p.roles.filter(r => r !== 'employee'), personalization: true, doNotDisturb: false, quietStart: '23:59', quietEnd: '00:00', cooldownMinutes: 60 }; }
async function staff(headers = h.headers, workspaceId = f.workspaceA) {
  const r = await post('/people/self', { ...enrollment, workspaceId }, headers); expect(r.statusCode).toBe(200); const v = r.json().data as MemoryView;
  return { base: '/people/' + v.person!.id, headers, v, extra: {} };
}
async function guest() {
  const venueId = h.repo.get<{ id: string }>('SELECT id FROM venues WHERE workspace_id=?', f.workspaceA)!.id;
  const terminal = await post('/terminals', { venueId, name: '偏好测试终端' });
  const session = (await post('/sessions', { terminalId: terminal.json().data.id })).json().data;
  const access = await post('/sessions/' + session.id + '/access', {}), cookie = access.headers['set-cookie']!.toString().split(';')[0];
  const view = (await get('/guest/sessions/' + session.id, { cookie, 'x-csrf-token': '' })).json().data as GuestSessionView;
  const headers = { cookie, 'x-csrf-token': view.csrfToken }, base = '/guest/sessions/' + session.id + '/memory';
  const r = await post(base, { ...enrollment, focusVersion: 0 }, headers); expect(r.statusCode).toBe(200);
  return { base, headers, v: r.json().data as MemoryView, extra: { focusVersion: 0 }, sessionId: session.id as string, session: view.session };
}
type C = Awaited<ReturnType<typeof staff>> | Awaited<ReturnType<typeof guest>>;
async function read(c: C) { const r = await get(c.base, c.headers); expect(r.statusCode).toBe(200); return r.json().data as MemoryView; }
async function propose(c: C, value = '清淡', extra: Record<string, unknown> = {}) {
  const r = await post(c.base + '/facts', { key: 'like', value, visibility: 'reception', expiresAt: c.v.person!.expiresAt, ...c.extra, ...extra }, c.headers); expect(r.statusCode).toBe(200); return r.json().data as MemoryView;
}
async function decide(c: C, v: MemoryView, action = 'confirm', extra: Record<string, unknown> = {}) {
  const fact = v.facts.at(-1)!; const r = await post(c.base + '/facts/decide', { factId: fact.id, version: fact.version, action, confirmed: true, ...c.extra, ...extra }, c.headers); expect(r.statusCode).toBe(200); return r.json().data as MemoryView;
}
async function enable(c: C) { const v = await read(c); const r = await post(c.base + '/settings', { ...settings(v), ...c.extra }, c.headers); expect(r.statusCode).toBe(200); return r.json().data as MemoryView; }

describe('T06 人员 记忆与生命周期', () => {
  it('统一本人档案包含多业务角色；访客登记不授予员工身份或后台权限', async () => {
    const s = await staff(); expect(s.v.person).toMatchObject({ roles: ['employee', 'customer'], identity: 'account_verified', personalization: false, doNotDisturb: true });
    expect(memoryViewSchema.safeParse(s.v).success).toBe(true);
    const g = await guest(); expect(g.v.person).toMatchObject({ roles: ['customer'], identity: 'self_reported' });
    expect((await get('/people', g.headers)).statusCode).toBe(401); expect((await get(s.base, g.headers)).statusCode).toBe(401);
    expect((await post(g.base + '/settings', { ...settings(g.v), roles: ['employee'], focusVersion: 0 }, g.headers)).statusCode).toBe(400);
    expect((await post('/people/self', { ...enrollment, workspaceId: f.workspaceA })).statusCode).toBe(409);
  });
  it('私人资料仅本人可读；管理员目录不泄露他人私人记忆，跨租户/工作空间拒绝', async () => {
    const editor = await h.login(f.editorA), s = await staff(editor);
    await propose(s, '私人饮食记录', { visibility: 'private' });
    expect((await get(s.base)).statusCode).toBe(404); expect((await get(s.base + '/export')).statusCode).toBe(404);
    const dir = await get('/people?workspaceId=' + f.workspaceA); expect(dir.body).toContain('虚构本人资料'); expect(dir.body).not.toContain('私人饮食记录');
    expect((await get('/people?workspaceId=' + f.workspaceA, editor)).statusCode).toBe(403);
    const other = await h.login(f.adminB); expect((await get(s.base, other)).statusCode).toBe(404);
    expect((await post('/people/self', { ...enrollment, workspaceId: f.workspacePrivate }, editor)).statusCode).toBe(404);
    expect((await post('/people/self', { ...enrollment, workspaceId: f.workspaceB })).statusCode).toBe(404);
  });
  it('待确认记忆不进入接待检索，私人条目和关闭个性化的条目均不检索', async () => {
    const c = await staff(); await enable(c); const pending = await propose(c);
    expect((await get(c.base + '/search')).json().data.items).toHaveLength(0);
    await decide(c, pending); expect((await get(c.base + '/search?q=清淡')).json().data.items).toHaveLength(1);
    await decide(c, await propose(c, '私密', { visibility: 'private' })); expect((await get(c.base + '/search?q=私密')).json().data.items).toHaveLength(0);
    const v = await read(c); await post(c.base + '/settings', { ...settings(v), personalization: false }, c.headers);
    expect((await get(c.base + '/search')).json().data.items).toHaveLength(0);
  });
  it('纠正已确认值先移除索引，再重新确认；旧响应被清理，撤回内容不再可取', async () => {
    const c = await staff(); await enable(c);
    const key = randomUUID(), input = { key: 'like', value: '旧值', visibility: 'reception', expiresAt: c.v.person!.expiresAt };
    const pending = (await post(c.base + '/facts', input, c.headers, key)).json().data as MemoryView;
    const confirmed = await decide(c, pending), corrected = await decide(c, confirmed, 'correct', { value: '新值' });
    expect(corrected.facts.at(-1)).toMatchObject({ status: 'pending', value: '新值', sourceKind: 'self_statement' });
    expect((await get(c.base + '/search')).json().data.items).toHaveLength(0);
    const replay = await post(c.base + '/facts', input, c.headers, key); expect(replay.json().error.code).toBe('DATA_REMOVED'); expect(replay.body).not.toContain('旧值');
    const latest = await decide(c, corrected); expect((await get(c.base + '/search?q=新值')).json().data.items).toHaveLength(1);
    await decide(c, latest, 'revoke'); expect((await read(c)).facts.at(-1)).toMatchObject({ status: 'revoked', value: '' });
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM memory_lookup')!.n).toBe(0);
  });
  it('记忆来源只接受当前访客文字，不接受系统回复、其他会话和旧目标的内容', async () => {
    const g = await guest(), raw = '/guest/sessions/' + g.sessionId;
    const msg = await post(raw + '/messages', { text: '喜欢清淡', version: g.session.version, focusVersion: 0, source: 'typed' }, g.headers); expect(msg.statusCode).toBe(200);
    const current = msg.json().data as GuestSessionView, own = current.session.messages.find(m => m.role === 'visitor')!;
    const proposed = await propose(g, '清淡', { sourceMessageId: own.id }); expect(proposed.facts[0].sourceKind).toBe('session_text');
    const invalid = { key: 'like', value: '清淡', visibility: 'reception', expiresAt: g.v.person!.expiresAt, focusVersion: 0 };
    expect((await post(g.base + '/facts', { ...invalid, sourceMessageId: current.session.messages[0].id }, g.headers)).json().error.code).toBe('INVALID_SOURCE');
    expect((await post(g.base + '/facts', { ...invalid, sourceMessageId: randomUUID() }, g.headers)).json().error.code).toBe('INVALID_SOURCE');
    expect((await post(g.base + '/facts', { ...invalid, value: '没有说过的猜测', sourceMessageId: own.id }, g.headers)).statusCode).toBe(409);
    h.repo.run('UPDATE reception_sessions SET focus_version=focus_version+1 WHERE id=?', g.sessionId);
    expect((await get(g.base, g.headers)).json().data.person).toBeNull();
    expect((await post(g.base + '/facts', invalid, g.headers)).statusCode).toBe(404);
  });
  it('更换浏览器会话与伪造 focus 不可访问或修改原资料，来源错误不会留条目', async () => {
    const a = await guest(), b = await guest();
    expect((await get(a.base, b.headers)).statusCode).toBe(401);
    expect((await post(a.base + '/facts', { key: 'like', value: '清淡', expiresAt: a.v.person!.expiresAt, focusVersion: 9 }, a.headers)).statusCode).toBe(409);
    expect((await post(a.base + '/facts', { key: 'like', value: '清淡', expiresAt: a.v.person!.expiresAt, focusVersion: 0 }, { ...a.headers, 'x-csrf-token': 'forged' })).statusCode).toBe(403);
    expect((await read(a)).facts).toHaveLength(0);
  });
  it('摘要待办需本人复核，持久保存、完成和删除不影响其他人员', async () => {
    const c = await staff();
    expect((await post(c.base + '/notes', { kind: 'summary', text: '未复核', reviewed: false })).statusCode).toBe(400);
    const r = await post(c.base + '/notes', { kind: 'todo', text: '查看演示方案', reviewed: true, sourceMessageIds: [] }); expect(r.statusCode).toBe(200);
    const v = r.json().data as MemoryView, n = v.notes[0];
    const reopened = new Repository(h.config.dataDir); try { expect(new MemoryService(reopened, 'mock', 'development').notes(c.v.person!.id)[0].text).toBe('查看演示方案'); } finally { reopened.close(); }
    const done = await post(c.base + '/notes/control', { noteId: n.id, version: n.version, action: 'complete' }); expect(done.json().data.notes[0].status).toBe('completed');
    await post(c.base + '/notes/control', { noteId: n.id, version: n.version + 1, action: 'delete' }); expect((await read(c)).notes).toHaveLength(0);
  });
  it('导出包含本人来源与对话，不包含其他人员和接待人内部备注', async () => {
    const g = await guest(); await propose(g, '导出本人偏好');
    await post(g.base + '/notes', { kind: 'summary', text: '本人复核摘要', reviewed: true, focusVersion: 0 }, g.headers);
    const other = await staff(); await propose(other, '他人私密偏好');
    const r = await get(g.base + '/export', g.headers); expect(r.statusCode).toBe(200); expect(r.body).toContain('导出本人偏好'); expect(r.body).toContain('本人复核摘要'); expect(r.body).not.toContain('他人私密偏好'); expect(r.json().data.transcript).toHaveLength(1);
  });
  it('删除传播至主库、索引、原文、旧请求缓存；最小回执与其他人员数据保留', async () => {
    const g = await guest(), raw = '/guest/sessions/' + g.sessionId, msgInput = { text: '仅本会话应清除的原文', version: g.session.version, focusVersion: 0, source: 'typed' }, msgKey = randomUUID();
    await post(raw + '/messages', msgInput, g.headers, msgKey);
    await decide(g, await propose(g, '需删除偏好')); const other = await staff(); await propose(other, '其他资料仍保留');
    const v = await read(g), result = await post(g.base + '/erase', { version: v.person!.version, confirmed: true, focusVersion: 0 }, g.headers); expect(result.statusCode).toBe(200); expect(result.json().data).toMatchObject({ status: 'completed', external: 'not_applicable' });
    expect((await read(g)).person).toBeNull();
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM memory_facts WHERE person_id=?', v.person!.id)!.n).toBe(0);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM memory_lookup WHERE person_id=?', v.person!.id)!.n).toBe(0);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM reception_messages WHERE session_id=?', g.sessionId)!.n).toBe(0);
    expect((await post(raw + '/messages', msgInput, g.headers, msgKey)).json().error.code).toBe('DATA_REMOVED');
    expect(h.repo.all<{ response: string }>("SELECT response FROM idempotency WHERE actor_id=?", 'guest:' + g.sessionId).some(r => /需删除偏好|应清除的原文/.test(r.response))).toBe(false);
    expect((await read(other)).facts[0].value).toBe('其他资料仍保留');
    expect((await get(g.base + '/export', g.headers)).statusCode).toBe(404);
  });
  it('保留期清理到期记忆、摘要及匿名原文，已授权原文遵循独立 30 天期限', async () => {
    const g = await guest(); await decide(g, await propose(g, '到期清除'));
    await post(g.base + '/notes', { kind: 'summary', text: '到期摘要', reviewed: true, focusVersion: 0 }, g.headers);
    h.repo.run("UPDATE memory_facts SET expires_at='2000-01-01T00:00:00.000Z'"); h.repo.run("UPDATE memory_notes SET expires_at='2000-01-01T00:00:00.000Z'");
    h.repo.run("UPDATE reception_messages SET created_at='2000-01-01T00:00:00.000Z' WHERE session_id=?", g.sessionId);
    const service = new MemoryService(h.repo, 'mock', 'development');
    h.repo.transaction(() => service.sweep());
    expect((await read(g)).facts[0]).toMatchObject({ status: 'expired', value: '' }); expect((await read(g)).notes).toHaveLength(0);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM reception_messages WHERE session_id=?', g.sessionId)!.n).toBeGreaterThan(0);
    h.repo.run("UPDATE memory_session_links SET transcript_expires_at='2000-01-01T00:00:00.000Z'"); h.repo.transaction(() => service.sweep());
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM reception_messages WHERE session_id=?', g.sessionId)!.n).toBe(0);
    const a = await guest(); h.repo.run('DELETE FROM memory_session_links WHERE session_id=?', a.sessionId); h.repo.run("UPDATE reception_messages SET created_at='2000-01-01T00:00:00.000Z' WHERE session_id=?", a.sessionId); h.repo.transaction(() => service.sweep()); expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM reception_messages WHERE session_id=?', a.sessionId)!.n).toBe(0);
  });
  it('授权到期自动删除人员资料，其他环境的数据不被本环境清理', async () => {
    const c = await staff(); const service = new MemoryService(h.repo, 'mock', 'development');
    h.repo.run("UPDATE people SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", c.v.person!.id); h.repo.transaction(() => service.sweep());
    expect((await get('/people/self?workspaceId=' + f.workspaceA)).json().data.person).toBeNull();
    const d = await staff(); h.repo.run("UPDATE people SET environment='live',expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", d.v.person!.id); h.repo.transaction(() => service.sweep()); expect(h.repo.get<{ status: string }>('SELECT status FROM people WHERE id=?', d.v.person!.id)!.status).toBe('active');
    expect((await get(d.base)).statusCode).toBe(404);
  });
  it('免打扰、跨日静默时段、冷却及仅使用公开已确认称呼的规则生效', async () => {
    const c = await staff(); const service = new MemoryService(h.repo, 'mock', 'development');
    const row = () => h.repo.get<PersonRow>('SELECT * FROM people WHERE id=?', c.v.person!.id)!;
    expect(service.greet(row()).reason).toBe('disabled');
    h.repo.run('UPDATE people SET personalization=1 WHERE id=?', c.v.person!.id); expect(service.greet(row()).reason).toBe('do_not_disturb');
    h.repo.run("UPDATE people SET do_not_disturb=0,quiet_start='22:00',quiet_end='08:00' WHERE id=?", c.v.person!.id);
    expect(service.greet(row(), new Date('2026-11-18T15:00:00Z')).reason).toBe('quiet_hours');
    await decide(c, await propose(c, '公开昵称', { key: 'nickname' }));
    await decide(c, await propose(c, '不应播报的私密偏好', { visibility: 'private' }));
    const yes = h.repo.transaction(() => service.greet(row(), new Date('2026-11-18T04:00:00Z'))); expect(yes.text).toContain('公开昵称'); expect(yes.text).not.toContain('私密偏好');
    expect(service.greet(row(), new Date('2026-11-18T04:01:00Z')).reason).toBe('cooldown');
  });
  it('过期版本、未同意登记和越过授权期的记忆被拒绝', async () => {
    expect((await post('/people/self', { ...enrollment, consent: false, workspaceId: f.workspaceA })).statusCode).toBe(400);
    const c = await staff(); await enable(c);
    expect((await post(c.base + '/settings', settings(c.v))).json().error.code).toBe('VERSION_CONFLICT');
    expect((await post(c.base + '/facts', { key: 'like', value: '过期', expiresAt: '2000-01-01T00:00:00.000Z' })).statusCode).toBe(400);
    expect((await post(c.base + '/facts', { key: 'like', value: '过久', expiresAt: '2099-01-01T00:00:00.000Z' })).statusCode).toBe(400);
  });
  it('实际文字回复只使用当前本人已确认的公开偏好，撤回使旧个性化回复和缓存失效', async () => {
    const g = await guest(), base = '/guest/sessions/' + g.sessionId;
    await enable(g); await decide(g, await propose(g, '公开清淡偏好'));
    await decide(g, await propose(g, '不可公开偏好', { visibility: 'private' }));
    async function ask() {
      const current = (await get(base, g.headers)).json().data as GuestSessionView;
      const r = await post(base + '/messages', { text: '还记得我的偏好吗', version: current.session.version, focusVersion: 0, source: 'typed' }, g.headers); expect(r.statusCode).toBe(200); return r.json().data as GuestSessionView;
    }
    const reply = await ask(); expect(reply.session.messages.at(-1)?.text).toContain('公开清淡偏好'); expect(reply.session.messages.at(-1)?.text).not.toContain('不可公开偏好');
    const oldReply = reply.session.messages.at(-1)!;
    await post(base + '/events', { type: 'reply.started', replyId: oldReply.id, replyEpoch: oldReply.replyEpoch, focusVersion: oldReply.focusVersion }, g.headers);
    const v = await read(g), fact = v.facts.find(fact => fact.value === '公开清淡偏好')!;
    await post(g.base + '/facts/decide', { factId: fact.id, version: fact.version, action: 'revoke', confirmed: true, focusVersion: 0 }, g.headers);
    const after = await ask(); expect(after.session.messages.some(m => m.role === 'assistant' && m.text.includes('公开清淡偏好'))).toBe(false);
    expect(after.session.messages.at(-1)?.text).toContain('当前没有');
    expect(after.session.replyEpoch).toBeGreaterThan(reply.session.replyEpoch);
    expect((await post(base + '/events', { type: 'reply.completed', replyId: oldReply.id, replyEpoch: oldReply.replyEpoch, focusVersion: oldReply.focusVersion }, g.headers)).statusCode).toBe(409);
  });
  it('空闲终端仅在自愿开启且允许的时段主动问候一次，不打断人工和播放中的回复', async () => {
    const g = await guest(); await decide(g, await propose(g, '演示称呼', { key: 'nickname' }));
    const now = new Date(), minutes = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const v = await read(g); await post(g.base + '/settings', { ...settings(v), quietStart: minutes, quietEnd: minutes, focusVersion: 0 }, g.headers);
    h.repo.run('UPDATE reception_sessions SET activity_at=? WHERE id=?', new Date(now.getTime() - 5000).toISOString(), g.sessionId);
    expect(processMemoryGreetings(h.repo, 'mock', 'development', now)).toBe(0); // Equal times mean all-day silence.
    const quietHour = String((Number(minutes.slice(0, 2)) + 2) % 24).padStart(2, '0');
    h.repo.run('UPDATE people SET quiet_start=?,quiet_end=? WHERE id=?', quietHour + ':00', quietHour + ':01', g.v.person!.id);
    h.repo.run("UPDATE reception_messages SET status='playing' WHERE session_id=?", g.sessionId);
    expect(processMemoryGreetings(h.repo, 'mock', 'development', now)).toBe(0);
    h.repo.run("UPDATE reception_messages SET status='ready' WHERE session_id=?", g.sessionId);
    expect(processMemoryGreetings(h.repo, 'mock', 'development', now)).toBe(1);
    expect(processMemoryGreetings(h.repo, 'mock', 'development', now)).toBe(0);
    expect(h.repo.get<{ text: string }>('SELECT text FROM reception_messages WHERE memory_person_id=?', g.v.person!.id)!.text).toContain('演示称呼');
    expect(processMemoryGreetings(h.repo, 'live', 'development', now)).toBe(0);
  });
  it('删除已登记访客资料会遮蔽来访信息并阻断待发通知，30 天业务信息单独到期', async () => {
    const g = await guest(), base = '/guest/sessions/' + g.sessionId + '/visit';
    await post(base, { guestName: '待删除访客', company: '待删除单位', hostName: '林知', purpose: '待删除事由', version: null, focusVersion: 0 }, g.headers);
    const draft = (await get(base, g.headers)).json().data;
    await post(base + '/confirm', { version: draft.visit.version, focusVersion: 0, confirmationToken: draft.confirmation.token, expiresAt: draft.confirmation.expiresAt, noticeVersion: 'visit-v1', confirmed: true }, g.headers);
    const confirmed = (await get(base, g.headers)).json().data;
    await post(base + '/notify', { version: confirmed.visit.version, focusVersion: 0 }, g.headers);
    const v = await read(g); const erased = await post(g.base + '/erase', { version: v.person!.version, confirmed: true, focusVersion: 0 }, g.headers); expect(erased.statusCode).toBe(200);
    const visit = (await get('/visits?workspaceId=' + f.workspaceA)).json().data.items[0]; expect(visit).toMatchObject({ guestName: '已删除资料', company: '', purpose: '', status: 'escalated' }); expect(visit.delivery.status).toBe('cancelled');
    const other = await guest(), path = '/guest/sessions/' + other.sessionId + '/visit';
    await post(path, { guestName: '过期来访信息', hostName: '林知', purpose: '过期事由', version: null, focusVersion: 0 }, other.headers);
    h.repo.run("UPDATE visits SET created_at='2000-01-01T00:00:00.000Z' WHERE session_id=?", other.sessionId);
    h.repo.transaction(() => new MemoryService(h.repo, 'mock', 'development').sweep());
    expect((await get(path, other.headers)).json().data.visit.guestName).toBe('已删除资料');
  });
});

