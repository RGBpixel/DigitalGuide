import fs from 'node:fs';
import type { FastifyInstance,FastifyRequest,FastifyReply } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { id,exportPlanInput,exportCreateInput,exportCancelInput } from '@digitalguide/contracts';
import { AppError,requirePermission } from '@digitalguide/domain';
import { ownedFile } from '../../../packages/media/src/files.js';
import type { Config } from './config.js';
import { StudioExports,type ArtifactRow } from './studio-export-service.js';
import { executeIdempotent } from './idempotency.js';
import path from 'node:path';
export function registerStudioExportRoutes(app: FastifyInstance,repo: Repository,config: Config) {
  const service = new StudioExports(repo,config.providerMode,config.appEnv,config.dataDir,config.root),resource = (req: FastifyRequest) => id.parse((req.params as { id: string }).id),send = (req: FastifyRequest,reply: FastifyReply,data: unknown) => reply.send({ data,requestId: req.id });
  app.post('/api/v1/studio/projects/:id/export-plan',(req,reply) => {
    const input = exportPlanInput.parse(req.body);return send(req,reply,repo.transaction(() => service.plan(req.principal,service.studio.project(req.principal,resource(req)),input)));
  });
  app.post('/api/v1/studio/projects/:id/exports',(req,reply) => {
    requirePermission(req.principal,'studio.write');const input = exportCreateInput.parse(req.body);
    const result = executeIdempotent(repo,req,req.principal.tenantId,req.principal.userId,() => { const project = service.studio.project(req.principal,resource(req)),id = service.create(req.principal,project,input);repo.audit(req.principal,project.workspace_id,'studio.export_created_rights_confirmed',id,req.id);return { id }; });
    return send(req,reply,repo.transaction(() => service.view(req.principal,service.row(req.principal,result.data.id))));
  });
  app.get('/api/v1/studio/projects/:id/exports',(req,reply) => send(req,reply,repo.transaction(() => {
    const project = service.studio.project(req.principal,resource(req));return repo.all<{ id: string }>('SELECT id FROM studio_exports WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30',project.id).map(r => service.view(req.principal,service.row(req.principal,r.id)));
  })));
  app.get('/api/v1/studio/exports/:id',(req,reply) => send(req,reply,repo.transaction(() => service.view(req.principal,service.row(req.principal,resource(req))))));
  app.post('/api/v1/studio/exports/:id/cancel',(req,reply) => {
    requirePermission(req.principal,'studio.write');const input = exportCancelInput.parse(req.body);
    const result = executeIdempotent(repo,req,req.principal.tenantId,req.principal.userId,() => {
      const row = service.row(req.principal,resource(req));service.studio.version({ version: row.project_version },input.version);
      if (!['queued','rendering'].includes(row.status)) throw new AppError('STATE_CONFLICT','导出任务已经结束。',409);
      repo.run("UPDATE studio_exports SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",new Date().toISOString(),row.id);repo.audit(req.principal,row.workspace_id,'studio.export_cancelled',row.id,req.id);return { id: row.id };
    });return send(req,reply,service.view(req.principal,service.row(req.principal,result.data.id)));
  });
  app.get('/api/v1/studio/exports/:id/files/:artifactId',(req,reply) => {
    const row = service.row(req.principal,resource(req));if (row.status !== 'succeeded' || !service.current(req.principal,row)) throw new AppError('EXPORT_UNAVAILABLE','输出尚未完成或来源已变化，请重新审阅生成。',409);
    const artifactId = id.parse((req.params as { artifactId: string }).artifactId),artifact = repo.get<ArtifactRow>('SELECT * FROM studio_export_artifacts WHERE id=? AND export_id=?',artifactId,row.id);
    if (!artifact) throw new AppError('NOT_FOUND','导出文件不存在。',404);
    const file = ownedFile(path.join(config.dataDir,'objects'),artifact.storage_key);if (!fs.existsSync(file) || fs.statSync(file).size !== artifact.size) throw new AppError('EXPORT_FILE_MISSING','导出文件缺失或已变化，请重新生成。',409);
    const size = artifact.size;reply.type(artifact.media_type).header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Accept-Ranges','bytes').header('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(artifact.name).replace(/'/g,'%27'));
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if (!match || (!match[1] && !match[2])) return reply.code(416).header('Content-Range','bytes */'+size).send();
      const start = match[1] ? +match[1] : Math.max(0,size-+match[2]),end = match[1] ? match[2] ? Math.min(size-1,+match[2]) : size-1 : size-1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return reply.code(416).header('Content-Range','bytes */'+size).send();
      return reply.code(206).header('Content-Range',`bytes ${start}-${end}/${size}`).header('Content-Length',end-start+1).send(fs.createReadStream(file,{ start,end }));
    }
    return reply.header('Content-Length',size).send(fs.createReadStream(file));
  });
}
