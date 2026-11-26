import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Repository } from '@digitalguide/database';
import { visitSchema, internalVisitSchema, type GuestSessionView, type GuestVisitView } from '@digitalguide/contracts';
import type { NotificationProvider } from '@digitalguide/providers';
import { notificationProvider, processVisitNotification } from '../../apps/worker/src/visit-notifications.js';
import { signNotificationReceipt } from '../../apps/api/src/notification-receipts.js';
import { VisitService } from '../../apps/api/src/visit-service.js';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { await h.close(); });
function post(path: string, payload: Record<string, unknown>, headers = h.headers, key = randomUUID()) { return h.app.inject({ method: 'POST', url: '/api/v1' + path, payload, headers: { ...headers, 'idempotency-key': key } }); }
async function setup(hostName = '林知') {
  const venueId = h.repo.get<{ id: string }>('SELECT id FROM venues WHERE workspace_id=?', f.workspaceA)!.id;
  const terminal = await post('/terminals', { venueId, name: '来访测试终端' });
  const session = await post('/sessions', { terminalId: terminal.json().data.id });
  const sessionId = session.json().data.id as string;
  const access = await post('/sessions/' + sessionId + '/access', {});
  const cookie = access.headers['set-cookie']!.toString().split(';')[0];
  const self = await h.app.inject({ url: '/api/v1/guest/sessions/' + sessionId, headers: { cookie } });
  const sessionView = self.json().data as GuestSessionView;
  const headers = { cookie, 'x-csrf-token': sessionView.csrfToken }, url = '/guest/sessions/' + sessionId + '/visit';
  const draftInput = { guestName: '虚构访客甲', company: '合成测试单位', hostName, purpose: '讨论演示项目', appointmentRef: 'DEMO-ONLY', version: null, focusVersion: 0 };
  const saved = await post(url, draftInput, headers); expect(saved.statusCode).toBe(200);
  const view = saved.json().data as GuestVisitView;
  return { sessionId, url, headers, view, draftInput };
}
type Context = Awaited<ReturnType<typeof setup>>;
async function read(c: Context) { return (await h.app.inject({ url: '/api/v1' + c.url, headers: c.headers })).json().data as GuestVisitView; }
async function confirm(c: Context, view = c.view) {
  const result = await post(c.url + '/confirm', { version: view.visit!.version, focusVersion: view.visit!.focusVersion, confirmationToken: view.confirmation!.token, expiresAt: view.confirmation!.expiresAt, noticeVersion: 'visit-v1', confirmed: true }, c.headers);
  expect(result.statusCode).toBe(200); return result.json().data as GuestVisitView;
}
async function notify(c: Context, view: GuestVisitView) {
  const result = await post(c.url + '/notify', { version: view.visit!.version, focusVersion: view.visit!.focusVersion }, c.headers); expect(result.statusCode).toBe(200); return result.json().data as GuestVisitView;
}
describe('T05 来访登记与可信接待结论', () => {
  it('访客确认后只提交一个模拟通知；接待人同意、指引及结束可持久恢复', async () => {
    const c = await setup(), confirmed = await confirm(c), queued = await notify(c, confirmed);
    expect(queued.visit?.delivery?.status).toBe('queued'); expect(queued.visit?.status).toBe('notifying');
    await notify(c, confirmed); expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM visit_deliveries')!.n).toBe(1);
    await processVisitNotification(h.repo, 'mock', 'development');
    const pending = (await read(c)).visit!; expect(pending.status).toBe('waiting_host'); expect(pending.delivery?.status).toBe('submitted'); expect(pending.publicMessage).not.toContain('已明确同意');
    const response = await post('/visits/' + pending.id + '/respond', { version: pending.version, decision: 'accepted', guidanceCode: 'waiting_area', privateNote: '仅接待人可见的虚构备注' }); expect(response.statusCode).toBe(200); expect(internalVisitSchema.safeParse(response.json().data).success).toBe(true);
    const accepted = (await read(c)).visit!; expect(visitSchema.safeParse(accepted).success).toBe(true); expect(accepted.guidance).toContain('一层访客等候区'); expect(JSON.stringify(accepted)).not.toContain('仅接待人可见');
    const done = await post(c.url + '/control', { version: accepted.version, focusVersion: accepted.focusVersion, action: 'complete' }, c.headers); expect(done.json().data.visit.status).toBe('completed');
    const reopened = new Repository(h.config.dataDir); try { expect(reopened.get<{ status: string; notice_version: string }>('SELECT status,notice_version FROM visits WHERE id=?', accepted.id)).toMatchObject({ status: 'completed', notice_version: 'visit-v1' }); expect(reopened.get<{ n: number }>('SELECT count(*) AS n FROM mock_notification_submissions')!.n).toBe(1); } finally { reopened.close(); }
  });
  it('修改资料使旧确认失效，未确认/过期/伪造确认不能发送通知', async () => {
    const c = await setup();
    expect((await post(c.url + '/notify', { version: 1, focusVersion: 0 }, c.headers)).json().error.code).toBe('CONFIRMATION_REQUIRED');
    const edited = await post(c.url, { ...c.draftInput, purpose: '新事由', version: 1 }, c.headers); expect(edited.statusCode).toBe(200);
    const original = { version: 1, focusVersion: 0, confirmationToken: c.view.confirmation!.token, expiresAt: c.view.confirmation!.expiresAt, noticeVersion: 'visit-v1', confirmed: true };
    expect((await post(c.url + '/confirm', original, c.headers)).json().error.code).toBe('VERSION_CONFLICT');
    const fresh = edited.json().data as GuestVisitView;
    expect((await post(c.url + '/confirm', { ...original, version: 2, confirmationToken: 'forged-confirmation-token-that-is-invalid' }, c.headers)).statusCode).toBe(403);
    expect((await post(c.url + '/confirm', { ...original, version: 2, confirmationToken: fresh.confirmation!.token, expiresAt: '2000-01-01T00:00:00.000Z' }, c.headers)).json().error.code).toBe('CONFIRMATION_EXPIRED');
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM visit_deliveries')!.n).toBe(0);
  });
  it('重复保存与确认幂等，确认后不能改写访客或受访人', async () => {
    const c = await setup(), key = randomUUID(), payload = { ...c.draftInput, version: 1, guestName: '另一虚构称呼' };
    const first = await post(c.url, payload, c.headers, key), repeat = await post(c.url, payload, c.headers, key); expect(repeat.json().data.visit.version).toBe(first.json().data.visit.version);
    const view = first.json().data as GuestVisitView, confirmKey = randomUUID();
    const input = { version: view.visit!.version, focusVersion: 0, confirmationToken: view.confirmation!.token, expiresAt: view.confirmation!.expiresAt, noticeVersion: 'visit-v1', confirmed: true };
    const a = await post(c.url + '/confirm', input, c.headers, confirmKey), b = await post(c.url + '/confirm', input, c.headers, confirmKey); expect(a.statusCode).toBe(200); expect(b.json().data.visit.version).toBe(a.json().data.visit.version);
    expect((await post(c.url, { ...payload, version: a.json().data.visit.version }, c.headers)).statusCode).toBe(409);
  });
  it('指定接待人才能回复，管理员不能代替其他员工同意，访客不能读取后台或内部备注', async () => {
    const c = await setup('陈墨'); await notify(c, await confirm(c)); await processVisitNotification(h.repo, 'mock', 'development');
    const row = (await read(c)).visit!;
    expect((await post('/visits/' + row.id + '/respond', { version: row.version, decision: 'accepted' })).statusCode).toBe(404);
    const host = await h.login(f.editorA);
    const inbox = await h.app.inject({ url: '/api/v1/visits/inbox', headers: host }); expect(inbox.json().data.items).toHaveLength(1);
    expect((await h.app.inject({ url: '/api/v1/visits', headers: host })).statusCode).toBe(403);
    const response = await post('/visits/' + row.id + '/respond', { version: row.version, decision: 'declined', privateNote: 'do-not-expose-staff-note' }, host); expect(response.statusCode).toBe(200);
    expect(JSON.stringify(await read(c))).not.toContain('do-not-expose-staff-note'); expect((await read(c)).visit?.status).toBe('declined');
    for (const path of ['/visits', '/visits/inbox']) expect((await h.app.inject({ url: '/api/v1' + path, headers: c.headers })).statusCode).toBe(401);
  });
  it('跨租户、工作空间与其他访客不能访问或处理本次来访', async () => {
    const c = await setup(), other = await setup(); await notify(c, await confirm(c)); await processVisitNotification(h.repo, 'mock', 'development');
    const row = (await read(c)).visit!, tenantB = await h.login(f.adminB);
    expect((await post('/visits/' + row.id + '/control', { version: row.version, action: 'complete' }, tenantB)).statusCode).toBe(404);
    expect((await h.app.inject({ url: '/api/v1/visits', headers: tenantB })).json().data.items).toHaveLength(0);
    expect((await h.app.inject({ url: '/api/v1' + c.url, headers: other.headers })).statusCode).toBe(401);
    expect((await h.app.inject({ url: '/api/v1/visits?workspaceId=' + f.workspaceA, headers: tenantB })).statusCode).toBe(404);
  });
  it('通知失败或未知转人工，不自动重发；接待人仍可明确处理', async () => {
    for (const scenario of ['failed', 'unknown']) {
      const c = await setup();
      const configure = await post('/visits/' + c.view.visit!.id + '/mock-notification', { version: c.view.visit!.version, scenario }); expect(configure.statusCode).toBe(200);
      await notify(c, await confirm(c, await read(c))); await processVisitNotification(h.repo, 'mock', 'development');
      const row = (await read(c)).visit!; expect(row.status).toBe('escalated'); expect(row.delivery?.status).toBe(scenario); expect(row.guidance).toBeNull();
      const terminalState = (await h.app.inject({ url: '/api/v1/guest/sessions/' + c.sessionId, headers: c.headers })).json().data as GuestSessionView;
      expect(terminalState.session.status).toBe('human'); expect(terminalState.session.messages.filter(message => message.role === 'assistant' && ['ready', 'playing'].includes(message.status))).toHaveLength(0);
      expect(await processVisitNotification(h.repo, 'mock', 'development')).toBe(false);
      const accepted = await post('/visits/' + row.id + '/respond', { version: row.version, decision: 'accepted' }); expect(accepted.statusCode).toBe(200);
    }
  });
  it('未联系到指定受访人和超过等待时限均进入人工处理，不伪造接待同意', async () => {
    const unknown = await setup('未发布的虚构受访人'); const fallback = await notify(unknown, await confirm(unknown)); expect(fallback.visit?.status).toBe('escalated'); expect(fallback.visit?.delivery).toBeNull();
    const c = await setup(); await notify(c, await confirm(c)); await processVisitNotification(h.repo, 'mock', 'development');
    const row = (await read(c)).visit!; h.repo.run("UPDATE visits SET host_deadline='2000-01-01T00:00:00.000Z' WHERE id=?", row.id);
    h.repo.transaction(() => new VisitService(h.repo, 'mock', 'development').sweep());
    expect((await read(c)).visit?.status).toBe('escalated'); expect((await read(c)).visit?.publicMessage).not.toContain('已明确同意');
  });
  it('取消后的排队通知不发送，访客离开后确认记录保留并转人工', async () => {
    const c = await setup(); const queued = await notify(c, await confirm(c));
    expect((await post(c.url + '/control', { version: queued.visit!.version, focusVersion: 0, action: 'cancel' }, c.headers)).json().data.visit.status).toBe('cancelled');
    expect(await processVisitNotification(h.repo, 'mock', 'development')).toBe(false); expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM mock_notification_submissions')!.n).toBe(0);
    const active = await setup(); await notify(active, await confirm(active));
    const self = (await h.app.inject({ url: '/api/v1/guest/sessions/' + active.sessionId, headers: active.headers })).json().data as GuestSessionView;
    await post('/guest/sessions/' + active.sessionId + '/control', { action: 'end', version: self.session.version, focusVersion: self.session.focusVersion }, active.headers);
    expect(h.repo.get<{ status: string; confirmed_at: string }>('SELECT status,confirmed_at FROM visits WHERE session_id=?', active.sessionId)).toMatchObject({ status: 'escalated' });
    expect(h.repo.get<{ confirmed_at: string }>('SELECT confirmed_at FROM visits WHERE session_id=?', active.sessionId)!.confirmed_at).toBeTruthy();
  });
  it('人工接管或 focusVersion 改变使旧确认失效，模型/音频字段不能跳过登记', async () => {
    const c = await setup();
    const self = (await h.app.inject({ url: '/api/v1/guest/sessions/' + c.sessionId, headers: c.headers })).json().data as GuestSessionView;
    await post('/guest/sessions/' + c.sessionId + '/control', { action: 'handoff', version: self.session.version, focusVersion: 0 }, c.headers);
    const confirmation = { version: 1, focusVersion: 0, confirmationToken: c.view.confirmation!.token, expiresAt: c.view.confirmation!.expiresAt, noticeVersion: 'visit-v1', confirmed: true };
    expect((await post(c.url + '/confirm', confirmation, c.headers)).statusCode).toBe(409);
    expect((await post(c.url, { ...c.draftInput, version: 1, focusVersion: 1, employeeVerified: true, source: 'audio' }, c.headers)).statusCode).toBe(400);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM visit_deliveries')!.n).toBe(0);
  });
  it('签名回执验签、去重及防重放；送达或已读不等于员工同意，迟到失败不降级', async () => {
    const c = await setup(); await notify(c, await confirm(c)); await processVisitNotification(h.repo, 'mock', 'development');
    const visit = (await read(c)).visit!, deliveryId = visit.delivery!.id;
    const body = { eventId: randomUUID(), deliveryId, environment: 'mock', schemaVersion: 1, status: 'delivered', occurredAt: new Date().toISOString() };
    const callback = (payload = body, timestamp = String(Date.now()), signature = signNotificationReceipt(h.config, payload, timestamp)) => h.app.inject({ method: 'POST', url: '/api/v1/webhooks/mock-notification', payload, headers: { 'x-notification-timestamp': timestamp, 'x-notification-signature': signature } });
    expect((await callback(body, String(Date.now()), '0'.repeat(64))).statusCode).toBe(403);
    expect((await callback(body, String(Date.now() - 600000))).statusCode).toBe(403);
    expect((await callback()).json().data.disposition).toBe('applied'); expect((await callback()).json().data.duplicate).toBe(true);
    expect((await read(c)).visit!.status).toBe('waiting_host');
    expect((await callback({ ...body, status: 'acknowledged' })).statusCode).toBe(409);
    expect((await callback({ ...body, eventId: randomUUID(), status: 'acknowledged' })).statusCode).toBe(200);
    expect((await callback({ ...body, eventId: randomUUID(), status: 'failed' })).json().data.disposition).toBe('ignored');
    expect((await read(c)).visit!.delivery?.status).toBe('acknowledged'); expect((await read(c)).visit!.status).toBe('waiting_host');
  });
  it('通知租约过期后先查询已有提交，迟到 worker 不覆盖接管结果或重复通知', async () => {
    const c = await setup(); const queued = await notify(c, await confirm(c));
    let release: () => void = () => {}, sent: () => void = () => {};
    const waiting = new Promise<void>(resolve => { release = resolve; }), submitted = new Promise<void>(resolve => { sent = resolve; });
    const base = notificationProvider(h.repo, 'mock');
    const slow: NotificationProvider = { ...base, async send(input) { const result = await base.send(input); sent(); await waiting; return result; } };
    const old = processVisitNotification(h.repo, 'mock', 'development', slow); await submitted;
    h.repo.run("UPDATE visit_deliveries SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?", queued.visit!.delivery!.id);
    const reopened = new Repository(h.config.dataDir); try { await processVisitNotification(reopened, 'mock', 'development'); } finally { reopened.close(); release(); } await old;
    expect((await read(c)).visit!.delivery!.status).toBe('submitted'); expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM mock_notification_submissions')!.n).toBe(1);
  });
  it('受访人绑定变化后不向旧账号发送，也不能用新绑定代替旧确认', async () => {
    const c = await setup(); await notify(c, await confirm(c));
    h.repo.run('UPDATE reception_hosts SET user_id=? WHERE public_name=? AND workspace_id=?', f.editorA, '林知', f.workspaceA);
    await processVisitNotification(h.repo, 'mock', 'development'); const row = (await read(c)).visit!;
    expect(row.status).toBe('escalated'); expect(row.delivery?.status).toBe('cancelled');
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM mock_notification_submissions')!.n).toBe(0);
    const changed = await h.login(f.editorA);
    expect((await post('/visits/' + row.id + '/respond', { version: row.version, decision: 'accepted' }, changed)).statusCode).toBe(404);
    expect((await h.app.inject({ url: '/api/v1/visits/inbox', headers: changed })).json().data.items).toHaveLength(0);
  });
  it('通知额度在事务内执行，未发送的确认记录仍保留', async () => {
    const c = await setup(); const confirmed = await confirm(c); h.repo.run('UPDATE tenants SET daily_limit=0 WHERE id=?', f.tenantA);
    const response = await post(c.url + '/notify', { version: confirmed.visit!.version, focusVersion: 0 }, c.headers);
    expect(response.json().error.code).toBe('QUOTA_EXCEEDED'); expect((await read(c)).visit?.confirmedAt).toBeTruthy();
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM visit_deliveries')!.n).toBe(0);
  });
  it('同租户通知并发上限包含有效租约，恢复已提交结果前不派发下一份', async () => {
    const c = await setup(); await notify(c, await confirm(c));
    const second = await setup(); await notify(second, await confirm(second));
    let release: () => void = () => {}, sent: () => void = () => {};
    const waiting = new Promise<void>(resolve => { release = resolve; }), submitted = new Promise<void>(resolve => { sent = resolve; });
    const base = notificationProvider(h.repo, 'mock');
    const slow: NotificationProvider = { ...base, async send(input) { const result = await base.send(input); sent(); await waiting; return result; } };
    const first = processVisitNotification(h.repo, 'mock', 'development', slow); await submitted;
    expect(await processVisitNotification(h.repo, 'mock', 'development')).toBe(false);
    release(); await first; expect(await processVisitNotification(h.repo, 'mock', 'development')).toBe(true);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM mock_notification_submissions')!.n).toBe(2);
  });
});
