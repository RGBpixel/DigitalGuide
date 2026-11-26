import path from 'node:path';
import type { FastifyInstance,FastifyRequest,FastifyReply } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { id,listInput,transferCreateInput,transferChunkInput,transferControlInput } from '@digitalguide/contracts';
import { AppError,assertUsableAsset,requirePermission,requireWorkspace } from '@digitalguide/domain';
import type { Config } from './config.js';
import { executeIdempotent } from './idempotency.js';
import { MediaTransfers } from './media-transfer-service.js';
import { privateFile } from './private-file.js';
import { ownedFile } from '../../../packages/media/src/files.js';
import {authenticatedSession} from './auth-check.js';
export function registerMediaTransferRoutes(app: FastifyInstance,repo: Repository,config: Config) {
  const service = new MediaTransfers(repo,config.providerMode,config.appEnv,config.dataDir),resource = (req: FastifyRequest) => id.parse((req.params as { id: string }).id),send = (req: FastifyRequest,reply: FastifyReply,data: unknown) => reply.send({ data,requestId: req.id });
  app.post('/api/v1/studio/transfers',(req,reply) => {
    requirePermission(req.principal,'asset.write');const input = transferCreateInput.parse(req.body);
    const result = executeIdempotent(repo,req,req.principal.tenantId,req.principal.userId,() => { const id = service.create(req.principal,input);repo.audit(req.principal,input.workspaceId,'media.transfer_rights_confirmed',id,req.id);return { id }; });return send(req,reply,service.view(service.row(req.principal,result.data.id)));
  });
  app.get('/api/v1/studio/transfers',(req,reply) => {
    const q = listInput.parse(req.query);if (!q.workspaceId) throw new AppError('WORKSPACE_REQUIRED','请选择上传所在工作空间。');requireWorkspace(req.principal,q.workspaceId);
    const rows = repo.all<{id: string}>('SELECT id FROM media_transfers WHERE tenant_id=? AND workspace_id=? AND actor_id=? AND environment=? AND app_env=? AND id>? ORDER BY id LIMIT ?',req.principal.tenantId,q.workspaceId,req.principal.userId,config.providerMode,config.appEnv,q.cursor || '',q.limit+1);return send(req,reply,{ items: rows.slice(0,q.limit).map(r => service.view(service.row(req.principal,r.id))),nextCursor: rows.length > q.limit ? rows[q.limit-1].id : null });
  });
  app.get('/api/v1/studio/transfers/:id',(req,reply) => send(req,reply,service.view(service.row(req.principal,resource(req)))));
  for (const action of ['parts','finalize','cancel'] as const) app.post('/api/v1/studio/transfers/:id/'+action,(req,reply) => {
    const guard=()=>{const p=authenticatedSession(repo,req,config).principal;requirePermission(p,'asset.write');const row=service.row(p,resource(req));if(row.kind==='package'||row.kind==='recording')requirePermission(p,'studio.write');if(action!=='cancel')service.current(p,row);return{p,row};};
    const {p,row}=guard(),input = action === 'parts' ? transferChunkInput.parse(req.body) : transferControlInput.parse(req.body);
    const result = executeIdempotent(repo,req,p.tenantId,p.userId,() => { const {p:owner,row:fresh}=guard();if (action === 'parts') service.part(fresh,transferChunkInput.parse(input));else if (action === 'finalize') service.finalize(fresh,transferControlInput.parse(input).version);else service.cancel(fresh,transferControlInput.parse(input).version);if (action !== 'parts') repo.audit(owner,row.workspace_id,'media.transfer_'+action,row.id,req.id);return { id: row.id }; });guard();const current = service.row(authenticatedSession(repo,req,config).principal,result.data.id);if (current.status === 'cancelled') service.cleanup(current);return send(req,reply,service.view(current));
  });
  app.get('/api/v1/assets/:id/poster',(req,reply) => { const asset = repo.asset(req.principal,resource(req));assertUsableAsset(asset);const video = repo.get<{poster_key: string}>('SELECT poster_key FROM video_sources WHERE asset_id=?',asset.id);if (!video) throw new AppError('NOT_FOUND','此素材没有视频封面。',404);return privateFile(req,reply,ownedFile(path.join(config.dataDir,'objects'),video.poster_key),'image/png'); });
}
