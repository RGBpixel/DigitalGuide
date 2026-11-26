import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError } from '@digitalguide/domain';
import { visualGrantInput, visualQuestionInput, visualRevokeInput, type GuestSessionView } from '@digitalguide/contracts';
import { selectVisionProvider, type RuntimeAdapters } from '@digitalguide/providers';
import type { Config } from './config.js';
import type { SessionRow } from './reception-service.js';
import { VisionService, visualFrame } from './vision-service.js';
interface Helpers { guest(req: FastifyRequest): SessionRow; expire(): void; view(row: SessionRow): GuestSessionView; mutation(req: FastifyRequest, reply: FastifyReply, work: (row: SessionRow) => unknown): FastifyReply }
export function registerVisionRoutes(app: FastifyInstance, repo: Repository, config: Config, helpers: Helpers, adapters: RuntimeAdapters) {
  const service = new VisionService(repo, config.providerMode, config.appEnv, adapters);
  const send = (req: FastifyRequest, reply: FastifyReply, data: unknown) => reply.send({ data, requestId: req.id });
  app.get('/api/v1/guest/sessions/:id/vision', (req, reply) => { helpers.expire(); return send(req, reply, service.state(helpers.guest(req))); });
  app.post('/api/v1/guest/sessions/:id/vision/grants', (req, reply) => helpers.mutation(req, reply, s => service.issue(s, visualGrantInput.parse(req.body))));
  app.post('/api/v1/guest/sessions/:id/vision/revoke', (req, reply) => helpers.mutation(req, reply, s => { const input = visualRevokeInput.parse(req.body); if (input.focusVersion !== s.focus_version) throw new AppError('VERSION_CONFLICT', '服务对象已变化。', 409); return service.revoke(s, input.grantId, input.grantVersion); }));
  app.post('/api/v1/guest/sessions/:id/vision/questions', async (req, reply) => {
    helpers.expire(); const session = helpers.guest(req), input = visualQuestionInput.parse(req.body), key = z.string().min(8).max(128).parse(req.headers['idempotency-key']);
    service.active(session, input.grantId, input.grantVersion);
    const image = visualFrame(input.frameBase64);
    let requestId: string | undefined;
    try {
      const { request, grant, replay } = repo.transaction(() => service.begin(session, input, key, image)); requestId = request.id;
      if (!replay) {
        const provider = selectVisionProvider(grant.provider_id, config.providerMode, config.appEnv, adapters);
        const result = await service.inspect(request.id, grant, image, input.question, provider);
        helpers.expire(); const current = helpers.guest(req);
        repo.transaction(() => service.complete(current, request, grant, result, { width: image.width, height: image.height }));
      }
      return send(req, reply, helpers.view(helpers.guest(req)));
    } catch (e) {
      if (requestId) { const failedId = requestId; repo.transaction(() => repo.run("UPDATE visual_requests SET status='failed',error_code=?,completed_at=? WHERE id=? AND status='pending'", e instanceof AppError ? e.code : 'VISION_PROVIDER_FAILED', new Date().toISOString(), failedId)); }
      if (e instanceof AppError) throw e;
      throw new AppError('VISION_PROVIDER_FAILED', '视觉服务未能完成本次请求，结果未采用；请重试或请求人工接待。', 502);
    } finally { image.frame.fill(0); input.frameBase64 = ''; (req.body as { frameBase64: string }).frameBase64 = ''; }
  });
}
