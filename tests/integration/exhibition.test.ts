import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Repository } from '@digitalguide/database';
import type { TourView, TourPlan, Exhibit, ExhibitDevice, TourBooking } from '@digitalguide/contracts';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';
import { ExhibitionDevices } from '../../apps/api/src/exhibition-devices.js';
import { TourService } from '../../apps/api/src/tour-service.js';
import { createApp } from '../../apps/api/src/app.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { vi.useRealTimers(); await h.close(); });
function post(path: string, data: Record<string, unknown>, headers = h.headers, key = randomUUID()) { return h.app.inject({ method: 'POST', url: '/api/v1' + path, payload: data, headers: { ...headers, 'idempotency-key': key } }); }
function get(path: string, headers = h.headers) { return h.app.inject({ url: '/api/v1' + path, headers }); }
async function good(path: string, data: Record<string, unknown>) { const r = await post(path, data); expect([200, 201], r.body).toContain(r.statusCode); return r.json().data; }
async function setup(options: { duration?: number; device?: boolean } = {}) {
  const zoneId = randomUUID(), hall = await good('/exhibitions', { workspaceId: f.workspaceA, name: '合成科技展馆', openingHours: '周二至周日 09:00—17:00，以预约时段为准', zones: [{ id: zoneId, name: '科技展区', floor: '一层' }] });
  const body = (title: string) => ({ sourceName: '已核对的合成手册', sourceUrl: 'https://example.com/source', effectiveFrom: null, effectiveUntil: null, segments: [0, 1].map(n => ({ id: randomUUID(), text: { zh: title + '展示光能转化原理，讲解段' + n, en: title + ' synthetic energy exhibit ' + n }, durationMs: options.duration || 10000, screen: { kind: n === 0 ? 'slide' : 'video', title: title + '展示页' + n, lines: ['合成演示内容，未连接硬件'] } })) });
  const exhibitInput = { hallId: hall.id, code: 'energy', title: '光能装置', zoneId, tags: ['能源'], accessible: true, body: body('光能装置') }, first = await good('/exhibits', exhibitInput) as Exhibit;
  const exhibit = await good('/exhibits/' + first.id + '/publish', { version: first.version, contentVersion: 1, confirmed: true }) as Exhibit;
  const extra = await good('/exhibits', { ...exhibitInput, code: 'history', title: '沿革装置', tags: ['历史'], body: body('沿革装置') }) as Exhibit; await good('/exhibits/' + extra.id + '/publish', { version: extra.version, contentVersion: 1, confirmed: true });
  const routeInput = { hallId: hall.id, name: '科技参观路线', steps: [{ id: randomUUID(), exhibitId: exhibit.id, required: true }, { id: randomUUID(), exhibitId: extra.id, required: false }], enabled: true }, route = await good('/tour-routes', routeInput);
  const profile = await good('/profiles', { workspaceId: f.workspaceA, name: '合成展厅讲解员', avatarAssetId: f.avatarA, scenes: ['exhibition'] }), appInput = { workspaceId: f.workspaceA, profileId: profile.id, name: '公开展厅频道', channelKey: 'hall-' + randomUUID(), scene: 'exhibition', preset: 'exhibition', welcomeText: '欢迎参观' }, app = await good('/scene-apps', appInput);
  const planInput = { version: route.version, language: 'zh', timeBudgetMinutes: 10, interests: [], accessibleOnly: false }, plan = await good('/tour-routes/' + route.id + '/plan', planInput) as TourPlan;
  const device = options.device ? await good('/exhibit-devices', { hallId: hall.id, name: '模拟展屏', provider: 'mock-display', online: true, allowedActions: ['show_slide', 'play_video', 'pause_media', 'blank'] }) as ExhibitDevice : undefined;
  const startInput = { routeId: route.id, sceneAppId: app.id, plan: planInput, planHash: plan.hash, groupSize: 3, ...(device ? { deviceId: device.id, autoDevices: true } : {}) };
  return { hall, zoneId, exhibit, extra, exhibitInput, route, routeInput, app, appInput, plan, planInput, device, startInput };
}
type C = Awaited<ReturnType<typeof setup>> & { tour: TourView; base: string; headers: { cookie: string; 'x-csrf-token': string } };
async function launch(c: Awaited<ReturnType<typeof setup>>): Promise<C> {
  const tour = await good('/tours', c.startInput) as TourView, access = await post('/tours/' + tour.id + '/access', {}); expect(access.statusCode, access.body).toBe(200);
  const cookie = access.headers['set-cookie']!.toString().split(';')[0], base = '/guest/tours/' + tour.id, view = (await get(base, { cookie, 'x-csrf-token': '' })).json().data as TourView;
  return { ...c, tour, base, headers: { cookie, 'x-csrf-token': view.csrfToken! } };
}
async function view(c: C) { const r = await get(c.base, c.headers); expect(r.statusCode, r.body).toBe(200); return r.json().data as TourView; }
async function control(c: C, action: string, extra = {}) { const s = await view(c), r = await post(c.base + '/control', { version: s.version, focusVersion: s.focusVersion, action, ...extra }, c.headers); expect(r.statusCode, r.body).toBe(200); return r.json().data as TourView; }
async function question(c: C, label = '观众甲', text = '光能装置的光能转化原理') { const s = await view(c); return post(c.base + '/questions', { version: s.version, focusVersion: s.focusVersion, audienceLabel: label, text, source: 'typed' }, c.headers); }
function processDevices() { return new ExhibitionDevices(h.repo, 'mock', 'development').process(); }
describe('T27 展馆、版本、路线和团体预约', () => {
  it('展馆展区与来源版本可管理，草稿不进入路线，未授权和跨馆对象被拒绝', async () => {
    const c = await setup(), other = await h.login(f.adminB), viewer = await h.login(f.viewerA);
    expect((await get('/exhibits?hallId=' + c.hall.id, other)).statusCode).toBe(404); expect((await post('/exhibits', c.exhibitInput, viewer)).statusCode).toBe(403);
    const hallB = await good('/exhibitions', { workspaceId: f.workspaceA, name: '同组织另一展馆', openingHours: '预约时段为准', zones: [{ id: randomUUID(), name: '另一个展区', floor: '二层' }] });
    expect((await post('/tour-routes', { ...c.routeInput, hallId: hallB.id })).statusCode).toBe(404);
    const privateHall = await good('/exhibitions', { workspaceId: f.workspacePrivate, name: '受限工作空间展馆', openingHours: '内部预约', zones: [{ id: randomUUID(), name: '展区', floor: '一层' }] }); const editor = await h.login(f.editorA);
    expect((await get('/exhibits?hallId=' + privateHall.id, editor)).statusCode).toBe(404);
    const draft = await good('/exhibits', { ...c.exhibitInput, code: 'draft', title: '尚未发布' }) as Exhibit;
    const route = await good('/tour-routes', { ...c.routeInput, steps: [{ id: randomUUID(), exhibitId: draft.id, required: true }] }); expect((await post('/tour-routes/' + route.id + '/plan', c.planInput)).json().error.code).toBe('CONTENT_NOT_PUBLISHED');
    expect((await post('/exhibitions/' + c.hall.id + '/update', { name: '改名', description: '', openingHours: '9—17', zones: [{ id: randomUUID(), name: '新展区', floor: '二层' }], enabled: true, version: c.hall.version })).statusCode).toBe(409);
  });
  it('时长、兴趣、语言和可达性形成可核对计划，条件变化或讲稿变化使旧计划失效', async () => {
    const c = await setup({ duration: 30000 }), limited = await good('/tour-routes/' + c.route.id + '/plan', { ...c.planInput, timeBudgetMinutes: 1 }) as TourPlan; expect(limited.steps).toHaveLength(1); expect(limited.omitted[0].reason).toBe('time_budget');
    const interested = await good('/tour-routes/' + c.route.id + '/plan', { ...c.planInput, interests: ['能源'] }) as TourPlan; expect(interested.steps).toHaveLength(1); expect(interested.omitted[0].reason).toBe('not_interested');
    expect((await post('/tour-routes/' + c.route.id + '/plan', { ...c.planInput, language: 'ja' })).json().error.code).toBe('LANGUAGE_UNAVAILABLE');
    const next = await good('/exhibits/' + c.exhibit.id + '/update', { ...c.exhibitInput, hallId: undefined, version: c.exhibit.version, accessible: false }); await good('/exhibits/' + c.exhibit.id + '/publish', { version: next.version, contentVersion: 2, confirmed: true });
    expect((await post('/tour-routes/' + c.route.id + '/plan', { ...c.planInput, accessibleOnly: true })).json().error.code).toBe('ROUTE_NOT_ACCESSIBLE'); expect((await post('/tours', c.startInput)).json().error.code).toBe('PLAN_CHANGED');
  });
  it('预约容量、重复提交、重叠时段及取消释放受事务保护，私人团体备注不对只读或访客开放', async () => {
    const c = await setup(), slotInput = { hallId: c.hall.id, startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), capacity: 4 }, slot = await good('/tour-slots', slotInput), input = { slotId: slot.id, groupName: '合成参观团', partySize: 3, language: 'zh', note: '仅工作人员可见的备注' }, key = randomUUID();
    const [a, b] = await Promise.all([post('/tour-bookings', input, h.headers, key), post('/tour-bookings', input, h.headers, key)]); expect(a.json().data.id).toBe(b.json().data.id); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM tour_bookings')!.n).toBe(1);
    expect((await post('/tour-bookings', { ...input, partySize: 2 })).json().error.code).toBe('CAPACITY_EXCEEDED'); expect((await post('/tour-slots', slotInput)).json().error.code).toBe('SLOT_OVERLAP');
    await good('/tour-bookings/' + a.json().data.id + '/control', { version: 1, action: 'cancel', confirmed: true });
    const raced = await Promise.all([post('/tour-bookings', input), post('/tour-bookings', input)]); expect(raced.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const viewer = await h.login(f.viewerA); expect((await get('/tour-bookings?hallId=' + c.hall.id, viewer)).statusCode).toBe(403);
  });
  it('签到团体绑定准确人数语言与场所，完成后保留参观记录且刷新数据库不丢失', async () => {
    const c = await setup(), slot = await good('/tour-slots', { hallId: c.hall.id, startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), capacity: 10 }), booking = await good('/tour-bookings', { slotId: slot.id, groupName: '合成研学团', partySize: 3, language: 'zh', note: '内部备注' }) as TourBooking;
    expect((await post('/tours', { ...c.startInput, bookingId: booking.id })).json().error.code).toBe('BOOKING_NOT_READY'); await good('/tour-bookings/' + booking.id + '/control', { version: 1, action: 'check_in', confirmed: true });
    const otherHall = await good('/exhibitions', { workspaceId: f.workspaceA, name: '另馆团体', openingHours: '时段为准', zones: [{ id: randomUUID(), name: '区域', floor: '一层' }] });
    const otherSlot = await good('/tour-slots', { hallId: otherHall.id, startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), capacity: 10 }), otherBooking = await good('/tour-bookings', { slotId: otherSlot.id, groupName: '另一展馆的团体', partySize: 3, language: 'zh' }); await good('/tour-bookings/' + otherBooking.id + '/control', { version: 1, action: 'check_in', confirmed: true });
    expect((await post('/tours', { ...c.startInput, bookingId: otherBooking.id })).json().error.code).toBe('BOOKING_NOT_READY');
    const running = await launch({ ...c, startInput: { ...c.startInput, bookingId: booking.id } } as typeof c); expect(JSON.stringify(await view(running))).not.toContain('内部备注');
    expect((await post('/tours', { ...c.startInput, bookingId: booking.id })).statusCode).toBe(409); for (let n = 0; n < 4; n++) await control(running, 'next'); expect((await view(running)).status).toBe('completed');
    const reopened = new Repository(h.config.dataDir, h.config.root); try { expect(reopened.get('SELECT status FROM tour_bookings WHERE id=?', booking.id)).toMatchObject({ status: 'completed' }); expect(reopened.get('SELECT status FROM tour_sessions WHERE id=?', running.tour.id)).toMatchObject({ status: 'completed' }); } finally { reopened.close(); }
  });
});
describe('T27 团体断点、问答与受限终端', () => {
  it('可选展品缺少翻译时明确略过，必经展品使用实际英文讲稿且不伪造翻译', async () => {
    const c = await setup(), updated = await good('/exhibits/' + c.extra.id + '/update', { ...c.exhibitInput, hallId: undefined, version: 2, code: 'history', title: '沿革装置', body: { ...c.exhibitInput.body, segments: c.exhibitInput.body.segments.map(s => ({ ...s, id: randomUUID(), text: { zh: '仅中文的沿革讲稿' } })) } });
    await good('/exhibits/' + c.extra.id + '/publish', { version: updated.version, contentVersion: 2, confirmed: true }); const input = { ...c.planInput, language: 'en' }, plan = await good('/tour-routes/' + c.route.id + '/plan', input);
    expect(plan.omitted).toContainEqual({ exhibitId: c.extra.id, reason: 'language_unavailable' });
    const s = await good('/tours', { ...c.startInput, plan: input, planHash: plan.hash }); expect(s.steps).toHaveLength(1); expect(s.steps[0].segments[0].text).toContain('synthetic energy exhibit'); expect(s.steps[0].segments[0].text).not.toContain('讲解段');
  });
  it('重建数据库连接及 API 后保持答疑断点和待执行命令，凭证仍按原作用域验证', async () => {
    const c = await launch(await setup({ device: true })); await control(c, 'seek', { offsetMs: 2750 }); await question(c); const answering = await control(c, 'answer_next');
    const reopened = new Repository(h.config.dataDir, h.config.root), app = await createApp(h.config, reopened);
    try {
      const read = await app.inject({ url: '/api/v1' + c.base, headers: c.headers }); expect(read.statusCode).toBe(200); expect(read.json().data.resumeCursor).toEqual(answering.resumeCursor);
      expect(new ExhibitionDevices(reopened, 'mock', 'development').process()).toBe(1);
      const resumed = await app.inject({ method: 'POST', url: '/api/v1' + c.base + '/control', headers: { ...c.headers, 'idempotency-key': randomUUID() }, payload: { version: answering.version, focusVersion: answering.focusVersion, action: 'finish_answer' } });
      expect(resumed.statusCode, resumed.body).toBe(200); expect(resumed.json().data.cursor).toEqual({ stepIndex: 0, segmentIndex: 0, offsetMs: 2750 }); expect(resumed.json().data.status).toBe('paused');
    } finally { await app.close(); reopened.close(); }
  });
  it('公共知识撤回后已保存答案也立即遮蔽，不通过导览或缓存继续泄漏旧资料', async () => {
    const c = await setup(), col = await good('/knowledge/collections', { workspaceId: f.workspaceA, name: '展厅公共 FAQ', audience: 'public', scenes: ['exhibition'] }), doc = await good('/knowledge/documents', { collectionId: col.id, title: '展厅开放时间', content: '展厅开放时间为九点至十七点，周一闭馆。', sourceLabel: '合成公开资料' });
    const document = (await get('/knowledge/documents/' + doc.id)).json().data; await good('/knowledge/documents/' + doc.id + '/publish', { version: document.version, versionId: document.versions[0].id, confirmed: true }); await good('/scene-apps/' + c.app.id + '/update', { ...c.appInput, workspaceId: undefined, version: 1, collectionIds: [col.id] });
    const running = await launch(c); await question(running, '观众', '展厅开放时间'); const answer = await control(running, 'answer_next'); expect(JSON.stringify(answer.questions)).toContain('周一闭馆');
    await good('/knowledge/documents/' + doc.id + '/withdraw', { version: document.version + 1, confirmed: true }); const redacted = await view(running); expect(JSON.stringify(redacted)).not.toContain('周一闭馆'); expect(redacted.questions[0].answer).toContain('引用资料已撤回');
  });
  it('讲解自动计时跨段，多人提问不覆盖毫秒断点，逐次回答后准确恢复', async () => {
    const c = await launch(await setup()); await control(c, 'seek', { offsetMs: 3500 }); expect((await question(c)).statusCode).toBe(200); expect((await question(c, '观众乙', '沿革装置')).statusCode).toBe(200);
    const answering = await control(c, 'answer_next'); expect(answering.resumeCursor).toEqual({ stepIndex: 0, segmentIndex: 0, offsetMs: 3500 }); expect(answering.questions.find(q => q.status === 'answering')?.answer).toContain('光能转化原理');
    expect((await question(c, '观众丙', '第三问')).statusCode).toBe(200); const before = await view(c); expect(before.resumeCursor).toEqual(answering.resumeCursor);
    expect((await control(c, 'finish_answer')).cursor).toEqual(answering.resumeCursor); expect((await control(c, 'answer_next')).resumeCursor).toEqual(answering.resumeCursor); await control(c, 'finish_answer');
    vi.useFakeTimers({ toFake: ['Date'] }); const t = Date.now(); await control(c, 'play'); vi.setSystemTime(t + 9000); const advanced = await view(c); expect(advanced.cursor).toEqual({ stepIndex: 0, segmentIndex: 1, offsetMs: 2500 });
    const paused = await control(c, 'pause'); vi.setSystemTime(t + 19000); expect((await view(c)).cursor).toEqual(paused.cursor); vi.useRealTimers();
  });
  it('导览凭证不登录、无 CSRF 不写入，音频自称目标和旧 focus 确认均被拒绝', async () => {
    const c = await launch(await setup()), s = await view(c); expect((await get('/me', c.headers)).statusCode).toBe(401);
    expect((await post(c.base + '/control', { version: s.version, focusVersion: 0, action: 'play' }, { cookie: c.headers.cookie, 'x-csrf-token': '' })).statusCode).toBe(403);
    expect((await post(c.base + '/questions', { version: s.version, focusVersion: 0, audienceLabel: '自称目标', text: '不能接纳', source: 'audio', attribution: 'target' }, c.headers)).statusCode).toBe(400);
    const key = randomUUID(), body = { version: s.version, focusVersion: 0, audienceLabel: '观众甲', text: '合成问题', source: 'typed' }; expect((await post(c.base + '/questions', body, c.headers, key)).statusCode).toBe(200); await control(c, 'answer_next'); expect((await post(c.base + '/questions', body, c.headers, key)).statusCode).toBe(409);
    const other = await launch(await setup()); expect((await get(other.base, c.headers)).statusCode).toBe(401); await control(c, 'end'); expect((await get(c.base, c.headers)).statusCode).toBe(401);
  });
  it('人工接管停止自动进度，访客不能自行恢复；工作人员恢复保持断点', async () => {
    const c = await launch(await setup()); await control(c, 'seek', { offsetMs: 4200 }); const human = await control(c, 'handoff'); expect(human.status).toBe('human');
    expect((await post(c.base + '/control', { version: human.version, focusVersion: human.focusVersion, action: 'resume' }, c.headers)).statusCode).toBe(403); expect((await question(c)).statusCode).toBe(409);
    const resumed = await good('/tours/' + c.tour.id + '/control', { version: human.version, focusVersion: human.focusVersion, action: 'resume' }); expect(resumed).toMatchObject({ status: 'paused', cursor: { offsetMs: 4200 } });
  });
  it('讲稿撤回后旧导览及旧幂等响应不再返回内容，旧版普通更新则保持快照一致', async () => {
    const c = await launch(await setup()); await question(c); await control(c, 'answer_next'); await control(c, 'finish_answer');
    const changed = await good('/exhibits/' + c.exhibit.id + '/update', { ...c.exhibitInput, hallId: undefined, version: c.exhibit.version, body: { ...c.exhibitInput.body, segments: c.exhibitInput.body.segments.map(s => ({ ...s, text: { zh: '新版讲稿', en: 'new version' } })) } }); await good('/exhibits/' + c.exhibit.id + '/publish', { version: changed.version, contentVersion: 2, confirmed: true });
    expect(JSON.stringify(await view(c))).toContain('光能转化原理'); const fresh = (await get('/exhibits?hallId=' + c.hall.id)).json().data.find((e: Exhibit) => e.id === c.exhibit.id) as Exhibit;
    await good('/exhibits/' + c.exhibit.id + '/withdraw', { version: fresh.version, contentVersion: 1, confirmed: true }); const stopped = await view(c); expect(stopped.status).toBe('invalidated'); expect(stopped.steps).toEqual([]); expect(stopped.questions).toEqual([]); expect(JSON.stringify(stopped)).not.toContain('光能转化原理');
    expect(h.repo.all<{ response: string }>("SELECT response FROM idempotency WHERE action LIKE '%guest/tours%'").some(r => r.response.includes('光能转化原理'))).toBe(false);
  });
});
describe('T27 设备白名单与执行回执', () => {
  it('模拟展屏真正消费持久化命令并显示同版本讲义/视频状态，重开不重复执行', async () => {
    const c = await launch(await setup({ device: true })); await control(c, 'play'); expect((await view(c)).device?.display).toBeNull(); expect(processDevices()).toBe(1);
    const shown = await view(c); expect(shown.device?.display).toMatchObject({ kind: 'slide', contentVersion: 1, contentId: shown.steps[0].contentId, segmentId: shown.steps[0].segments[0].id, simulated: true }); expect(shown.commands[0].receiptId).toMatch(/^mock-display:/);
    await control(c, 'next'); processDevices(); expect((await view(c)).device?.display?.kind).toBe('video');
    const reopened = new Repository(h.config.dataDir, h.config.root); try { expect(new ExhibitionDevices(reopened, 'mock', 'development').process()).toBe(0); expect(reopened.get<{ n: number }>('SELECT count(*) n FROM exhibit_device_receipts')!.n).toBe(2); } finally { reopened.close(); }
  });
  it('租约与播放版本防止串屏，配置收紧/离线失败不伪造成功，停止仍然可操作', async () => {
    const c = await launch(await setup({ device: true })); expect((await post('/tours', c.startInput)).json().error.code).toBe('DEVICE_IN_USE'); await control(c, 'play'); await control(c, 'next'); processDevices();
    const v = await view(c); expect(v.commands.some(x => x.status === 'cancelled')).toBe(true); expect(v.device?.display?.segmentId).toBe(v.steps[0].segments[1].id);
    await good('/exhibit-devices/' + c.device!.id + '/update', { version: c.device!.version, name: '离线设备', provider: 'mock-display', online: false, allowedActions: ['blank'] }); const paused = await control(c, 'pause'); expect(paused.status).toBe('paused'); expect(paused.commands.some(x => x.status === 'failed')).toBe(true); await control(c, 'end'); processDevices();
    expect(h.repo.get<{ n: number }>("SELECT count(*) n FROM exhibit_device_commands WHERE session_id=? AND status='failed'", c.tour.id)!.n).toBeGreaterThan(0);
  });
  it('失败和未知回执不改变已确认画面、不自动重试，跨馆动作和普通编辑控制被拒绝', async () => {
    const c = await launch(await setup({ device: true })); await control(c, 'play'); processDevices(); const state = (await view(c)).device!.stateVersion;
    for (const fixture of ['failure', 'unknown']) { const s = await view(c); await good('/exhibit-device-commands', { tourId: s.id, version: s.version, focusVersion: s.focusVersion, action: 'show_slide', fixture }); processDevices(); expect((await view(c)).device!.stateVersion).toBe(state); }
    expect(processDevices()).toBe(0); const editor = await h.login(f.editorA), s = await view(c); expect((await post('/exhibit-device-commands', { tourId: s.id, version: s.version, focusVersion: s.focusVersion, action: 'blank' }, editor)).statusCode).toBe(403);
    expect((await post('/exhibit-device-commands', { tourId: s.id, version: s.version, focusVersion: s.focusVersion, action: 'open_door', url: 'https://example.com' })).statusCode).toBe(400);
  });
  it('未接入真实设备不会回退模拟；场景停用、资产撤回或过期会停止导览', async () => {
    const c = await setup(), real = await good('/exhibit-devices', { hallId: c.hall.id, name: '未接入真实展屏', provider: 'external-display', online: true, allowedActions: ['blank', 'show_slide', 'play_video', 'pause_media'] }); expect(real.online).toBe(false);
    expect((await post('/tours', { ...c.startInput, deviceId: real.id, autoDevices: true })).json().error.code).toBe('PROVIDER_NOT_CONFIGURED'); const running = await launch(c);
    await good('/scene-apps/' + c.app.id + '/update', { ...c.appInput, workspaceId: undefined, version: 1, enabled: false }); expect((await view(running)).status).toBe('invalidated');
    const other = await launch(await setup()); h.repo.run("UPDATE tour_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", other.tour.id); h.repo.transaction(() => new TourService(h.repo, 'mock', 'development').sweep()); expect((await get(other.base, other.headers)).statusCode).toBe(401); expect(h.repo.get('SELECT status FROM tour_sessions WHERE id=?', other.tour.id)).toMatchObject({ status: 'invalidated' });
    const assetCase = await launch(await setup()); h.repo.run('UPDATE assets SET archived=1 WHERE id=?', f.avatarA); expect((await view(assetCase)).status).toBe('invalidated');
  });
  it('旧会话的迟到清屏命令不能清空新导览画面，命令重复键不会重复执行', async () => {
    const c = await launch(await setup({ device: true })); await control(c, 'play'); await control(c, 'end'); const next = await launch(c); await control(next, 'play'); processDevices(); expect((await view(next)).device?.display?.sessionId).toBe(next.tour.id);
    const s = await view(next), input = { tourId: s.id, version: s.version, focusVersion: s.focusVersion, action: 'show_slide' }, key = randomUUID(); expect((await post('/exhibit-device-commands', input, h.headers, key)).statusCode).toBe(200); expect((await post('/exhibit-device-commands', input, h.headers, key)).statusCode).toBe(200);
    const before = h.repo.get<{ n: number }>('SELECT count(*) n FROM exhibit_device_receipts')!.n; expect(processDevices()).toBe(1); expect(processDevices()).toBe(0); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM exhibit_device_receipts')!.n).toBe(before + 1);
  });
});
