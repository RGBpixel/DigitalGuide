import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { z } from 'zod';
import { AppError, requirePermission, requireWorkspace } from '@digitalguide/domain';
import { id, speakerStartInput, speakerSampleInput, speakerReacquireInput, speakerReleaseInput, speakerHandoffInput, speakerFallbackInput, speakerPttInput, speakerEventInput, speakerEnrollInput, speakerUseInput, speakerDeleteInput } from '@digitalguide/contracts';
import type { Config } from './config.js';
import { executeIdempotent } from './idempotency.js';
import { SpeakerService } from './speaker-service.js';
import { SpeakerReferences, type SpeakerReferenceRow, type SpeakerUseDescriptor } from './speaker-references.js';
import { ReceptionService, type SessionRow } from './reception-service.js';
interface Helpers { guest(req: FastifyRequest): SessionRow; expire(): void; mutation(req: FastifyRequest, reply: FastifyReply, work: (s: SessionRow) => unknown): FastifyReply; issueAccess(reply: FastifyReply, next: SessionRow, previousId: string): void }
export function registerSpeakerRoutes(app: FastifyInstance, repo: Repository, config: Config, helpers: Helpers) {
  const service = new SpeakerService(repo, config.providerMode, config.appEnv, config.sessionSecret), refs = new SpeakerReferences(repo, config.providerMode, config.appEnv, config.sessionSecret), reception = new ReceptionService(repo, config.providerMode, config.appEnv);
  const send = (req: FastifyRequest, reply: FastifyReply, data: unknown) => reply.send({ data, requestId: req.id });
  const resource = (req: FastifyRequest) => id.parse((req.params as { id: string }).id);
  app.get('/api/v1/guest/sessions/:id/speaker-focus', (req, reply) => { helpers.expire(); return send(req, reply, service.view(helpers.guest(req))); });
  app.post('/api/v1/guest/sessions/:id/speaker-focus', (req, reply) => {
    helpers.expire(); const input = speakerStartInput.parse(req.body), s = helpers.guest(req);
    if (input.mode === 'enrolled') {
      if (repo.get<{ n: number }>("SELECT count(*) n FROM audit_events WHERE actor_id=? AND action='speaker.reference_use_attempted' AND created_at>?", 'guest:' + s.id, new Date(Date.now() - 60000).toISOString())!.n >= 10) throw new AppError('RATE_LIMITED', '参考使用码尝试过于频繁，请稍后重试。', 429);
      repo.transaction(() => repo.audit({ tenantId: s.tenant_id, userId: 'guest:' + s.id, role: 'viewer', workspaceIds: [s.workspace_id] }, s.workspace_id, 'speaker.reference_use_attempted', s.id, req.id));
    }
    return helpers.mutation(req, reply, current => service.start(current, input));
  });
  app.post('/api/v1/guest/sessions/:id/speaker-focus/reference', (req, reply) => helpers.mutation(req, reply, s => { const input = speakerSampleInput.parse(req.body); return service.sample(s, input.version, input.focusVersion, input.fixture); }));
  app.post('/api/v1/guest/sessions/:id/speaker-focus/reacquire', (req, reply) => helpers.mutation(req, reply, s => { const input = speakerReacquireInput.parse(req.body); return service.reacquire(s, input.version, input.focusVersion); }));
  app.post('/api/v1/guest/sessions/:id/speaker-focus/release', (req, reply) => helpers.mutation(req, reply, s => { const input = speakerReleaseInput.parse(req.body); return service.release(s, input.version, input.focusVersion); }));
  app.post('/api/v1/guest/sessions/:id/speaker-focus/fallback', (req, reply) => helpers.mutation(req, reply, s => { const input = speakerFallbackInput.parse(req.body); return service.fallback(s, input.version, input.focusVersion, input.mode); }));
  app.post('/api/v1/guest/sessions/:id/speaker-focus/ptt', (req, reply) => helpers.mutation(req, reply, s => { const input = speakerPttInput.parse(req.body); return service.ptt(s, input.version, input.focusVersion); }));
  app.post('/api/v1/guest/sessions/:id/speaker-focus/handoff', (req, reply) => {
    helpers.expire(); const old = helpers.guest(req), input = speakerHandoffInput.parse(req.body);
    if (old.focus_version !== input.focusVersion) throw new AppError('VERSION_CONFLICT', '服务对象已变化，请重新核对交接。', 409);
    const result = executeIdempotent(repo, req, old.tenant_id, 'guest:' + old.id, () => service.handoff(helpers.guest(req), input.version, input.focusVersion));
    const next = repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=? AND terminal_id=? AND tenant_id=?', result.data.sessionId, old.terminal_id, old.tenant_id)!;
    reception.active(next); helpers.issueAccess(reply, next, old.id); return send(req, reply, result.data);
  });
  app.get('/api/v1/sessions/:id/speaker-focus', (req, reply) => { helpers.expire(); return send(req, reply, service.view(reception.session(req.principal, resource(req)))); });
  app.post('/api/v1/sessions/:id/speaker-focus/reference', (req, reply) => {
    requirePermission(req.principal, 'session.manage'); helpers.expire(); const input = speakerSampleInput.parse(req.body), s = reception.session(req.principal, resource(req));
    if (input.focusVersion !== s.focus_version) throw new AppError('VERSION_CONFLICT', '服务对象已变化，请重新核对参考。', 409);
    const result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, () => { const data = service.sample(s, input.version, input.focusVersion, input.fixture); repo.audit(req.principal, s.workspace_id, 'speaker.reference_sample_confirmed_mock', s.id, req.id); return data; }); return send(req, reply, result.data);
  });
  app.post('/api/v1/sessions/:id/speaker-events', (req, reply) => {
    requirePermission(req.principal, 'session.manage'); helpers.expire(); const input = speakerEventInput.parse(req.body), s = reception.session(req.principal, resource(req));
    if (input.focusVersion !== s.focus_version) return send(req, reply, { accepted: false, interrupted: false, reason: 'stale_focus' });
    const result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, () => { const data = service.event(reception.session(req.principal, resource(req)), input, req.id); repo.audit(req.principal, s.workspace_id, 'speaker.simulator_event_submitted', data.decisionId || s.id, req.id, data.reason); return data; }); return send(req, reply, result.data);
  });
  app.get('/api/v1/speaker-references', (req, reply) => {
    helpers.expire(); const q = z.strictObject({ workspaceId: id }).parse(req.query); requireWorkspace(req.principal, q.workspaceId);
    return send(req, reply, repo.all<SpeakerReferenceRow>("SELECT * FROM speaker_references WHERE tenant_id=? AND workspace_id=? AND owner_user_id=? AND scope='enrolled' AND environment=? AND app_env=? ORDER BY created_at DESC LIMIT 100", req.principal.tenantId, q.workspaceId, req.principal.userId, config.providerMode, config.appEnv).map(r => refs.view(r)));
  });
  app.post('/api/v1/speaker-references', (req, reply) => { helpers.expire(); const input = speakerEnrollInput.parse(req.body), result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, () => refs.enroll(req.principal, input)); return send(req, reply, result.data); });
  app.post('/api/v1/speaker-references/:id/authorize-use', (req, reply) => {
    helpers.expire(); refs.owned(req.principal, resource(req)); const input = speakerUseInput.parse(req.body);
    const result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, () => refs.issue(req.principal, refs.owned(req.principal, resource(req)), input.referenceVersion, input.sessionId, input.focusVersion));
    return send(req, reply, refs.reveal(req.principal, result.data as SpeakerUseDescriptor));
  });
  app.post('/api/v1/speaker-references/:id/delete', (req, reply) => { helpers.expire(); refs.owned(req.principal, resource(req)); const input = speakerDeleteInput.parse(req.body), result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, () => refs.remove(req.principal, refs.owned(req.principal, resource(req)), input.version)); return send(req, reply, result.data); });
}
