import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { AppError, requirePermission, requireWorkspace } from '@digitalguide/domain';
import { id, listInput, relayCreateInput, relayEditInput, officeConfirmInput, officeScenarioInput, notificationControlInput, calendarCreateInput, calendarUpdateInput, calendarRespondInput } from '@digitalguide/contracts';
import type { Config } from './config.js';
import { executeIdempotent } from './idempotency.js';
import { OfficeService, type RelayRow, type CalendarRow, type OfficeNoticeRow } from './office-service.js';
export function registerOfficeRoutes(app: FastifyInstance, repo: Repository, config: Config) {
  const service = new OfficeService(repo, config.providerMode, config.appEnv);
  const send = (req: FastifyRequest, reply: FastifyReply, data: unknown) => reply.send({ data, requestId: req.id });
  const resourceId = (req: FastifyRequest) => id.parse((req.params as { id: string }).id);
  const sweep = () => repo.transaction(() => service.sweep());
  const meta = (r: { id: string; version: number; status: string }) => ({ id: r.id, version: r.version, status: r.status });
  function mutation(req: FastifyRequest, reply: FastifyReply, work: () => { id: string; workspaceId: string; version: number; status: string }, write = true) {
    if (write) requirePermission(req.principal, 'office.write'); sweep();
    const result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, () => {
      const data = work(); repo.audit(req.principal, data.workspaceId, 'office.' + req.url.split('/').at(-1), data.id, req.id);
      return { id: data.id, version: data.version, status: data.status };
    });
    return send(req, reply, result.data);
  }
  function scope(req: FastifyRequest) {
    const q = listInput.parse(req.query), workspaces = q.workspaceId ? [q.workspaceId] : req.principal.workspaceIds;
    workspaces.forEach(w => requireWorkspace(req.principal, w)); if (q.cursor) id.parse(q.cursor);
    return { q, workspaces, placeholders: workspaces.map(() => '?').join(',') };
  }
  function page<T extends { id: string }>(rows: T[], limit: number) { return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null }; }
  app.get('/api/v1/office/members', (req, reply) => {
    requirePermission(req.principal, 'office.write'); const { q, workspaces } = scope(req);
    const members = repo.all<{ id: string; name: string; workspace_ids: string }>(`SELECT u.id,u.name,m.workspace_ids FROM ${repo.membershipsSql()} m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND u.id>? ORDER BY u.id`, req.principal.tenantId, q.cursor || '').filter(r => workspaces.some(w => (JSON.parse(r.workspace_ids) as string[]).includes(w)));
    return send(req, reply, page(members.map(r => ({ id: r.id, name: r.name })), q.limit));
  });
  app.post('/api/v1/office/relays', (req, reply) => mutation(req, reply, () => { const row = service.createRelay(req.principal, relayCreateInput.parse(req.body)); return { ...meta(row), workspaceId: row.workspace_id }; }));
  app.get('/api/v1/office/relays', (req, reply) => {
    sweep(); const { q, workspaces, placeholders } = scope(req);
    const rows = workspaces.length ? repo.all<RelayRow>(`SELECT * FROM office_relays WHERE tenant_id=? AND sender_user_id=? AND workspace_id IN (${placeholders}) AND environment=? AND app_env=? AND id>? ORDER BY id LIMIT ?`, req.principal.tenantId, req.principal.userId, ...workspaces, config.providerMode, config.appEnv, q.cursor || '', q.limit + 1) : [];
    return send(req, reply, page(rows.map(r => service.relayView(r)), q.limit));
  });
  app.get('/api/v1/office/relays/:id', (req, reply) => { sweep(); return send(req, reply, service.relayView(service.relay(req.principal, resourceId(req)))); });
  for (const action of ['edit', 'send', 'cancel', 'scenario'] as const) app.post('/api/v1/office/relays/:id/' + action, (req, reply) => {
    service.relay(req.principal, resourceId(req)); // Re-check ownership before any cached response.
    return mutation(req, reply, () => {
      const row = service.relay(req.principal, resourceId(req));
      if (action === 'edit') service.editRelay(req.principal, row, { ...relayEditInput.parse(req.body), workspaceId: row.workspace_id });
      else if (action === 'scenario') {
        if (req.principal.role !== 'admin' || config.providerMode !== 'mock' || config.appEnv === 'production') throw new AppError('FORBIDDEN', '模拟异常只由本地演示管理员配置。', 403);
        const input = officeScenarioInput.parse(req.body); service.version(row, input.version);
        if (row.status !== 'draft' || row.channel !== 'mock') throw new AppError('STATE_CONFLICT', '只有尚未确认的模拟渠道草稿可以配置。', 409);
        repo.run('UPDATE office_relays SET scenario=?,version=version+1 WHERE id=?', input.scenario, row.id);
      } else { const input = officeConfirmInput.parse(req.body); if (action === 'send') service.sendRelay(req.principal, row, input.version); else service.cancelRelay(row, input.version); }
      const next = service.relay(req.principal, row.id); return { ...meta(next), workspaceId: row.workspace_id };
    });
  });
  app.get('/api/v1/office/inbox', (req, reply) => {
    sweep(); const { q, workspaces, placeholders } = scope(req);
    const rows = workspaces.length ? repo.all<OfficeNoticeRow>(`SELECT * FROM office_notifications WHERE tenant_id=? AND recipient_user_id=? AND workspace_id IN (${placeholders}) AND environment=? AND app_env=? AND status<>'pending' AND id>? ORDER BY id LIMIT ?`, req.principal.tenantId, req.principal.userId, ...workspaces, config.providerMode, config.appEnv, q.cursor || '', q.limit + 1) : [];
    return send(req, reply, page(rows.map(n => service.noticeView(n)), q.limit));
  });
  app.get('/api/v1/office/notifications/:id', (req, reply) => { sweep(); return send(req, reply, service.noticeView(service.notice(req.principal, resourceId(req)))); });
  app.post('/api/v1/office/notifications/:id/control', (req, reply) => {
    service.notice(req.principal, resourceId(req));
    return mutation(req, reply, () => {
      const row = service.notice(req.principal, resourceId(req)), input = notificationControlInput.parse(req.body); service.version(row, input.version);
      if (!['unread', 'read', 'acknowledged'].includes(row.status) || !service.source(row)) throw new AppError('STATE_CONFLICT', '提醒已撤销或到期，不能确认旧内容。', 409);
      const status = input.action === 'acknowledge' ? 'acknowledged' : row.status === 'acknowledged' ? 'acknowledged' : 'read';
      repo.run('UPDATE office_notifications SET status=?,read_at=COALESCE(read_at,?),acknowledged_at=CASE WHEN ?=\'acknowledged\' THEN COALESCE(acknowledged_at,?) ELSE acknowledged_at END,version=version+1,updated_at=? WHERE id=?', status, new Date().toISOString(), status, new Date().toISOString(), new Date().toISOString(), row.id);
      const next = service.notice(req.principal, row.id); return { ...meta(next), workspaceId: row.workspace_id };
    }, false);
  });
  app.get('/api/v1/office/public-notice', (req, reply) => {
    sweep(); const { workspaces, placeholders } = scope(req);
    const rows = workspaces.length ? repo.all<OfficeNoticeRow>(`SELECT * FROM office_notifications WHERE tenant_id=? AND recipient_user_id=? AND workspace_id IN (${placeholders}) AND environment=? AND app_env=? AND status='unread'`, req.principal.tenantId, req.principal.userId, ...workspaces, config.providerMode, config.appEnv) : [];
    const hasPending = rows.some(n => !!service.source(n));
    return send(req, reply, { hasPending, message: hasPending ? '您有待查看消息，请在个人终端登录查看。' : null });
  });
  app.post('/api/v1/office/calendar', (req, reply) => mutation(req, reply, () => { const row = service.createEvent(req.principal, calendarCreateInput.parse(req.body)); return { ...meta(row), workspaceId: row.workspace_id }; }));
  app.get('/api/v1/office/calendar', (req, reply) => {
    sweep(); const { q, workspaces, placeholders } = scope(req);
    const rows = workspaces.length ? repo.all<CalendarRow>(`SELECT e.* FROM office_calendar_events e WHERE e.tenant_id=? AND e.workspace_id IN (${placeholders}) AND e.environment=? AND e.app_env=? AND e.id>? AND (e.organizer_user_id=? OR EXISTS (SELECT 1 FROM office_event_attendees a WHERE a.event_id=e.id AND a.user_id=?)) ORDER BY e.id LIMIT ?`, req.principal.tenantId, ...workspaces, config.providerMode, config.appEnv, q.cursor || '', req.principal.userId, req.principal.userId, q.limit + 1) : [];
    return send(req, reply, page(rows.map(r => service.eventView(r)), q.limit));
  });
  app.get('/api/v1/office/calendar/:id', (req, reply) => { sweep(); return send(req, reply, service.eventView(service.event(req.principal, resourceId(req)))); });
  for (const action of ['update', 'cancel', 'respond'] as const) app.post('/api/v1/office/calendar/:id/' + action, (req, reply) => {
    service.event(req.principal, resourceId(req), action !== 'respond');
    return mutation(req, reply, () => {
      const row = service.event(req.principal, resourceId(req), action !== 'respond');
      if (action === 'update') service.updateEvent(req.principal, row, { ...calendarUpdateInput.parse(req.body), workspaceId: row.workspace_id });
      else if (action === 'cancel') service.cancelEvent(row, officeConfirmInput.parse(req.body).version);
      else {
        const input = calendarRespondInput.parse(req.body); service.version(row, input.version);
        if (row.status !== 'scheduled' || row.ends_at <= new Date().toISOString()) throw new AppError('STATE_CONFLICT', '会议已取消或结束，不能回应旧邀请。', 409);
        repo.run('UPDATE office_event_attendees SET response=?,response_at=? WHERE event_id=? AND user_id=?', input.response, new Date().toISOString(), row.id, req.principal.userId);
        repo.run('UPDATE office_calendar_events SET version=version+1 WHERE id=?', row.id);
      }
      const next = service.event(req.principal, row.id); return { ...meta(next), workspaceId: row.workspace_id };
    }, action !== 'respond');
  });
}

