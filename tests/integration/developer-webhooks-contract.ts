import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixtureIds as F } from '../../packages/test-fixtures/src/seed.js';
import type { StudioProject, ExportPlan, StudioExport } from '../../packages/contracts/src/index.js';
import type { WebhookView, WebhookDeliveryView, WebhookLease } from '../../packages/contracts/src/developer-webhooks.js';
import { webhookBodyHash } from '../../packages/enterprise/src/webhook-signature.js';
import { dispatchFixture, type WebhookFixture, type WebhookHeaders } from './developer-webhooks-fixtures.js';
export function developerWebhooksContract(factory: () => Promise<WebhookFixture>, dialect: 'sqlite' | 'postgres') {
  describe.sequential(dialect + ' Webhook授权、同事务事件与本机签名投递', () => {
    let x: WebhookFixture, admin: WebhookHeaders, viewer: WebhookHeaders, appId: string, subId: string, createBody: object, createKey: string, createReceipt: string;
    async function post(action: string, body: object, headers = admin, key: string = randomUUID()) { return x.app.inject({ method: 'POST', url: '/api/v1/enterprise/webhooks/' + action, headers: { ...headers, 'idempotency-key': key }, payload: body }); }
    async function api<T>(url: string, body: object): Promise<T> { const r = await x.app.inject({ method: 'POST', url: '/api/v1' + url, headers: { ...admin, 'idempotency-key': randomUUID() }, payload: body }); expect(r.statusCode, 'API status for ' + url).toBe(200); return r.json().data as T; }
    async function view() { const r = await x.app.inject({ url: '/api/v1/enterprise/webhooks?workspaceId=' + F.workspaceA, headers: admin }); expect(r.statusCode).toBe(200); return r.json().data as WebhookView; }
    async function refs() { const v = await view(); return { app: v.apps.find(a => a.id === appId)!, sub: v.subscriptions.find(s => s.id === subId)!, destination: v.destinations[0] }; }
    async function input() { const { app, sub } = await refs(); return { workspaceId: F.workspaceA, appId, expectedAppVersion: app.version, subscriptionId: subId, expectedVersion: sub.version, confirmed: true }; }
    async function enqueue() { const r = await post('test', await input()); expect(r.statusCode).toBe(200); return r.json().data.deliveryId as string; }
    async function configure(enabled = true, token?: string) { const { sub, destination } = await refs(); return post('control', { ...await input(), topics: sub.topics, enabled, ...(enabled ? { configurationToken: token ?? destination.configurationToken } : {}) }); }
    async function deliveries(limit = 100, cursor?: string) { const r = await x.app.inject({ url: '/api/v1/enterprise/webhooks/deliveries?workspaceId=' + F.workspaceA + '&subscriptionId=' + subId + '&limit=' + limit + (cursor ? '&cursor=' + cursor : ''), headers: admin }); expect(r.statusCode).toBe(200); return r.json().data as { items: WebhookDeliveryView[]; nextCursor: string | null }; }
    async function delivery(id: string) { return (await deliveries()).items.find(d => d.id === id)!; }
    async function appControl(enabled: boolean, scopes?: string[]) { const { app } = await refs(); return api('/enterprise/developers/control', { workspaceId: F.workspaceA, appId, expectedVersion: app.version, name: app.name, scopes: scopes ?? app.scopes, enabled, confirmed: true }); }
    async function due(id: string) { const d = await delivery(id), wait = Date.parse(d.availableAt) - Date.now(); if (wait > 6000) throw new Error('Unexpected long automatic retry interval'); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait + 40)); }
    async function createProject(name = '合成回调工程', workspaceId = F.workspaceA) { return api<StudioProject>('/studio/projects', { workspaceId, name, purpose: 'video' }); }
    beforeAll(async () => { x = await factory(); admin = await x.login(F.adminA); viewer = await x.login(F.viewerA); }, 180000);
    beforeEach(async () => {
      x.receiver.setMode('accept'); appId = ''; subId = '';
      const name = '合成Webhook应用-' + randomUUID().slice(0, 8), application = await api<{ view: { apps: { id: string; name: string }[] } }>('/enterprise/developers/create', { workspaceId: F.workspaceA, name, scopes: ['projects.read', 'exports.read'], confirmed: true });
      appId = application.view.apps.find(a => a.name === name)!.id;
      const v = await view(), app = v.apps.find(a => a.id === appId)!, destination = v.destinations[0];
      createBody = { workspaceId: F.workspaceA, appId, expectedAppVersion: app.version, destinationId: destination.id, configurationToken: destination.configurationToken, topics: ['projects.changed', 'exports.changed'], confirmed: true }; createKey = randomUUID();
      const r = await post('create', createBody, admin, createKey); expect(r.statusCode).toBe(200); subId = r.json().data.subscriptionId; createReceipt = r.json().data.receiptId;
    }, 30000);
    afterEach(async () => { x?.receiver.release(); x?.registryUnavailable(false); if (appId && subId) await appControl(false); }, 30000);
    afterAll(async () => { await x?.close(); }, 90000);
    it('服务端检查人员权限、CSRF、确认、空间及任意URL，目录仅显示当前空间', async () => {
      expect((await post('test', await input(), viewer)).statusCode).toBe(403);
      expect((await post('test', await input(), { ...admin, 'x-csrf-token': 'invalid' })).statusCode).toBe(403);
      expect((await post('test', { ...await input(), confirmed: false })).statusCode).toBe(400);
      expect((await post('create', { ...createBody, url: x.receiver.url })).statusCode).toBe(400);
      expect((await post('create', { ...createBody, destinationId: x.destinations[1] })).statusCode).toBe(404);
      expect((await post('create', { ...createBody, destinationId: x.destinations[2] })).statusCode).toBe(404);
      expect((await view()).destinations.map(d => d.id)).toEqual([x.destinations[0]]);
    });
    it('幂等创建复用原回执，重复或旧应用修订拒绝，不重复生成订阅', async () => {
      const replay = await post('create', createBody, admin, createKey); expect(replay.statusCode).toBe(200); expect(replay.json().data.receiptId).toBe(createReceipt);
      expect((await post('create', createBody)).statusCode).toBe(409);
      expect((await post('test', { ...await input(), expectedAppVersion: 999 })).statusCode).toBe(409);
      expect((await post('create', { ...createBody, topics: ['projects.changed'] }, admin, createKey)).statusCode).toBe(409);
      expect(Number((await x.query('SELECT count(*) n FROM developer_webhook_subscriptions WHERE app_id=?', appId))[0].n)).toBe(1);
    });
    it('测试事件真实发送原始字节签名，无人员cookie或Bearer，成功回执持久且不重复领取', async () => {
      const id = await enqueue(), before = x.receiver.observations.length; expect((await dispatchFixture(x)).status).toBe('delivered');
      const record = x.receiver.observations[before]; expect(record.authenticated).toBe(true); expect(record.sessionAuthorizationPresent).toBe(false); expect(record.deliveryId).toBe(id);
      const wire = JSON.parse(record.body); expect(wire.applicationId).toBe(appId); expect(wire.subscriptionId).toBe(subId); expect(wire.event.type).toBe('webhook.test');
      expect((await delivery(id)).recentAttempts[0]).toMatchObject({ outcome: 'accepted', httpStatus: 204, scopeWithdrawn: false });
      expect(String((await x.query('SELECT body_sha256 FROM developer_webhook_attempts WHERE delivery_id=?', id))[0].body_sha256)).toBe(record.bodySHA256);
      expect((await dispatchFixture(x)).result).toBe('idle'); expect(x.receiver.observations.length).toBe(before + 1);
    });
    it('真实工程创建与修订按源编号递增，只捕获当前空间元数据，不包含讲稿或其他空间', async () => {
      const p = await createProject(), document = structuredClone(p.document); document.segments[0].text = '合成私人讲稿不得进入Webhook';
      await api('/studio/projects/' + p.id + '/save', { version: p.version, name: p.name, document }); await createProject('合成内部工程', F.workspacePrivate);
      const events = await x.query('SELECT * FROM developer_webhook_events WHERE topic=? AND source_id=? ORDER BY sequence', 'projects.changed', p.id);
      expect(events.map(e => Number(e.sequence))).toEqual([1, 2]);
      for (const event of events) { const body = JSON.parse(String(event.payload)); expect(body.data.id).toBe(p.id); expect(typeof body.data.archived).toBe('boolean'); expect(Object.keys(body.data).sort()).toEqual(['archived', 'createdAt', 'id', 'name', 'purpose', 'updatedAt', 'version']); expect(String(event.payload).includes(document.segments[0].text)).toBe(false); }
      expect((await deliveries()).items.length).toBe(2);
    });
    it('实际排队导出与取消产生状态事件，单纯进度更新不额外发事件', async () => {
      const p = await createProject(), options = { version: p.version, kind: 'video', settings: { preset: 'hd', fps: 24, transparent: false, omitBackground: false, burnSubtitles: false }, startMs: 0, durationMs: 1000 };
      const plan = await api<ExportPlan>('/studio/projects/' + p.id + '/export-plan', options); expect(plan.canExport).toBe(true);
      const exported = await api<StudioExport>('/studio/projects/' + p.id + '/exports', { ...options, planHash: plan.hash, confirmed: true, rightsConfirmed: true });
      if (dialect === 'postgres') await x.sourceQuery("UPDATE studio_exports SET status='rendering',attempts=attempts+1,lease_token=?,lease_until=?,progress=0,updated_at=? WHERE id=?", randomUUID(), new Date(Date.now() + 90000).toISOString(), new Date().toISOString(), exported.id);
      await x.sourceQuery('UPDATE studio_exports SET progress=? WHERE id=?', 0.2, exported.id);
      expect(Number((await x.query('SELECT count(*) n FROM developer_webhook_events WHERE source_id=?', exported.id))[0].n)).toBe(dialect === 'postgres' ? 2 : 1);
      await api('/studio/exports/' + exported.id + '/cancel', { version: exported.version });
      const events = await x.query('SELECT payload FROM developer_webhook_events WHERE source_id=? ORDER BY sequence', exported.id); expect(events.map(e => JSON.parse(String(e.payload)).data.status)).toEqual(dialect === 'postgres' ? ['queued', 'rendering', 'cancelled'] : ['queued', 'cancelled']);
      expect(events.every(e => !Object.keys(JSON.parse(String(e.payload)).data).some(key => ['settings', 'result', 'storageKey', 'document'].includes(key)))).toBe(true);
    });
    it('注入事件写入故障时原工程、源计数、事件及投递一起回滚', async () => {
      const tables = ['studio_projects', 'developer_webhook_sources', 'developer_webhook_events', 'developer_webhook_deliveries'], before = await Promise.all(tables.map(async t => Number((await x.query('SELECT count(*) n FROM ' + t))[0].n)));
      if (dialect === 'sqlite') await x.query("CREATE TRIGGER webhook_fixture_fault BEFORE INSERT ON developer_webhook_events BEGIN SELECT RAISE(ABORT,'synthetic outbox failure');END");
      else { await x.query("CREATE FUNCTION dg_webhook_fixture_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic outbox failure';END;$$"); await x.query('CREATE TRIGGER webhook_fixture_fault BEFORE INSERT ON developer_webhook_events FOR EACH ROW EXECUTE FUNCTION dg_webhook_fixture_fault()'); }
      try { const r = await x.app.inject({ method: 'POST', url: '/api/v1/studio/projects', headers: { ...admin, 'idempotency-key': randomUUID() }, payload: { workspaceId: F.workspaceA, name: '合成应回滚工程', purpose: 'video' } }); expect(r.statusCode).toBeGreaterThanOrEqual(500); expect(r.statusCode).toBeLessThan(600); }
      finally { await x.query('DROP TRIGGER webhook_fixture_fault' + (dialect === 'postgres' ? ' ON developer_webhook_events' : '')); if (dialect === 'postgres') await x.query('DROP FUNCTION dg_webhook_fixture_fault()'); }
      expect(await Promise.all(tables.map(async t => Number((await x.query('SELECT count(*) n FROM ' + t))[0].n)))).toEqual(before);
    });
    it('429自动重试真实等待退避，重用投递编号及完全相同正文', async () => {
      const id = await enqueue(), before = x.receiver.observations.length; x.receiver.setMode('retry'); expect((await dispatchFixture(x)).status).toBe('retrying');
      expect((await dispatchFixture(x)).result).toBe('idle'); await due(id); x.receiver.setMode('accept'); expect((await dispatchFixture(x)).status).toBe('delivered');
      const records = x.receiver.observations.slice(before); expect(records.length).toBe(2); expect(records.every(r => r.deliveryId === id && r.authenticated)).toBe(true); expect(records[0].bodySHA256).toBe(records[1].bodySHA256); expect((await delivery(id)).attempts).toBe(2);
    });
    it('拒绝跟随重定向，人工重试保持同一投递和事件，幂等重试不重复排队', async () => {
      const id = await enqueue(), before = x.receiver.observations.length, redirects = x.receiver.redirectHits; x.receiver.setMode('redirect'); expect((await dispatchFixture(x)).status).toBe('failed'); expect(x.receiver.redirectHits).toBe(redirects);
      expect((await delivery(id)).code).toBe('REDIRECT_BLOCKED'); const body = { ...await input(), deliveryId: id }, key = randomUUID();
      const first = await post('retry', body, admin, key), replay = await post('retry', body, admin, key); expect(first.statusCode).toBe(200); expect(replay.statusCode).toBe(200); expect(replay.json().data.receiptId).toBe(first.json().data.receiptId);
      x.receiver.setMode('accept'); expect((await dispatchFixture(x)).status).toBe('delivered'); expect(x.receiver.observations[before].bodySHA256).toBe(x.receiver.observations[before + 1].bodySHA256);
    });
    it('接收端已处理但连接中断时记录不确定，重试由接收端按投递编号去重', async () => {
      const id = await enqueue(), before = x.receiver.observations.length; x.receiver.setMode('drop'); expect((await dispatchFixture(x)).status).toBe('retrying'); expect((await delivery(id)).recentAttempts[0].outcome).toBe('unknown');
      await due(id); x.receiver.setMode('accept'); expect((await dispatchFixture(x)).status).toBe('delivered'); const records = x.receiver.observations.slice(before);
      expect(records.length).toBe(2); expect(records[0].duplicate).toBe(false); expect(records[1].duplicate).toBe(true); expect(records[0].deliveryId).toBe(id); expect(records[1].bodySHA256).toBe(records[0].bodySHA256);
    });
    it('密钥轮换使旧确认与旧待发送配置失效，重新确认只处理将来的事件', async () => {
      const id = await enqueue(), old = (await refs()).destination.configurationToken, before = x.receiver.observations.length; x.rotate();
      expect((await configure(true, old)).statusCode).toBe(409); expect((await dispatchFixture(x)).status).toBe('blocked'); expect(x.receiver.observations.length).toBe(before); expect((await delivery(id)).code).toBe('CONFIG_CHANGED');
      expect((await configure()).statusCode).toBe(200); expect((await delivery(id)).status).toBe('cancelled'); expect((await dispatchFixture(x)).result).toBe('idle');
      const fresh = await enqueue(); expect((await dispatchFixture(x)).status).toBe('delivered'); expect((await delivery(fresh)).attempts).toBe(1);
    });
    it('领取后发送前停用订阅，阻止HTTP并保留撤回记录', async () => {
      const id = await enqueue(), before = x.receiver.observations.length;
      expect((await dispatchFixture(x, { onClaim: async () => { expect((await configure(false)).statusCode).toBe(200); } })).status).toBe('cancelled');
      expect(x.receiver.observations.length).toBe(before); expect((await delivery(id)).recentAttempts[0]).toMatchObject({ outcome: 'blocked', scopeWithdrawn: true, code: 'SCOPE_WITHDRAWN' });
    });
    it('已发HTTP期间撤回应用，迟到2xx只记真实尝试而不恢复投递成功', async () => {
      const id = await enqueue(), before = x.receiver.observations.length; x.receiver.setMode('hold'); const sending = dispatchFixture(x); await x.receiver.waitForCount(before + 1);
      try { await appControl(false); } finally { x.receiver.release(); }
      expect((await sending).status).toBe('cancelled'); expect((await delivery(id)).recentAttempts[0]).toMatchObject({ outcome: 'accepted', httpStatus: 204, scopeWithdrawn: true });
      await appControl(true); expect((await refs()).sub.enabled).toBe(false); expect((await dispatchFixture(x)).result).toBe('idle');
      const changes = await x.query('SELECT actor_id,origin FROM developer_webhook_changes WHERE subscription_id=? AND action=?', subId, 'policy_disabled'); expect(changes.length).toBe(1); expect(changes[0].actor_id).toBeNull(); expect(changes[0].origin).toBe('application_policy');
    });
    it('同一运行时最多四个有效租约，伪造令牌与矛盾HTTP结果不能写成功回执', async () => {
      for (let i = 0; i < 5; i++) await enqueue(); const leases = await Promise.all(Array.from({ length: 5 }, () => Promise.resolve(x.store.run(x.queue.claim()))));
      expect(leases.filter(Boolean).length).toBe(4); const lease = leases.find(Boolean)!;
      expect((await x.store.run(x.queue.finish({ id: lease.id, leaseToken: randomUUID() }, { outcome: 'accepted', code: 'HTTP_ACCEPTED', httpStatus: 204, retryAfterSeconds: 0 }))).recorded).toBe(false);
      await expect(Promise.resolve().then(() => x.store.run(x.queue.finish(lease, { outcome: 'accepted', code: 'HTTP_ACCEPTED', httpStatus: 500, retryAfterSeconds: 0 })))).rejects.toBeDefined();
      await expect(Promise.resolve().then(() => x.store.run(x.queue.finish(lease, { outcome: 'accepted', code: 'HTTP_ACCEPTED', httpStatus: 204, retryAfterSeconds: 0 })))).rejects.toBeDefined();
      for (const item of leases.filter((value): value is WebhookLease => !!value)) await x.store.run(x.queue.finish(item, { outcome: 'blocked', code: 'CONFIG_REQUIRED', httpStatus: null, retryAfterSeconds: 0 }));
    });
    it('实际二十秒租约到期封存未知尝试，迟到结果不覆盖，重新领取仍复用投递身份', async () => {
      const id = await enqueue(), lease = (await x.store.run(x.queue.claim()))!; expect(lease.id).toBe(id);
      await x.store.run(x.queue.ready(lease, lease.fingerprint, webhookBodyHash('{}')));
      const wait = Date.parse(lease.leaseUntil) - Date.now(); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait + 50));
      expect((await x.store.run(x.queue.finish(lease, { outcome: 'accepted', code: 'HTTP_ACCEPTED', httpStatus: 204, retryAfterSeconds: 0 }))).recorded).toBe(false);
      expect(await x.store.run(x.queue.claim())).toBeNull(); const d = await delivery(id); expect(d.status).toBe('retrying'); expect(d.recentAttempts[0]).toMatchObject({ outcome: 'unknown', code: 'LEASE_EXPIRED' });
      await due(id); expect((await dispatchFixture(x)).status).toBe('delivered'); expect((await delivery(id)).attempts).toBe(2);
      await expect(x.query("UPDATE developer_webhook_attempts SET outcome='accepted' WHERE delivery_id=? AND attempt=1", id)).rejects.toBeDefined();
    }, 40000);
    it('人工重试不重置累计次数，二十次后拒绝且事件与既有回执不可改写', async () => {
      const id = await enqueue(); x.receiver.setMode('reject');
      for (let attempt = 1; attempt <= 20; attempt++) { expect((await dispatchFixture(x)).status).toBe('failed'); expect((await delivery(id)).attempts).toBe(attempt); if (attempt < 20) expect((await post('retry', { ...await input(), deliveryId: id })).statusCode).toBe(200); }
      expect((await post('retry', { ...await input(), deliveryId: id })).statusCode).toBe(409); expect((await delivery(id)).canRetry).toBe(false);
      await expect(x.query('DELETE FROM developer_webhook_events WHERE id=?', (await delivery(id)).eventId)).rejects.toBeDefined();
      await expect(x.query('UPDATE developer_webhook_deliveries SET attempts=0 WHERE id=?', id)).rejects.toBeDefined();
    }, 30000);
    it('配置不可用时仍能查看和停用；分页、登录、待投递及回执经API和队列重开保持', async () => {
      const first = await enqueue(), second = await enqueue(), third = await enqueue(), page = await deliveries(2); expect(page.items.length).toBe(2); expect(page.nextCursor).not.toBeNull();
      const next = await deliveries(2, page.nextCursor!); expect(next.items.length).toBe(1); expect([...page.items, ...next.items].map(d => d.id).sort()).toEqual([first, second, third].sort());
      const before = await x.query('SELECT * FROM developer_webhook_deliveries WHERE subscription_id=? ORDER BY id', subId); await x.restart();
      expect((await view()).subscriptions.some(s => s.id === subId)).toBe(true); expect(await x.query('SELECT * FROM developer_webhook_deliveries WHERE subscription_id=? ORDER BY id', subId)).toEqual(before);
      expect((await dispatchFixture(x)).status).toBe('delivered'); x.registryUnavailable(true); expect(Boolean((await view()).configIssue)).toBe(true); expect((await configure(false)).statusCode).toBe(200);
      const text = JSON.stringify(await Promise.all(['developer_webhook_subscriptions', 'developer_webhook_sources', 'developer_webhook_events', 'developer_webhook_deliveries', 'developer_webhook_attempts', 'developer_webhook_changes', 'idempotency'].map(t => x.query('SELECT * FROM ' + t))));
      expect(x.secrets.some(secret => text.includes(secret))).toBe(false); expect(text.includes(x.receiver.url)).toBe(false);
    });
    if (dialect === 'postgres') it('原生派发函数只允许worker，API不能执行，worker不能读凭证或自行改回执', async () => {
      await expect(x.roleQuery!('api', "SELECT dg_native_webhook_queue('claim',$1::jsonb)", [JSON.stringify({ leaseToken: randomUUID() })])).rejects.toBeDefined();
      await expect(x.roleQuery!('worker', 'SELECT secret_hash FROM developer_credentials LIMIT 1')).rejects.toBeDefined();
      await expect(x.roleQuery!('worker', "UPDATE developer_webhook_attempts SET outcome='accepted'")).rejects.toBeDefined();
      const id = await enqueue(); expect((await dispatchFixture(x)).status).toBe('delivered'); expect((await delivery(id)).status).toBe('delivered');
    });
  });
}
