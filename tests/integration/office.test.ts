import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Repository } from '@digitalguide/database';
import { officeNotificationSchema, officeRelaySchema, calendarEventSchema } from '@digitalguide/contracts';
import { type OfficeDeliveryProvider } from '@digitalguide/providers';
import { OfficeService, type OfficeNoticeRow } from '../../apps/api/src/office-service.js';
import { officeProvider, processOfficeNotification } from '../../apps/worker/src/office-notifications.js';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { vi.useRealTimers(); await h.close(); });
function post(path: string, payload: Record<string, unknown>, headers = h.headers, key = randomUUID()) { return h.app.inject({ method: 'POST', url: '/api/v1/office' + path, payload, headers: { ...headers, 'idempotency-key': key } }); }
function get(path: string, headers = h.headers) { return h.app.inject({ url: '/api/v1/office' + path, headers }); }
const future = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();
async function relay(extra: Record<string, unknown> = {}, headers = h.headers) {
  const input = { workspaceId: f.workspaceA, recipientId: f.editorA, subject: '虚构口信', body: '仅指定同事可见的演示内容', confidentiality: 'private', channel: 'local', scheduledAt: null, expiresAt: future(1440), ...extra };
  const r = await post('/relays', input, headers); expect(r.statusCode, r.body).toBe(200); return (await get('/relays/' + r.json().data.id, headers)).json().data;
}
async function send(row: { id: string; version: number }, headers = h.headers) { const r = await post('/relays/' + row.id + '/send', { version: row.version, confirmed: true }, headers); expect(r.statusCode, r.body).toBe(200); return r.json().data; }
async function drain() { let n = 0; while (await processOfficeNotification(h.repo, h.config.providerMode, h.config.appEnv)) { if (++n > 100) throw Error('Queue did not settle'); } return n; }
async function meeting(extra: Record<string, unknown> = {}, headers = h.headers) {
  const input = { workspaceId: f.workspaceA, title: '虚构会议', description: '内部演示讨论', location: '演示会议室 A', startsAt: future(60), endsAt: future(90), timezone: 'Asia/Shanghai', attendeeIds: [f.editorA], reminderMinutes: 10, channel: 'local', confirmed: true, ...extra };
  const response = await post('/calendar', input, headers); expect(response.statusCode, response.body).toBe(200); return { row: (await get('/calendar/' + response.json().data.id, headers)).json().data, input };
}
async function inbox(headers = h.headers) { return (await get('/inbox?workspaceId=' + f.workspaceA, headers)).json().data.items; }

