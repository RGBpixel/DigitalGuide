import { randomUUID } from 'node:crypto';
import { AppError, canonical, type Principal } from '../../domain/src/index.js';
import { webhookViewSchema, webhookDeliveryPageSchema, type WebhookMutation, type WebhookView, type webhookListInput } from '../../contracts/src/developer-webhooks.js';
import type { z } from 'zod';
import type { IdentityRow, IdentityWorkflow } from './identity-workflows.js';
import type { DeveloperWorkflows } from './developer-workflows.js';
import { developerCredentialHash } from './developer-credentials.js';
import { WebhookRuntime } from './webhook-runtime.js';
function* q(sql: string, args: unknown[] = [], postgresSql?: string): IdentityWorkflow<IdentityRow[]> { return (yield { kind: 'query', sql, args, ...(postgresSql ? { postgresSql } : {}) }) as IdentityRow[]; }
function* now(): IdentityWorkflow<string> { return (yield { kind: 'now' }) as string; }
const n = (v: unknown) => Number(v);
const includesTopics = (app: IdentityRow, topics: string[]) => topics.every(topic => (JSON.parse(String(app.scopes)) as string[]).includes(topic === 'projects.changed' ? 'projects.read' : 'exports.read'));
export class WebhookWorkflows {
  constructor(readonly developer: DeveloperWorkflows, readonly runtime: WebhookRuntime) {}
  scope(tenant: string, workspace: string) { return this.developer.scope(tenant, workspace); }
  *subscription(p: Principal, workspaceId: string, id: string): IdentityWorkflow<IdentityRow> {
    const sql = 'SELECT * FROM developer_webhook_subscriptions WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? AND id=?';
    const row = (yield* q(sql, [...this.scope(p.tenantId, workspaceId), id], sql + ' FOR UPDATE'))[0];
    if (!row) throw new AppError('NOT_FOUND', '回调订阅不存在或不属于当前空间。', 404); return row;
  }
  *view(p: Principal, workspaceId: string): IdentityWorkflow<WebhookView> {
    const access = yield* this.developer.access(p, workspaceId), catalog = this.runtime.catalog(p.tenantId, workspaceId), destinations = new Map(catalog.entries.map(d => [d.id, d]));
    const apps = yield* q('SELECT id,name,version,enabled,scopes FROM developer_apps WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? ORDER BY id LIMIT 51', this.scope(p.tenantId, workspaceId));
    const subscriptions = yield* q('SELECT * FROM developer_webhook_subscriptions WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? ORDER BY id LIMIT 1001', this.scope(p.tenantId, workspaceId));
    if (apps.length > 50 || subscriptions.length > 1000) throw new AppError('WEBHOOK_LIMIT', '当前空间的回调配置超过可管理范围，请联系管理员。', 409);
    const changes = yield* q('SELECT id,subscription_id,action,revision,created_at FROM developer_webhook_changes WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? ORDER BY created_at DESC,id DESC LIMIT 20', this.scope(p.tenantId, workspaceId));
    return webhookViewSchema.parse({ tenantId: p.tenantId, workspaceId, environment: this.developer.host.providerMode, appEnv: this.developer.host.appEnv, canManageOrganization: access.canManage, configIssue: catalog.issue, dispatcher: 'separate_process', externalDispatchRequiresExplicitFlag: true,
      apps: apps.map(a => ({ id: a.id, name: a.name, version: n(a.version), enabled: n(a.enabled) === 1, scopes: JSON.parse(String(a.scopes)) })), destinations: catalog.entries.map(d => ({ id: d.id, name: d.name, mode: d.mode, configurationToken: d.configurationToken })),
      subscriptions: subscriptions.map(s => { const d = destinations.get(String(s.destination_id)); return { id: s.id, appId: s.app_id, destinationId: s.destination_id, destinationName: d?.name ?? '未配置接收端', mode: d?.mode ?? null, topics: JSON.parse(String(s.topics)), enabled: n(s.enabled) === 1, version: n(s.version), configurationCurrent: !!d && d.fingerprint === s.fingerprint, createdAt: s.created_at, updatedAt: s.updated_at }; }), recentChanges: changes.map(e => ({ id: e.id, subscriptionId: e.subscription_id, action: e.action, revision: n(e.revision), createdAt: e.created_at })) });
  }
  *deliveries(p: Principal, input: z.infer<typeof webhookListInput>): IdentityWorkflow<z.infer<typeof webhookDeliveryPageSchema>> {
    yield* this.developer.access(p, input.workspaceId); const args = this.scope(p.tenantId, input.workspaceId); let where = 'd.tenant_id=? AND d.workspace_id=? AND d.environment=? AND d.app_env=?';
    if (input.subscriptionId) { where += ' AND d.subscription_id=?'; args.push(input.subscriptionId); }
    if (input.cursor) { const old = (yield* q('SELECT created_at FROM developer_webhook_deliveries d WHERE ' + where + ' AND id=?', [...args, input.cursor]))[0]; if (!old) throw new AppError('WEBHOOK_CURSOR_INVALID', '投递分页位置已失效，请从最新记录重新读取。', 409); where += ' AND (d.created_at<? OR(d.created_at=? AND d.id<?))'; args.push(String(old.created_at), String(old.created_at), input.cursor); }
    const rows = yield* q('SELECT d.*,e.topic,e.sequence,s.enabled subscription_enabled,s.version subscription_version,s.fingerprint subscription_fingerprint,s.destination_id,s.topics,a.enabled app_enabled,a.scopes FROM developer_webhook_deliveries d JOIN developer_webhook_events e ON e.id=d.event_id JOIN developer_webhook_subscriptions s ON s.id=d.subscription_id JOIN developer_apps a ON a.id=s.app_id WHERE ' + where + ' ORDER BY d.created_at DESC,d.id DESC LIMIT ?', [...args, input.limit + 1]);
    const items = [];
    for (const row of rows.slice(0, input.limit)) {
      let current = false; try { const d = this.runtime.current(String(row.destination_id)); current = d.fingerprint === row.fingerprint; } catch { /* Missing private configuration remains visible as a retry prerequisite. */ }
      const attempts = yield* q('SELECT attempt,outcome,error_code,http_status,started_at,finished_at,scope_withdrawn FROM developer_webhook_attempts WHERE delivery_id=? ORDER BY attempt DESC LIMIT 20', [row.id]);
      items.push({ id: row.id, subscriptionId: row.subscription_id, eventId: row.event_id, type: row.topic, sequence: n(row.sequence), status: row.status, attempts: n(row.attempts), maxAttempts: n(row.max_attempts), availableAt: row.available_at, code: row.last_code, httpStatus: row.http_status === null ? null : n(row.http_status), createdAt: row.created_at, updatedAt: row.updated_at,
        canRetry: current && ['failed', 'unknown', 'blocked'].includes(String(row.status)) && n(row.attempts) < 20 && n(row.app_enabled) === 1 && n(row.subscription_enabled) === 1 && n(row.subscription_version) === n(row.generation) && row.subscription_fingerprint === row.fingerprint && (row.topic === 'webhook.test' || includesTopics(row, [String(row.topic)])), recentAttempts: attempts.map(a => ({ attempt: n(a.attempt), outcome: a.outcome, code: a.error_code, httpStatus: a.http_status === null ? null : n(a.http_status), startedAt: a.started_at, finishedAt: a.finished_at, scopeWithdrawn: n(a.scope_withdrawn) === 1 })) });
    }
    return webhookDeliveryPageSchema.parse({ items, nextCursor: rows.length > input.limit ? String(rows[input.limit - 1].id) : null });
  }
  *mutation(p: Principal, mutation: WebhookMutation, key: string): IdentityWorkflow<{ receiptId: string; subscriptionId: string; deliveryId?: string; view: WebhookView }> {
    const input = mutation.input, access = yield* this.developer.access(p, input.workspaceId, true), action = 'POST /api/v1/enterprise/webhooks/' + mutation.action;
    const requestHash = developerCredentialHash('webhook-request', canonical(input)), existing = (yield* q('SELECT request_hash,response,redacted FROM idempotency WHERE tenant_id=? AND actor_id=? AND action=? AND key=?', [p.tenantId, p.userId, action, key]))[0];
    let result: { receiptId: string; subscriptionId: string; deliveryId?: string };
    if (existing) { if (existing.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '同一回调操作编号的内容已变化，请重新操作。', 409); if (n(existing.redacted)) throw new AppError('DATA_REMOVED', '旧回调操作内容已清理，请刷新。', 409); result = JSON.parse(String(existing.response)); }
    else { result = yield* this.change(access.principal, mutation); yield* q('INSERT INTO idempotency(tenant_id,actor_id,action,key,request_hash,response,status_code,created_at) VALUES(?,?,?,?,?,?,?,?)', [p.tenantId, p.userId, action, key, requestHash, JSON.stringify(result), 200, yield* now()]); }
    return { ...result, view: yield* this.view(access.principal, input.workspaceId) };
  }
  *change(p: Principal, mutation: WebhookMutation): IdentityWorkflow<{ receiptId: string; subscriptionId: string; deliveryId?: string }> {
    const input = mutation.input, app = yield* this.developer.app(p, input.workspaceId, input.appId), at = yield* now();
    if (n(app.version) !== input.expectedAppVersion) throw new AppError('WEBHOOK_APP_CHANGED', '应用授权已变化，请刷新后重新核对。', 409);
    let subscriptionId: string, revision = 1, deliveryId: string | undefined, change: string;
    if (mutation.action === 'create') {
      const destination = this.runtime.current(mutation.input.destinationId);
      if (destination.tenantId !== p.tenantId || destination.workspaceId !== input.workspaceId) throw new AppError('NOT_FOUND', '当前空间没有该接收端。', 404);
      if (n(app.enabled) !== 1 || !includesTopics(app, mutation.input.topics)) throw new AppError('WEBHOOK_SCOPE_REQUIRED', '应用未启用或未获得所选事件的读取范围。', 403);
      if (destination.configurationToken !== mutation.input.configurationToken) throw new AppError('WEBHOOK_CONFIGURATION_CHANGED', '接收地址或签名配置已变化，请刷新并重新确认。', 409);
      const count = (yield* q('SELECT count(*) n FROM developer_webhook_subscriptions WHERE app_id=?', [app.id]))[0]; if (n(count.n) >= 20) throw new AppError('WEBHOOK_LIMIT', '每个应用最多20个接收端订阅，请复用现有订阅。', 409);
      if ((yield* q('SELECT id FROM developer_webhook_subscriptions WHERE app_id=? AND destination_id=?', [app.id, destination.id])).length) throw new AppError('WEBHOOK_ALREADY_EXISTS', '此应用已有该接收端，请配置现有订阅。', 409);
      subscriptionId = randomUUID(); change = 'created';
      yield* q('INSERT INTO developer_webhook_subscriptions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [subscriptionId, app.id, ...this.scope(p.tenantId, input.workspaceId), destination.id, destination.fingerprint, canonical([...mutation.input.topics].sort()), 1, 1, p.userId, at, at]);
    } else {
      subscriptionId = mutation.input.subscriptionId; const sub = yield* this.subscription(p, input.workspaceId, subscriptionId);
      if (sub.app_id !== app.id) throw new AppError('NOT_FOUND', '该应用没有此订阅。', 404);
      revision = n(sub.version); if (revision !== mutation.input.expectedVersion) throw new AppError('WEBHOOK_VERSION_CHANGED', '回调订阅已被更新，请刷新并重新确认。', 409);
      if (mutation.action === 'control') {
        if (revision >= 1_000_000_000) throw new AppError('WEBHOOK_VERSION_LIMIT', '订阅修订已达上限，请创建新接收端。', 409);
        let fingerprint = String(sub.fingerprint);
        if (mutation.input.enabled) { const destination = this.runtime.current(String(sub.destination_id)); if (destination.tenantId !== p.tenantId || destination.workspaceId !== input.workspaceId) throw new AppError('NOT_FOUND', '当前空间没有该接收端。', 404); if (destination.configurationToken !== mutation.input.configurationToken) throw new AppError('WEBHOOK_CONFIGURATION_CHANGED', '接收地址或签名配置已变化，请刷新并重新确认。', 409); if (n(app.enabled) !== 1 || !includesTopics(app, mutation.input.topics)) throw new AppError('WEBHOOK_SCOPE_REQUIRED', '应用未启用或未获得所选事件的读取范围。', 403); fingerprint = destination.fingerprint; }
        revision++; change = 'configured'; yield* q('UPDATE developer_webhook_subscriptions SET topics=?,enabled=?,version=?,fingerprint=?,updated_at=? WHERE id=?', [canonical([...mutation.input.topics].sort()), mutation.input.enabled ? 1 : 0, revision, fingerprint, at, sub.id]);
      } else {
        const destination = this.runtime.current(String(sub.destination_id));
        if (n(app.enabled) !== 1 || n(sub.enabled) !== 1 || !includesTopics(app, JSON.parse(String(sub.topics))) || destination.fingerprint !== sub.fingerprint || destination.tenantId !== p.tenantId || destination.workspaceId !== input.workspaceId) throw new AppError('WEBHOOK_CONFIGURATION_CHANGED', '当前订阅的授权或接收配置已变化，请先重新确认订阅。', 409);
        if (mutation.action === 'test') { change = 'test_queued'; deliveryId = yield* this.testEvent(p, sub, at); }
        else {
          if (!mutation.input.deliveryId) throw new AppError('WEBHOOK_DELIVERY_REQUIRED', '请选择需要重试的投递记录。', 400);
          const sql = 'SELECT * FROM developer_webhook_deliveries WHERE id=? AND subscription_id=?', delivery = (yield* q(sql, [mutation.input.deliveryId, sub.id], sql + ' FOR UPDATE'))[0];
          if (!delivery || !['failed', 'unknown', 'blocked'].includes(String(delivery.status)) || n(delivery.generation) !== revision || delivery.fingerprint !== sub.fingerprint || n(delivery.attempts) >= 20) throw new AppError('WEBHOOK_RETRY_UNAVAILABLE', '此记录不能重试；请核对状态、当前订阅和配置。', 409);
          deliveryId = String(delivery.id); change = 'retry_queued'; yield* q("UPDATE developer_webhook_deliveries SET status='retrying',max_attempts=?,available_at=?,updated_at=? WHERE id=?", [Math.min(20, n(delivery.attempts) + 5), at, at, deliveryId]);
        }
      }
    }
    const receiptId = randomUUID(); yield* q('INSERT INTO developer_webhook_changes VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [receiptId, ...this.scope(p.tenantId, input.workspaceId), p.userId, 'administrator', subscriptionId, change, revision, deliveryId ?? null, at]); return { receiptId, subscriptionId, ...(deliveryId ? { deliveryId } : {}) };
  }
  *testEvent(p: Principal, sub: IdentityRow, at: string): IdentityWorkflow<string> {
    const eventId = randomUUID(), deliveryId = randomUUID();
    yield* q("INSERT INTO developer_webhook_sources VALUES('webhook.test',?,?,?,?,?,1,?) ON CONFLICT(topic,source_id) DO UPDATE SET sequence=developer_webhook_sources.sequence+1,last_event_id=excluded.last_event_id", [sub.id, ...this.scope(p.tenantId, String(sub.workspace_id)), eventId]);
    const sequence = n((yield* q("SELECT sequence FROM developer_webhook_sources WHERE topic='webhook.test' AND source_id=?", [sub.id]))[0].sequence);
    const event = { version: 1, id: eventId, type: 'webhook.test', occurredAt: at, sequence, tenantId: p.tenantId, workspaceId: sub.workspace_id, environment: this.developer.host.providerMode, appEnv: this.developer.host.appEnv, data: { subscriptionId: sub.id, message: 'DigitalGuide Webhook connection test' } };
    yield* q('INSERT INTO developer_webhook_events VALUES(?,?,?,?,?,?,?,?,?,?,?)', [eventId, ...this.scope(p.tenantId, String(sub.workspace_id)), 'webhook.test', sub.id, sequence, canonical(event), at, 1]);
    yield* q("INSERT INTO developer_webhook_deliveries(id,subscription_id,event_id,tenant_id,workspace_id,environment,app_env,generation,fingerprint,status,attempts,max_attempts,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'queued',0,5,?,?,?)", [deliveryId, sub.id, eventId, ...this.scope(p.tenantId, String(sub.workspace_id)), sub.version, sub.fingerprint, at, at, at]); return deliveryId;
  }
}
