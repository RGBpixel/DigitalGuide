import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { GuestSessionView, MemoryView, RecoveryIssue } from '@digitalguide/contracts';
import { MemoryService } from '../../apps/api/src/memory-service.js';
import { processMemoryGreetings } from '../../apps/worker/src/memory-greetings.js';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { await h.close(); });
function post(path: string, payload: Record<string, unknown>, headers = h.headers, key = randomUUID()) { return h.app.inject({ method: 'POST', url: '/api/v1' + path, payload, headers: { ...headers, 'idempotency-key': key } }); }
function get(path: string, headers = h.headers) { return h.app.inject({ url: '/api/v1' + path, headers }); }
const enrollment = { displayName: '同名演示访客', roles: ['visitor'], consent: true, noticeVersion: 'memory-v1', retentionDays: 180, focusVersion: 0 };
async function guest(enroll = true, workspaceId = f.workspaceA, headers = h.headers) {
  const venueId = h.repo.get<{ id: string }>('SELECT id FROM venues WHERE workspace_id=?', workspaceId)!.id;
  const terminal = (await post('/terminals', { venueId, name: '恢复偏好终端' }, headers)).json().data;
  const session = (await post('/sessions', { terminalId: terminal.id }, headers)).json().data;
  const access = await post('/sessions/' + session.id + '/access', {}, headers), cookie = access.headers['set-cookie']!.toString().split(';')[0];
  const self = (await get('/guest/sessions/' + session.id, { cookie, 'x-csrf-token': '' })).json().data as GuestSessionView;
  const credential = { cookie, 'x-csrf-token': self.csrfToken }, base = '/guest/sessions/' + session.id, key = randomUUID();
  if (enroll) { const r = await post(base + '/memory', enrollment, credential, key); expect(r.statusCode, r.body).toBe(200); }
  return { sessionId: session.id as string, headers: credential, base, enrollmentKey: key };
}
type Context = Awaited<ReturnType<typeof guest>>;
async function view(c: Context) { return (await get(c.base + '/memory', c.headers)).json().data as MemoryView; }
async function issue(c: Context, key = randomUUID()) {
  const v = await view(c), input = { version: v.person!.version, focusVersion: 0, confirmed: true };
  const r = await post(c.base + '/memory/recovery', input, c.headers, key); expect(r.statusCode, r.body).toBe(200);
  return { response: r.json().data as RecoveryIssue, input, key };
}
async function close(c: Context) {
  const self = (await get(c.base, c.headers)).json().data as GuestSessionView;
  const r = await post(c.base + '/control', { action: 'end', version: self.session.version, focusVersion: self.session.focusVersion }, c.headers); expect(r.statusCode, r.body).toBe(200);
}
function restore(c: Context, code: string, key = randomUUID()) { return post(c.base + '/memory/restore', { recoveryCode: code, focusVersion: 0, consent: true, noticeVersion: 'memory-v1' }, c.headers, key); }
async function confirmedPreference(c: Context) {
  const v = await view(c), p = v.person!;
  await post(c.base + '/memory/settings', { version: p.version, displayName: p.displayName, roles: ['visitor'], personalization: true, doNotDisturb: false, quietStart: '00:00', quietEnd: '00:01', cooldownMinutes: 60, focusVersion: 0 }, c.headers);
  const saved = (await post(c.base + '/memory/facts', { key: 'like', value: '本人明确喜欢温水', visibility: 'reception', expiresAt: p.expiresAt, focusVersion: 0 }, c.headers)).json().data as MemoryView;
  const fact = saved.facts[0]; await post(c.base + '/memory/facts/decide', { factId: fact.id, version: fact.version, action: 'confirm', confirmed: true, focusVersion: 0 }, c.headers);
}
describe('T26 跨会话记忆接续', () => {
  it('有效凭证接续同一人员的确认偏好，不提升员工或后台权限，使用后凭证失效', async () => {
    const old = await guest(); await confirmedPreference(old); const before = await view(old), code = (await issue(old)).response; await close(old);
    const next = await guest(false), result = await restore(next, code.recoveryCode); expect(result.statusCode, result.body).toBe(200);
    const current = result.json().data as MemoryView; expect(current.person?.id).toBe(before.person?.id); expect(current.person?.identity).toBe('self_reported'); expect(current.person?.roles).toEqual(['visitor']); expect(current.facts[0]).toMatchObject({ status: 'confirmed', value: '本人明确喜欢温水' });
    expect((await get(next.base + '/memory/search', next.headers)).json().data.items[0].value).toContain('温水');
    expect((await get('/office/inbox', next.headers)).statusCode).toBe(401);
    expect((await get(old.base + '/memory', old.headers)).statusCode).toBe(401);
    const another = await guest(false); expect((await restore(another, code.recoveryCode)).json().error.code).toBe('RESTORE_UNAVAILABLE');
  });
  it('凭证原文不落库、普通资料不回传凭证，同一生成操作可安全重试', async () => {
    const c = await guest(), issued = await issue(c);
    const replay = await post(c.base + '/memory/recovery', issued.input, c.headers, issued.key); expect(replay.statusCode).toBe(200); expect(replay.json().data.recoveryCode).toBe(issued.response.recoveryCode);
    expect(JSON.stringify(h.repo.all('SELECT * FROM memory_recovery_credentials'))).not.toContain(issued.response.recoveryCode);
    expect(JSON.stringify(h.repo.all('SELECT * FROM idempotency'))).not.toContain(issued.response.recoveryCode);
    expect(JSON.stringify(h.repo.all('SELECT * FROM audit_events'))).not.toContain(issued.response.recoveryCode);
    expect((await get(c.base + '/memory', c.headers)).body).not.toContain(issued.response.recoveryCode);
  });
  it('重新生成和显式撤销使旧凭证无效，过期凭证也不能恢复', async () => {
    const c = await guest(), first = await issue(c), second = await issue(c);
    await close(c); const next = await guest(false);
    expect((await restore(next, first.response.recoveryCode)).statusCode).toBe(409);
    h.repo.run("UPDATE memory_recovery_credentials SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", second.response.credentialId);
    expect((await restore(next, second.response.recoveryCode)).statusCode).toBe(409);
    expect(h.repo.get<{ token_hash: string }>('SELECT token_hash FROM memory_recovery_credentials WHERE id=?', second.response.credentialId)!.token_hash).toBe('');
    const owner = await guest(), active = await issue(owner), v = await view(owner);
    expect((await post(owner.base + '/memory/recovery/revoke', { version: v.person!.version, focusVersion: 0, confirmed: true }, owner.headers)).statusCode).toBe(200);
    await close(owner); expect((await restore(next, active.response.recoveryCode)).statusCode).toBe(409);
  });
  it('原会话未结束不能转移，其他工作空间和租户无法使用同一凭证', async () => {
    const c = await guest(), code = (await issue(c)).response, next = await guest(false);
    expect((await restore(next, code.recoveryCode)).statusCode).toBe(409);
    await close(c);
    const privateSpace = await guest(false, f.workspacePrivate); expect((await restore(privateSpace, code.recoveryCode)).statusCode).toBe(409);
    const other = await guest(false, f.workspaceB, await h.login(f.adminB)); expect((await restore(other, code.recoveryCode)).statusCode).toBe(409);
    expect((await restore(next, code.recoveryCode)).statusCode).toBe(200);
  });
  it('同名不关联且不覆盖已有资料，伪造凭证失败不泄露本人偏好', async () => {
    const one = await guest(), two = await guest(), code = (await issue(one)).response;
    expect((await view(one)).person!.id).not.toBe((await view(two)).person!.id); await close(one);
    expect((await restore(two, code.recoveryCode)).json().error.code).toBe('STATE_CONFLICT');
    const blank = await guest(false), forged = code.recoveryCode.slice(0, -1) + (code.recoveryCode.endsWith('A') ? 'B' : 'A');
    const invalid = await restore(blank, forged); expect(invalid.json().error.code).toBe('RESTORE_UNAVAILABLE'); expect(invalid.body).not.toContain('同名演示访客');
  });
  it('服务对象变化后，重放登记或生成凭证的旧请求不返回旧资料或密钥', async () => {
    const c = await guest(), issued = await issue(c); h.repo.run('UPDATE reception_sessions SET focus_version=1 WHERE id=?', c.sessionId);
    const enrolled = await post(c.base + '/memory', enrollment, c.headers, c.enrollmentKey); expect(enrolled.json().error.code).toBe('VERSION_CONFLICT'); expect(enrolled.body).not.toContain('同名演示访客');
    const code = await post(c.base + '/memory/recovery', issued.input, c.headers, issued.key); expect(code.json().error.code).toBe('VERSION_CONFLICT'); expect(code.body).not.toContain(issued.response.recoveryCode);
    expect((await view(c)).person).toBeNull();
  });
  it('恢复后的导出仅含本人各次绑定原文，删除传播到旧会话、索引和恢复凭证', async () => {
    const old = await guest(); await confirmedPreference(old);
    let s = (await get(old.base, old.headers)).json().data as GuestSessionView;
    await post(old.base + '/messages', { text: '旧会话本人原文', version: s.session.version, focusVersion: 0, source: 'typed' }, old.headers);
    const code = (await issue(old)).response; await close(old); const next = await guest(false); await restore(next, code.recoveryCode);
    s = (await get(next.base, next.headers)).json().data as GuestSessionView;
    await post(next.base + '/messages', { text: '新会话本人原文', version: s.session.version, focusVersion: 0, source: 'typed' }, next.headers);
    h.repo.run("INSERT INTO reception_messages(id,session_id,tenant_id,workspace_id,role,text,status,reply_epoch,focus_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", randomUUID(), old.sessionId, f.tenantA, f.workspaceA, 'visitor', '其他服务对象内容', 'received', 9, 99, new Date().toISOString());
    const exported = await get(next.base + '/memory/export', next.headers); expect(exported.body).toContain('旧会话本人原文'); expect(exported.body).toContain('新会话本人原文'); expect(exported.body).not.toContain('其他服务对象内容');
    const v = await view(next); const erased = await post(next.base + '/memory/erase', { version: v.person!.version, confirmed: true, focusVersion: 0 }, next.headers); expect(erased.statusCode).toBe(200);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM memory_lookup WHERE person_id=?', v.person!.id)!.n).toBe(0);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM memory_session_links WHERE person_id=?', v.person!.id)!.n).toBe(0);
    expect(h.repo.get<{ n: number }>("SELECT count(*) AS n FROM reception_messages WHERE text IN ('旧会话本人原文','新会话本人原文')")!.n).toBe(0);
    expect(h.repo.get<{ n: number }>("SELECT count(*) AS n FROM reception_messages WHERE text='其他服务对象内容'")!.n).toBe(1);
    expect(h.repo.get<{ token_hash: string }>('SELECT token_hash FROM memory_recovery_credentials WHERE id=?', code.credentialId)!.token_hash).toBe('');
  });
  it('连续失败尝试有持久限频，不因失败事务回滚而重置', async () => {
    const c = await guest(false), fake = 'DG1.' + randomUUID() + '.' + 'A'.repeat(43);
    for (let i = 0; i < 10; i++) expect((await restore(c, fake)).statusCode).toBe(409);
    expect((await restore(c, fake)).json().error.code).toBe('RATE_LIMITED');
    expect(h.repo.get<{ n: number }>("SELECT count(*) AS n FROM audit_events WHERE action='memory.restore_attempt'")!.n).toBe(10);
  });
  it('恢复到新会话后，问候按本人冷却规则执行，不能在同次接待反复问候', async () => {
    const old = await guest(); await confirmedPreference(old); const code = (await issue(old)).response;
    const personId = (await view(old)).person!.id; await close(old); const next = await guest(false); await restore(next, code.recoveryCode);
    const now = new Date(); h.repo.run('UPDATE people SET last_greeted_at=? WHERE id=?', new Date(now.getTime() - 61 * 60000).toISOString(), personId);
    h.repo.run('UPDATE reception_sessions SET activity_at=? WHERE id=?', new Date(now.getTime() - 5000).toISOString(), next.sessionId);
    expect(processMemoryGreetings(h.repo, 'mock', 'development', now)).toBe(1); expect(processMemoryGreetings(h.repo, 'mock', 'development', now)).toBe(0);
  });
  it('本人授权到期会清理所有历史绑定；旧凭证不复活已删除档案', async () => {
    const c = await guest(), code = (await issue(c)).response, p = (await view(c)).person!;
    await close(c); h.repo.run("UPDATE people SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", p.id);
    h.repo.transaction(() => new MemoryService(h.repo, 'mock', 'development').sweep());
    const next = await guest(false); expect((await restore(next, code.recoveryCode)).statusCode).toBe(409);
    expect(h.repo.get<{ status: string }>('SELECT status FROM people WHERE id=?', p.id)!.status).toBe('deleted');
  });
});