describe('T07 员工口信 日历与回执', () => {
  it('草稿须明确确认；一次转达形成持久收件，渠道接受不等于本人确认', async () => {
    const editor = await h.login(f.editorA), row = await relay();
    expect(officeRelaySchema.safeParse(row).success).toBe(true); expect(await inbox(editor)).toHaveLength(0); expect(await drain()).toBe(0);
    await send(row); await send(row); expect(await drain()).toBe(1); expect(await drain()).toBe(0);
    const items = await inbox(editor); expect(items).toHaveLength(1); const n = items[0];
    expect(officeNotificationSchema.safeParse(n).success).toBe(true); expect(n).toMatchObject({ status: 'unread', dispatchStatus: 'local', readAt: null, acknowledgedAt: null }); expect(n.body).toContain('指定同事');
    const read = await post('/notifications/' + n.id + '/control', { version: n.version, action: 'read' }, editor); expect(read.statusCode).toBe(200);
    const readRow = (await inbox(editor))[0]; expect(readRow.status).toBe('read'); expect(readRow.acknowledgedAt).toBeNull();
    await post('/notifications/' + n.id + '/control', { version: readRow.version, action: 'acknowledge' }, editor);
    const sent = (await get('/relays/' + row.id)).json().data; expect(sent.deliveries[0].status).toBe('acknowledged'); expect(sent.deliveries[0].acknowledgedAt).toBeTruthy();
    const reopened = new Repository(h.config.dataDir); try { expect(reopened.get<{ status: string }>('SELECT status FROM office_notifications WHERE id=?', n.id)!.status).toBe('acknowledged'); expect(reopened.get<{ n: number }>('SELECT count(*) AS n FROM office_notifications WHERE source_id=?', row.id)!.n).toBe(1); } finally { reopened.close(); }
  });
  it('公共提示无正文、题目、人员或会议细节，外人和只读写入被拒绝', async () => {
    const editor = await h.login(f.editorA), row = await relay({ subject: '私密题目', body: '私密正文' }); await send(row); await drain();
    const result = await get('/public-notice?workspaceId=' + f.workspaceA, editor);
    expect(result.json().data).toEqual({ hasPending: true, message: '您有待查看消息，请在个人终端登录查看。' }); expect(result.body).not.toMatch(/私密|林知|陈墨/);
    expect((await get('/notifications/' + (await inbox(editor))[0].id)).statusCode).toBe(404);
    expect((await get('/relays/' + row.id, editor)).statusCode).toBe(404);
    const viewer = await h.login(f.viewerA); expect((await post('/relays', { workspaceId: f.workspaceA }, viewer)).statusCode).toBe(403);
    expect((await get('/inbox', { cookie: '', 'x-csrf-token': '' })).statusCode).toBe(401);
    const other = await h.login(f.adminB); expect((await get('/relays/' + row.id, other)).statusCode).toBe(404); expect((await get('/members?workspaceId=' + f.workspaceA, other)).statusCode).toBe(404);
    expect((await post('/relays', { workspaceId: f.workspaceA, senderId: f.editorA })).statusCode).toBe(400);
  });
  it('草稿修改使旧确认无效，跨工作空间收件人不接受', async () => {
    const row = await relay(), input = { version: row.version, recipientId: f.viewerA, subject: '改后标题', body: '改后内容', confidentiality: 'private', channel: 'local', scheduledAt: null, expiresAt: future(1440) };
    expect((await post('/relays/' + row.id + '/edit', input)).statusCode).toBe(200);
    expect((await post('/relays/' + row.id + '/send', { version: row.version, confirmed: true })).json().error.code).toBe('VERSION_CONFLICT');
    const fresh = (await get('/relays/' + row.id)).json().data; await send(fresh); await drain();
    const viewer = await h.login(f.viewerA); expect((await inbox(viewer))[0].body).toBe('改后内容');
    const invalid = await post('/relays', { workspaceId: f.workspacePrivate, recipientId: f.editorA, subject: '越界', body: '无效', expiresAt: future(30) }); expect(invalid.statusCode).toBe(404);
    expect((await post('/relays/' + row.id + '/edit', { ...input, version: fresh.version + 1 })).statusCode).toBe(409);
  });
  it('定时口信到期前不投递，撤回已排期口信不再被执行', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const editor = await h.login(f.editorA), row = await relay({ scheduledAt: future(30) }); await send(row);
    expect(await drain()).toBe(0); expect(await inbox(editor)).toHaveLength(0);
    vi.setSystemTime(Date.now() + 31 * 60000); expect(await drain()).toBe(1); expect((await inbox(editor))[0].body).toContain('指定同事');
    const later = await relay({ scheduledAt: future(30) }); const queued = await send(later);
    await post('/relays/' + later.id + '/cancel', { version: queued.version, confirmed: true }); vi.setSystemTime(Date.now() + 31 * 60000);
    expect(await drain()).toBe(0); expect((await inbox(editor)).some((n: { body: string | null }) => n.body?.includes('已撤回'))).toBe(false);
  });
  it('模拟提交与未知结果保持真实状态，不自动重发；只有收件人能确认', async () => {
    const editor = await h.login(f.editorA), row = await relay({ channel: 'mock' });
    const scenario = await post('/relays/' + row.id + '/scenario', { version: row.version, scenario: 'unknown' }); await send(scenario.json().data); await drain();
    const n = (await inbox(editor))[0]; expect(n.dispatchStatus).toBe('unknown'); expect(n.status).toBe('unread');
    expect(await drain()).toBe(0); expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM office_mock_submissions')!.n).toBe(0);
    expect((await post('/notifications/' + n.id + '/control', { version: n.version, action: 'acknowledge' })).statusCode).toBe(404);
    expect((await post('/notifications/' + n.id + '/control', { version: n.version, action: 'acknowledge' }, editor)).statusCode).toBe(200);
    const final = (await inbox(editor))[0]; expect(final.status).toBe('acknowledged'); expect(final.dispatchStatus).toBe('unknown');
  });
  it('模拟提交后的租约丢失先查已有回执，旧 worker 不能覆盖恢复结果', async () => {
    const row = await relay({ channel: 'mock' }); await send(row);
    let release: () => void = () => {}, sent: () => void = () => {}; const wait = new Promise<void>(resolve => { release = resolve; }), submitted = new Promise<void>(resolve => { sent = resolve; });
    const base = officeProvider(h.repo, 'mock', 'development'), slow: OfficeDeliveryProvider = { ...base, async send(input) { const result = await base.send(input); sent(); await wait; return result; } };
    const old = processOfficeNotification(h.repo, 'mock', 'development', slow); await submitted;
    h.repo.run("UPDATE office_notifications SET lease_until='2000-01-01T00:00:00.000Z' WHERE source_id=?", row.id);
    const reopened = new Repository(h.config.dataDir); try { await processOfficeNotification(reopened, 'mock', 'development'); } finally { reopened.close(); release(); } await old;
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM office_mock_submissions')!.n).toBe(1);
    expect(h.repo.get<{ dispatch_status: string }>('SELECT dispatch_status FROM office_notifications WHERE source_id=?', row.id)!.dispatch_status).toBe('submitted_mock');
  });
  it('已开始的渠道提交在撤回后不能恢复旧正文或产生可读旧提醒', async () => {
    const editor = await h.login(f.editorA), row = await relay({ channel: 'mock' }), queued = await send(row);
    let release: () => void = () => {}, sent: () => void = () => {}; const wait = new Promise<void>(resolve => { release = resolve; }), submitted = new Promise<void>(resolve => { sent = resolve; });
    const base = officeProvider(h.repo, 'mock', 'development'), slow: OfficeDeliveryProvider = { ...base, async send(input) { const result = await base.send(input); sent(); await wait; return result; } };
    const pending = processOfficeNotification(h.repo, 'mock', 'development', slow); await submitted;
    try { expect((await post('/relays/' + row.id + '/cancel', { version: queued.version, confirmed: true })).statusCode).toBe(200); } finally { release(); } await pending;
    const n = (await inbox(editor))[0]; expect(n.status).toBe('withdrawn'); expect(n.body).toBeNull();
    expect((await get('/relays/' + row.id)).json().data.body).toBe('');
    expect((await post('/notifications/' + n.id + '/control', { version: n.version, action: 'acknowledge' }, editor)).statusCode).toBe(409);
  });
  it('收件账号范围撤销后不投递，模拟与真实环境不混用', async () => {
    const row = await relay({ channel: 'mock' }); await send(row);
    expect(await processOfficeNotification(h.repo, 'live', 'development')).toBe(false);
    h.repo.run('UPDATE memberships SET workspace_ids=? WHERE user_id=?', '[]', f.editorA); await drain();
    expect(h.repo.get<{ status: string }>('SELECT status FROM office_notifications WHERE source_id=?', row.id)!.status).toBe('withdrawn');
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM office_mock_submissions')!.n).toBe(0);
  });
  it('会议仅组织者和参与者可见，本人回应不冒充其他同事接受', async () => {
    const editor = await h.login(f.editorA), created = await meeting({ attendeeIds: [f.viewerA] }, editor);
    expect(calendarEventSchema.safeParse(created.row).success).toBe(true);
    expect((await get('/calendar/' + created.row.id)).statusCode).toBe(404);
    const viewer = await h.login(f.viewerA); expect((await get('/calendar/' + created.row.id, viewer)).statusCode).toBe(200);
    expect((await post('/calendar/' + created.row.id + '/cancel', { version: created.row.version, confirmed: true }, viewer)).statusCode).toBe(404);
    await post('/calendar/' + created.row.id + '/respond', { version: created.row.version, response: 'accepted' }, viewer);
    const current = (await get('/calendar/' + created.row.id, editor)).json().data; expect(current.attendees.find((a: { id: string }) => a.id === f.viewerA).response).toBe('accepted');
    expect((await get('/calendar?workspaceId=' + f.workspaceA)).json().data.items).toHaveLength(0);
  });
  it('会议改期撤销旧提醒，内容版本隔离，取消后不再发旧会议提醒', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const editor = await h.login(f.editorA), created = await meeting(); await drain();
    const stale = h.repo.all<OfficeNoticeRow>("SELECT * FROM office_notifications WHERE source_id=? AND kind='reminder'", created.row.id);
    const update = await post('/calendar/' + created.row.id + '/update', { ...created.input, workspaceId: undefined, version: created.row.version, startsAt: future(120), endsAt: future(150), location: '新演示会议室' }); expect(update.statusCode, update.body).toBe(200);
    expect(h.repo.get<{ status: string }>('SELECT status FROM office_notifications WHERE id=?', stale[0].id)!.status).toBe('withdrawn');
    expect((await post('/calendar/' + created.row.id + '/respond', { version: created.row.version, response: 'accepted' }, editor)).statusCode).toBe(409);
    await drain(); vi.setSystemTime(Date.now() + 55 * 60000); expect(await drain()).toBe(0);
    const current = (await get('/calendar/' + created.row.id)).json().data;
    await post('/calendar/' + created.row.id + '/cancel', { version: current.version, confirmed: true }); await drain();
    const incoming = await inbox(editor); expect(incoming.some((n: { kind: string; status: string }) => n.kind === 'cancel' && n.status === 'unread')).toBe(true);
    vi.setSystemTime(Date.now() + 60 * 60000); expect(await drain()).toBe(0);
    expect((await inbox(editor)).filter((n: { kind: string; status: string }) => n.kind === 'reminder' && n.status === 'unread')).toHaveLength(0);
  });
  it('移除参与者后的变更提示不泄露新会议题目，旧详情不再可访问', async () => {
    const editor = await h.login(f.editorA), created = await meeting(); await drain();
    const update = { ...created.input, workspaceId: undefined, version: created.row.version, attendeeIds: [f.viewerA], title: '新参与者专属议题' };
    expect((await post('/calendar/' + created.row.id + '/update', update)).statusCode).toBe(200); await drain();
    expect((await get('/calendar/' + created.row.id, editor)).statusCode).toBe(404);
    const items = await inbox(editor); expect(JSON.stringify(items)).not.toContain('新参与者专属议题'); expect(items.find((n: { kind: string }) => n.kind === 'removed')?.body).toContain('不再属于');
  });
  it('保留期清理正文与旧响应，不在普通审计或队列中复制内容', async () => {
    const row = await relay({ body: '到期清理私密原文' }); await send(row); await drain();
    const created = await meeting({ description: '会议描述到期清理' });
    expect(JSON.stringify(h.repo.all('SELECT * FROM audit_events'))).not.toContain('到期清理私密原文');
    expect(JSON.stringify(h.repo.all('SELECT * FROM outbox_events'))).not.toContain('会议描述到期清理');
    h.repo.run("UPDATE office_relays SET expires_at='2000-01-01T00:00:00.000Z'"); h.repo.run("UPDATE office_calendar_events SET expires_at='2000-01-01T00:00:00.000Z'");
    h.repo.transaction(() => new OfficeService(h.repo, 'mock', 'development').sweep());
    expect((await get('/relays/' + row.id)).json().data).toMatchObject({ status: 'expired', body: '' });
    expect((await get('/calendar/' + created.row.id)).json().data).toMatchObject({ status: 'expired', description: '', location: '' });
  });
  it('同租户并发上限生效，重复排期与提醒只出现一次', async () => {
    const first = await relay({ channel: 'mock' }); await send(first); const second = await relay({ channel: 'mock' }); await send(second);
    let release: () => void = () => {}, sent: () => void = () => {}; const wait = new Promise<void>(resolve => { release = resolve; }), submitted = new Promise<void>(resolve => { sent = resolve; });
    const base = officeProvider(h.repo, 'mock', 'development'), slow: OfficeDeliveryProvider = { ...base, async send(input) { const result = await base.send(input); sent(); await wait; return result; } };
    const job = processOfficeNotification(h.repo, 'mock', 'development', slow); await submitted; expect(await processOfficeNotification(h.repo, 'mock', 'development')).toBe(false); release(); await job; await drain();
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM office_mock_submissions')!.n).toBe(2);
  });
  it('非模拟环境保留真实本地收件箱，拒绝冒用模拟渠道', async () => {
    await h.close(); h = await harness({ providerMode: 'live' });
    const input = { workspaceId: f.workspaceA, recipientId: f.editorA, subject: '本地事务', body: '内部本地收件', channel: 'mock', expiresAt: future(60) };
    expect((await post('/relays', input)).json().error.code).toBe('PROVIDER_NOT_CONFIGURED');
    const row = await relay({ channel: 'local' }); await send(row); await drain();
    expect(h.repo.get<{ dispatch_status: string }>('SELECT dispatch_status FROM office_notifications WHERE source_id=?', row.id)!.dispatch_status).toBe('local');
  });
  it('日期、无效时区、确认与 CSRF 由服务端校验', async () => {
    const created = await meeting();
    const invalid = { ...created.input, timezone: 'Invalid/Zone' }; expect((await post('/calendar', invalid)).statusCode).toBe(400);
    expect((await post('/calendar', { ...created.input, endsAt: created.input.startsAt })).statusCode).toBe(400);
    expect((await post('/calendar', { ...created.input, confirmed: false })).statusCode).toBe(400);
    const row = await relay(); expect((await post('/relays/' + row.id + '/send', { version: row.version, confirmed: true }, { ...h.headers, 'x-csrf-token': 'forged' })).statusCode).toBe(403);
  });
});

