import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { AppError, requirePermission, requireWorkspace, type Principal } from '@digitalguide/domain';
import { id, listInput, personEnrollInput, personSettingsInput, memoryProposeInput, memoryDecisionInput, memoryNoteInput, memoryNoteControlInput, memoryEraseInput, memoryGreetingInput, recoveryIssueInput, memoryRestoreInput, type RecoveryDescriptor } from '@digitalguide/contracts';
import type { Config } from './config.js';
import type { SessionRow } from './reception-service.js';
import { executeIdempotent } from './idempotency.js';
import { MemoryService, type PersonRow } from './memory-service.js';
import { MemoryRecoveryService } from './memory-recovery.js';

interface GuestHelpers { guest(req: FastifyRequest): SessionRow; guestMutation(req: FastifyRequest, reply: FastifyReply, work: (row: SessionRow) => unknown, project?: (data: unknown) => unknown): FastifyReply }
export function registerPeopleRoutes(app: FastifyInstance, repo: Repository, config: Config, helpers: GuestHelpers) {
  const service = new MemoryService(repo, config.providerMode, config.appEnv);
  const recovery = new MemoryRecoveryService(repo, config.providerMode, config.appEnv, config.sessionSecret);
  const send = (req: FastifyRequest, reply: FastifyReply, data: unknown) => reply.send({ data, requestId: req.id });
  const sweep = () => repo.transaction(() => service.sweep());
  const resourceId = (req: FastifyRequest) => id.parse((req.params as { id: string }).id);
  const actor = (session: SessionRow): Principal => ({ userId: 'guest:' + session.id, tenantId: session.tenant_id, role: 'viewer', workspaceIds: [session.workspace_id] });
  const workspace = (req: FastifyRequest) => { const q = z.object({ workspaceId: id }).parse(req.query); requireWorkspace(req.principal, q.workspaceId); return q.workspaceId; };
  function focus(session: SessionRow, input: { focusVersion?: number }) {
    if (session.status !== 'active' || input.focusVersion !== session.focus_version) throw new AppError('VERSION_CONFLICT', '当前服务对象已变化或已转人工，请重新核对会话，不能使用旧资料。', 409);
  }
  app.get('/api/v1/people/self', (req, reply) => { sweep(); return send(req, reply, service.view(service.self(req.principal, workspace(req)))); });
  app.post('/api/v1/people/self', (req, reply) => {
    sweep(); const input = personEnrollInput.parse(req.body), workspaceId = id.parse(input.workspaceId);
    requireWorkspace(req.principal, workspaceId);
    const value = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, () => {
      if (service.self(req.principal, workspaceId)) throw new AppError('STATE_CONFLICT', '您在此工作空间已有资料，请修改已有资料。', 409);
      const person = service.enroll(input, { ...req.principal, workspaceIds: [workspaceId] });
      repo.audit(req.principal, workspaceId, 'person.enroll_self', person.id, req.id); return service.view(person);
    });
    return send(req, reply, value.data);
  });
  app.get('/api/v1/people', (req, reply) => {
    requirePermission(req.principal, 'people.directory'); sweep(); const q = listInput.parse(req.query);
    const workspaces = q.workspaceId ? [q.workspaceId] : req.principal.workspaceIds;
    workspaces.forEach(w => requireWorkspace(req.principal, w)); if (q.cursor) id.parse(q.cursor);
    const rows = workspaces.length ? repo.all<PersonRow>(`SELECT * FROM people WHERE tenant_id=? AND workspace_id IN (${workspaces.map(() => '?').join(',')}) AND environment=? AND app_env=? AND status='active' AND id>? ORDER BY id LIMIT ?`, req.principal.tenantId, ...workspaces, config.providerMode, config.appEnv, q.cursor || '', q.limit + 1) : [];
    return send(req, reply, { items: rows.slice(0, q.limit).map(row => ({ id: row.id, workspaceId: row.workspace_id, displayName: row.display_name, roles: JSON.parse(row.roles), identity: row.identity_kind, expiresAt: row.expires_at })), nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null });
  });
  app.post('/api/v1/guest/sessions/:id/memory', (req, reply) => {
    sweep(); return helpers.guestMutation(req, reply, session => {
      const input = personEnrollInput.parse(req.body); focus(session, input);
      if (input.workspaceId && input.workspaceId !== session.workspace_id) throw new AppError('NOT_FOUND', '资料范围不属于当前会话。', 404);
      const person = service.enroll(input, actor(session), session);
      repo.audit(actor(session), session.workspace_id, 'person.enroll_guest', person.id, req.id); return service.view(person);
    });
  });
  app.post('/api/v1/guest/sessions/:id/memory/recovery', (req, reply) => {
    sweep();
    return helpers.guestMutation(req, reply, session => {
      const input = recoveryIssueInput.parse(req.body); focus(session, input);
      const data = recovery.issue(session, input.version); repo.audit(actor(session), session.workspace_id, 'memory.recovery_issue', data.personId, req.id); return data;
    }, data => recovery.reveal(helpers.guest(req), data as RecoveryDescriptor));
  });
  app.post('/api/v1/guest/sessions/:id/memory/recovery/revoke', (req, reply) => {
    sweep(); return helpers.guestMutation(req, reply, session => {
      const input = recoveryIssueInput.parse(req.body); focus(session, input); const person = recovery.own(session); service.version(person, input.version);
      recovery.revoke(person); repo.audit(actor(session), session.workspace_id, 'memory.recovery_revoke', person.id, req.id); return { personId: person.id, revoked: true };
    });
  });
  app.post('/api/v1/guest/sessions/:id/memory/restore', (req, reply) => {
    sweep(); const session = helpers.guest(req), input = memoryRestoreInput.parse(req.body); focus(session, input);
    const attempts = repo.get<{ n: number }>("SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND action='memory.restore_attempt' AND created_at>?", actor(session).userId, new Date(Date.now() - 60000).toISOString())!.n;
    if (attempts >= 10) throw new AppError('RATE_LIMITED', '恢复尝试过于频繁，请稍后再试或联系工作人员。', 429, true);
    repo.transaction(() => repo.audit(actor(session), session.workspace_id, 'memory.restore_attempt', session.id, req.id));
    return helpers.guestMutation(req, reply, current => recovery.restore(current, input.recoveryCode));
  });
  for (const guestMode of [false, true]) {
    const base = guestMode ? '/api/v1/guest/sessions/:id/memory' : '/api/v1/people/:id';
    function context(req: FastifyRequest) {
      if (!guestMode) return { row: service.owned(req.principal, resourceId(req)), p: req.principal, session: undefined };
      const session = helpers.guest(req), row = service.guest(session);
      if (!row) throw new AppError('NOT_FOUND', '本次服务对象没有登记资料，请先确认用途；旧服务对象资料不可继续访问。', 404);
      return { row, session, p: actor(session) };
    }
    app.get(base, (req, reply) => {
      sweep();
      if (guestMode) { const session = helpers.guest(req); return send(req, reply, service.view(service.guest(session))); }
      return send(req, reply, service.view(context(req).row));
    });
    app.get(base + '/search', (req, reply) => {
      sweep(); const { row } = context(req), query = z.object({ q: z.string().max(100).default('') }).parse(req.query);
      return send(req, reply, { personId: row.id, items: service.lookup(row, query.q) });
    });
    app.get(base + '/export', (req, reply) => {
      sweep(); const { row, p } = context(req);
      repo.transaction(() => repo.audit(p, row.workspace_id, 'person.export', row.id, req.id));
      return send(req, reply, service.export(row));
    });
    function mutation(req: FastifyRequest, reply: FastifyReply, work: (row: PersonRow, session?: SessionRow) => unknown) {
      sweep(); const c = context(req); // Object ownership is rechecked even when a request key is replayed.
      const apply = (session = c.session) => {
        const row = guestMode ? service.active(service.guest(session!)) : service.owned(c.p, c.row.id);
        const input = z.object({ focusVersion: z.int().nonnegative().optional() }).parse(req.body); if (session) focus(session, input);
        const data = work(row, session); repo.audit(c.p, row.workspace_id, 'memory.' + req.url.split('/').at(-1), row.id, req.id); return data;
      };
      if (guestMode) return helpers.guestMutation(req, reply, session => apply(session));
      return send(req, reply, executeIdempotent(repo, req, c.p.tenantId, c.p.userId, () => apply()).data);
    }
    app.post(base + '/settings', (req, reply) => mutation(req, reply, row => { service.settings(row, personSettingsInput.parse(req.body)); return service.view(row); }));
    app.post(base + '/facts', (req, reply) => mutation(req, reply, (row, session) => { service.propose(row, memoryProposeInput.parse(req.body), session); return service.view(row); }));
    app.post(base + '/facts/decide', (req, reply) => mutation(req, reply, row => { service.decide(row, memoryDecisionInput.parse(req.body)); return service.view(row); }));
    app.post(base + '/notes', (req, reply) => mutation(req, reply, (row, session) => { service.note(row, memoryNoteInput.parse(req.body), session); return service.view(row); }));
    app.post(base + '/notes/control', (req, reply) => mutation(req, reply, row => { service.noteControl(row, memoryNoteControlInput.parse(req.body)); return service.view(row); }));
    app.post(base + '/greet', (req, reply) => mutation(req, reply, row => { const input = memoryGreetingInput.parse(req.body); service.version(row, input.version); return { personId: row.id, ...service.greet(row) }; }));
    app.post(base + '/erase', (req, reply) => mutation(req, reply, row => { const input = memoryEraseInput.parse(req.body); service.version(row, input.version); return service.erase(row); }));
  }
}

