import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { AppError, requirePermission, requireWorkspace, type Principal } from '@digitalguide/domain';
import { hostResponseInput, id, listInput, mockNotificationInput, mockReceiptInput, visitConfirmInput, visitDraftInput, visitGuestControlInput, visitManageInput, visitNotifyInput, type GuestVisitView } from '@digitalguide/contracts';
import type { Config } from './config.js';
import type { SessionRow } from './reception-service.js';
import { executeIdempotent } from './idempotency.js';
import { applyNotificationReceipt, signNotificationReceipt } from './notification-receipts.js';
import { VisitService, type VisitRow } from './visit-service.js';

interface GuestHelpers { guest(req: FastifyRequest): SessionRow; guestMutation(req: FastifyRequest, reply: FastifyReply, work: (row: SessionRow) => unknown): FastifyReply }
export function registerVisitRoutes(app: FastifyInstance, repo: Repository, config: Config, helpers: GuestHelpers) {
  const service = new VisitService(repo, config.providerMode, config.appEnv);
  const resourceId = (req: FastifyRequest) => id.parse((req.params as { id: string }).id);
  const send = (req: FastifyRequest, reply: FastifyReply, data: unknown, code = 200) => reply.code(code).send({ data, requestId: req.id });
  const guestActor = (row: SessionRow): Principal => ({ tenantId: row.tenant_id, userId: 'guest:' + row.id, role: 'viewer', workspaceIds: [row.workspace_id] });
  const expire = () => repo.transaction(() => service.sweep());
  function confirmation(row: VisitRow, expiresAt: string) { return createHmac('sha256', config.sessionSecret).update(['visit-confirm', row.id, row.version, row.session_id, row.focus_version, service.hash(row), expiresAt, config.providerMode, config.appEnv].join(':')).digest('base64url'); }
  function guestView(session: SessionRow): GuestVisitView {
    const row = service.bySession(session), expiresAt = new Date(Math.min(Date.now() + 120000, Date.parse(session.expires_at))).toISOString();
    return { visit: row ? service.publicView(row) : null, confirmation: row?.status === 'awaiting_confirmation' && row.focus_version === session.focus_version ? { token: confirmation(row, expiresAt), expiresAt } : null };
  }
  function current(session: SessionRow) { const row = service.bySession(session); if (!row) throw new AppError('NOT_FOUND', '本次接待还没有来访登记，请先填写资料。', 404); return row; }
  function channel(input:object) { if('channel'in input&&input.channel&&input.channel!=='mock')throw new AppError('CAPABILITY_UNAVAILABLE','此服务尚未连接本地接待渠道，请使用明确模拟渠道或联系前台。',409); }
  function active(session: SessionRow) { if (session.status !== 'active') throw new AppError('STATE_CONFLICT', '当前已转人工接待，不能自动提交旧的来访确认或通知。', 409); }
  function staffMutation(req: FastifyRequest, reply: FastifyReply, work: () => unknown, permission: 'visit.manage' | 'visit.respond' = 'visit.manage') {
    requirePermission(req.principal, permission); expire();
    const result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, work);
    return send(req, reply, result.data, result.code);
  }
  app.get('/api/v1/guest/sessions/:id/visit', (req, reply) => { expire(); return send(req, reply, guestView(helpers.guest(req))); });
  app.post('/api/v1/guest/sessions/:id/visit', (req, reply) => helpers.guestMutation(req, reply, session => {
    const input = visitDraftInput.parse(req.body); channel(input);
    const recent = repo.get<{ n: number }>("SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND action='visit.draft_save' AND created_at>?", 'guest:' + session.id, new Date(Date.now() - 300000).toISOString())!.n;
    if (recent >= 8) throw new AppError('RATE_LIMITED', '登记修改过于频繁，请联系前台协助。', 429, true);
    const row = service.saveDraft(session, input); repo.audit(guestActor(session), row.workspace_id, 'visit.draft_save', row.id, req.id); return guestView(session);
  }));
  app.post('/api/v1/guest/sessions/:id/visit/confirm', (req, reply) => helpers.guestMutation(req, reply, session => {
    active(session); const input = visitConfirmInput.parse(req.body), row = current(session); channel(input); service.version(row, input.version); service.focus(row, session, input.focusVersion);
    if (row.status !== 'awaiting_confirmation') throw new AppError('STATE_CONFLICT', '此版本已确认或来访已进入后续处理，请刷新状态。', 409);
    if (Date.parse(input.expiresAt) <= Date.now() || Date.parse(input.expiresAt) > Date.now() + 121000 || Date.parse(input.expiresAt) > Date.parse(session.expires_at)) throw new AppError('CONFIRMATION_EXPIRED', '确认已过期，请重新核对当前内容。', 409);
    const expected = confirmation(row, input.expiresAt);
    if (Buffer.byteLength(input.confirmationToken) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(input.confirmationToken), Buffer.from(expected))) throw new AppError('INVALID_CONFIRMATION', '确认内容不匹配，请重新核对当前来访资料。', 403);
    repo.run('UPDATE visits SET confirmed_hash=?,confirmed_at=?,notice_version=? WHERE id=?', service.hash(row), new Date().toISOString(), input.noticeVersion, row.id);
    repo.run('INSERT INTO visit_confirmation_targets(visit_id,user_id) VALUES (?,?)', row.id, service.host(row)?.user_id || null);
    service.state(row, 'notifying'); repo.run('UPDATE reception_sessions SET activity_at=? WHERE id=?', new Date().toISOString(), session.id);
    repo.audit(guestActor(session), row.workspace_id, 'visit.confirm', row.id, req.id); return guestView(session);
  }));
  app.post('/api/v1/guest/sessions/:id/visit/notify', (req, reply) => helpers.guestMutation(req, reply, session => {
    active(session); const input = visitNotifyInput.parse(req.body), row = current(session); channel(input); service.focus(row, session, input.focusVersion);
    if (row.confirmed_hash !== service.hash(row) || !row.confirmed_at) throw new AppError('CONFIRMATION_REQUIRED', '请先确认当前版本的来访资料。', 409);
    if (row.host_id && service.confirmedRecipient(row) !== service.host(row)?.user_id) throw new AppError('INVALID_CONFIRMATION', '接待人授权快照已变化，请联系前台重新核对登记。', 409);
    if (service.delivery(row.id)) return guestView(session); // business-level deduplication across request keys.
    service.version(row, input.version);
    if (row.status !== 'notifying') throw new AppError('STATE_CONFLICT', '当前状态不能发送通知，请联系前台。', 409);
    if (config.providerMode !== 'mock') throw new AppError('PROVIDER_NOT_CONFIGURED', '真实通知渠道尚未接通，请联系人工前台。', 409);
    const host = service.host(row);
    if (!service.availableHost(host)) service.escalate(row, 'host_unavailable');
    else {
      const dailyLimit = Math.min(100, repo.get<{ daily_limit: number }>('SELECT daily_limit FROM tenants WHERE id=?', row.tenant_id)!.daily_limit);
      if (repo.get<{ n: number }>('SELECT count(*) AS n FROM visit_deliveries WHERE tenant_id=? AND environment=? AND app_env=? AND created_at>=?', row.tenant_id, config.providerMode, config.appEnv, new Date().toISOString().slice(0, 10))!.n >= dailyLimit) throw new AppError('QUOTA_EXCEEDED', '今日通知额度已用完，请由前台人工处理。', 409);
      const deliveryId = randomUUID(), now = new Date().toISOString();
      repo.run('INSERT INTO visit_deliveries(id,visit_id,tenant_id,workspace_id,recipient_user_id,environment,app_env,status,scenario,created_at,updated_at) VALUES (?,?,?,?,?,?,?,\'queued\',?,?,?)', deliveryId, row.id, row.tenant_id, row.workspace_id, host!.user_id, config.providerMode, config.appEnv, row.mock_scenario, now, now);
      repo.run('UPDATE visits SET host_deadline=?,version=version+1,updated_at=? WHERE id=?', new Date(Date.now() + 60000).toISOString(), now, row.id);
      repo.event(row.tenant_id, row.workspace_id, deliveryId, 'notification.queued', config.providerMode);
    }
    repo.audit(guestActor(session), row.workspace_id, 'visit.notify', row.id, req.id); return guestView(session);
  }));
  app.post('/api/v1/guest/sessions/:id/visit/control', (req, reply) => helpers.guestMutation(req, reply, session => {
    const input = visitGuestControlInput.parse(req.body), row = current(session); service.version(row, input.version); service.focus(row, session, input.focusVersion);
    if (['completed', 'cancelled'].includes(row.status)) throw new AppError('STATE_CONFLICT', '本次来访已结束，请勿重复处理。', 409);
    if (input.action === 'complete' && row.status !== 'accepted') throw new AppError('STATE_CONFLICT', '尚未取得接待人同意，不能标记为已完成接待。', 409);
    service.stopQueued(row); service.state(row, input.action === 'complete' ? 'completed' : 'cancelled');
    repo.run('UPDATE visits SET completed_at=? WHERE id=?', new Date().toISOString(), row.id);
    repo.audit(guestActor(session), row.workspace_id, 'visit.' + input.action, row.id, req.id); return guestView(session);
  }));

  for (const ownOnly of [false, true]) app.get(ownOnly ? '/api/v1/visits/inbox' : '/api/v1/visits', (req, reply) => {
    requirePermission(req.principal, ownOnly ? 'visit.respond' : 'visit.manage'); expire(); const q = listInput.parse(req.query), p = req.principal;
    if (q.workspaceId) requireWorkspace(p, q.workspaceId); if (q.cursor) id.parse(q.cursor);
    const workspaces = q.workspaceId ? [q.workspaceId] : p.workspaceIds;
    const rows = workspaces.length ? repo.all<{ id: string }>(`SELECT v.id FROM visits v JOIN reception_sessions s ON s.id=v.session_id LEFT JOIN visit_confirmation_targets target ON target.visit_id=v.id WHERE v.tenant_id=? AND v.workspace_id IN (${workspaces.map(() => '?').join(',')}) AND s.environment=? AND s.app_env=? AND v.id>? ${ownOnly ? "AND target.user_id=? AND v.confirmed_at IS NOT NULL AND v.status NOT IN ('draft','awaiting_confirmation')" : ''} ORDER BY v.id LIMIT ?`, p.tenantId, ...workspaces, config.providerMode, config.appEnv, q.cursor || '', ...(ownOnly ? [p.userId] : []), q.limit + 1) : [];
    return send(req, reply, { items: rows.slice(0, q.limit).map(row => service.internalView(service.scoped(p, row.id, ownOnly), p)), nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null });
  });
  app.post('/api/v1/visits/:id/respond', (req, reply) => staffMutation(req, reply, () => {
    const input = hostResponseInput.parse(req.body), row = service.scoped(req.principal, resourceId(req), true); service.version(row, input.version);
    if (!['waiting_host', 'escalated'].includes(row.status) || !row.confirmed_at || row.confirmed_hash !== service.hash(row) || !service.availableHost(service.host(row))) throw new AppError('STATE_CONFLICT', '当前不能回复此请求，请联系前台核对来访状态或受访人变更。', 409);
    repo.run('UPDATE visits SET responded_by=?,host_private_note=?,guidance_code=?,host_deadline=NULL WHERE id=?', req.principal.userId, input.privateNote, input.decision === 'accepted' ? input.guidanceCode || 'front_desk' : null, row.id);
    service.state(row, input.decision);
    const acknowledgement = repo.run("UPDATE visit_deliveries SET status='acknowledged',version=version+1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE visit_id=? AND status IN ('submitted','delivered','unknown')", new Date().toISOString(), row.id);
    if (acknowledgement.changes) repo.event(row.tenant_id, row.workspace_id, service.delivery(row.id)!.id, 'notification.acknowledged', config.providerMode);
    repo.audit(req.principal, row.workspace_id, 'visit.host_' + input.decision, row.id, req.id); return service.internalView(service.row(row.id), req.principal);
  }, 'visit.respond'));
  app.post('/api/v1/visits/:id/control', (req, reply) => staffMutation(req, reply, () => {
    const input = visitManageInput.parse(req.body), row = service.scoped(req.principal, resourceId(req)); service.version(row, input.version);
    if (['completed', 'cancelled'].includes(row.status)) throw new AppError('STATE_CONFLICT', '本次来访已结束。', 409);
    if (input.action === 'escalate') service.escalate(row, 'manual_front_desk');
    else {
      if (input.action === 'complete' && !['accepted', 'declined', 'escalated'].includes(row.status)) throw new AppError('STATE_CONFLICT', '请先处理接待结论或转人工，再结束记录。', 409);
      service.stopQueued(row); service.state(row, input.action === 'complete' ? 'completed' : 'cancelled');
      repo.run('UPDATE visits SET completed_at=? WHERE id=?', new Date().toISOString(), row.id);
    }
    repo.audit(req.principal, row.workspace_id, 'visit.manage_' + input.action, row.id, req.id); return service.internalView(service.row(row.id), req.principal);
  }));
  app.post('/api/v1/visits/:id/mock-notification', (req, reply) => staffMutation(req, reply, () => {
    if (config.providerMode !== 'mock' || config.appEnv === 'production') throw new AppError('CAPABILITY_UNAVAILABLE', '此操作仅限本地模拟通知测试。', 409);
    const input = mockNotificationInput.parse(req.body), row = service.scoped(req.principal, resourceId(req)); service.version(row, input.version);
    if (service.delivery(row.id) || !['draft', 'awaiting_confirmation', 'notifying'].includes(row.status)) throw new AppError('STATE_CONFLICT', '通知已进入执行或来访已结束，不能修改本次模拟场景。', 409);
    repo.run('UPDATE visits SET mock_scenario=?,version=version+1,updated_at=? WHERE id=?', input.scenario, new Date().toISOString(), row.id);
    repo.audit(req.principal, row.workspace_id, 'notification.mock_scenario', row.id, req.id); return service.internalView(service.row(row.id), req.principal);
  }));
  app.post('/api/v1/visits/:id/mock-receipt', (req, reply) => staffMutation(req, reply, () => {
    const input = mockReceiptInput.parse(req.body), row = service.scoped(req.principal, resourceId(req)), delivery = service.delivery(row.id);
    if (!delivery) throw new AppError('NOT_FOUND', '本次来访没有通知投递记录。', 404);
    if (delivery.version !== input.version) throw new AppError('VERSION_CONFLICT', '通知状态已变化，请刷新后重试。', 409);
    const body = { eventId: randomUUID(), deliveryId: delivery.id, environment: 'mock', schemaVersion: 1, status: input.status, occurredAt: new Date().toISOString() }, timestamp = String(Date.now());
    applyNotificationReceipt(repo, config, body, timestamp, signNotificationReceipt(config, body, timestamp));
    repo.audit(req.principal, row.workspace_id, 'notification.mock_receipt', delivery.id, req.id); return service.internalView(service.row(row.id), req.principal);
  }));
  app.post('/api/v1/webhooks/mock-notification', (req, reply) => send(req, reply, applyNotificationReceipt(repo, config, req.body, req.headers['x-notification-timestamp'], req.headers['x-notification-signature'])));
}
