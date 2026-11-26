import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, assertUsableAsset, requirePermission, requireWorkspace, type Principal } from '@digitalguide/domain';
import { selectProvider } from '@digitalguide/providers';
import { studioCloneInput, type StudioClone } from '@digitalguide/contracts';
export interface CloneRow { id: string; tenant_id: string; workspace_id: string; name: string; kind: 'avatar' | 'voice'; asset_id: string; consent_id: string; job_id: string; status: StudioClone['status']; version: number; delete_status: string }
export class StudioClones {
  constructor(public repo: Repository, public environment: string, public appEnv: string) {}
  row(p: Principal, id: string) { const r = this.repo.get<CloneRow>('SELECT * FROM studio_clones WHERE id=? AND tenant_id=? AND environment=? AND app_env=?', id, p.tenantId, this.environment, this.appEnv); if (!r) throw new AppError('NOT_FOUND', '模拟参考不存在或不在当前环境。', 404); requireWorkspace(p, r.workspace_id); return this.synchronize(p, r); }
  source(p: Principal, r: Pick<CloneRow, 'kind' | 'asset_id' | 'consent_id' | 'workspace_id'>) {
    const asset = this.repo.asset(p, r.asset_id); assertUsableAsset(asset);
    if (asset.workspaceId !== r.workspace_id || asset.mediaType !== (r.kind === 'avatar' ? 'image/png' : 'audio/wav')) throw new AppError('INVALID_MEDIA', '模拟参考的素材类型或工作空间不匹配。', 409);
    if (!this.repo.get('SELECT id FROM consents WHERE id=? AND tenant_id=? AND workspace_id=? AND asset_id=? AND purpose=? AND revoked_at IS NULL AND expires_at>?', r.consent_id, p.tenantId, r.workspace_id, r.asset_id, r.kind === 'avatar' ? 'train_avatar' : 'train_voice', new Date().toISOString())) throw new AppError('CONSENT_REQUIRED', '此素材专项授权已撤回或到期，请重新登记授权。', 409);
    return asset;
  }
  synchronize(p: Principal, r: CloneRow) {
    if (r.status === 'revoked') return r;
    let status: StudioClone['status'] = r.status;
    try { this.source(p, r); } catch (e) { if (!(e instanceof AppError)) throw e; status = 'revoked'; }
    const job = this.repo.job(p, r.job_id);
    if (status === 'training') {
      if (job.status === 'succeeded') status = job.result?.simulated === true && job.result?.provider === 'mock-local' ? 'awaiting_review' : 'failed';
      else if (['failed', 'cancelled', 'unknown'].includes(job.status)) status = job.status as 'failed' | 'cancelled' | 'unknown';
    }
    if (status !== r.status) { this.repo.run('UPDATE studio_clones SET status=?,delete_status=?,version=version+1,updated_at=? WHERE id=?', status, status === 'revoked' ? 'completed_mock' : r.delete_status, new Date().toISOString(), r.id); if (status === 'revoked') this.repo.run("UPDATE studio_preview_frames SET status='stale' WHERE project_id IN (SELECT id FROM studio_projects WHERE instr(document,?)>0)", r.id); return this.repo.get<CloneRow>('SELECT * FROM studio_clones WHERE id=?', r.id)!; } return r;
  }
  view(p: Principal, r: CloneRow): StudioClone { const asset = this.repo.asset(p, r.asset_id), job = this.repo.job(p, r.job_id); return { id: r.id, workspaceId: r.workspace_id, name: r.name, kind: r.kind, assetId: r.asset_id, consentId: r.consent_id, jobId: r.job_id, jobStatus: job.status, status: r.status, version: r.version, deleteStatus: r.delete_status, simulated: true, readyForRealService: false, quality: asset.specs, previewUrl: '/api/v1/assets/' + asset.id + '/content', errorMessage: job.errorMessage }; }
  enqueue(p: Principal, input: { workspaceId: string; kind: 'avatar' | 'voice'; assetId: string; consentId: string; simulate: string }) {
    requirePermission(p, 'asset.train'); requirePermission(p, 'job.write'); requireWorkspace(p, input.workspaceId);
    if (this.environment !== 'mock' || this.appEnv === 'production') throw new AppError('PROVIDER_NOT_CONFIGURED', '真实克隆尚未接入，此入口只提供本地模拟流程。', 409);
    const provider = selectProvider(this.environment); this.source(p, { workspace_id: input.workspaceId, kind: input.kind, asset_id: input.assetId, consent_id: input.consentId });
    if ((this.repo.get<{ open_until: string | null }>('SELECT open_until FROM provider_health WHERE tenant_id=? AND provider_id=?', p.tenantId, provider.capabilities.id)?.open_until || '' ) > new Date().toISOString()) throw new AppError('PROVIDER_CIRCUIT_OPEN', '模拟适配器正在冷却，请稍后继续。', 409);
    const used = this.repo.get<{ n: number }>('SELECT count(*) n FROM jobs WHERE tenant_id=? AND environment=? AND created_at>=?', p.tenantId, this.environment, new Date().toISOString().slice(0, 10))!.n, limit = this.repo.get<{ daily_limit: number }>('SELECT daily_limit FROM tenants WHERE id=?', p.tenantId)!.daily_limit;
    if (used >= Math.min(limit, provider.capabilities.limits.dailyJobs)) throw new AppError('QUOTA_EXCEEDED', '今日模拟任务额度已用完，请稍后继续。', 409);
    const id = randomUUID(), at = new Date().toISOString(), payload = { workspaceId: input.workspaceId, kind: 'training.' + input.kind, assetId: input.assetId, consentId: input.consentId, simulate: input.simulate };
    this.repo.run("INSERT INTO jobs(id,tenant_id,workspace_id,actor_id,kind,payload,environment,status,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'queued',?,?,?)", id, p.tenantId, input.workspaceId, p.userId, payload.kind, JSON.stringify(payload), this.environment, at, at, at); this.repo.event(p.tenantId, input.workspaceId, id, 'job.queued', this.environment); return id;
  }
  create(p: Principal, input: z.infer<typeof studioCloneInput>) { const jobId = this.enqueue(p, input), id = randomUUID(), at = new Date().toISOString(); this.repo.run('INSERT INTO studio_clones(id,tenant_id,workspace_id,name,kind,asset_id,consent_id,job_id,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, p.tenantId, input.workspaceId, input.name, input.kind, input.assetId, input.consentId, jobId, this.environment, this.appEnv, at, at); return id; }
  control(p: Principal, r: CloneRow, version: number, action: 'accept' | 'reject' | 'cancel' | 'retry' | 'revoke') {
    if (r.version !== version) throw new AppError('VERSION_CONFLICT', '模拟训练状态已变化，请重新核对。', 409);
    if (action === 'accept' || action === 'reject') { if (r.status !== 'awaiting_review') throw new AppError('STATE_CONFLICT', '只有已完成的模拟任务可以验收或拒绝。', 409); this.source(p, r); this.repo.run('UPDATE studio_clones SET status=?,accepted_at=?,version=version+1,updated_at=? WHERE id=?', action === 'accept' ? 'accepted' : 'rejected', action === 'accept' ? new Date().toISOString() : null, new Date().toISOString(), r.id); }
    else if (action === 'retry') { if (!['failed', 'rejected', 'unknown', 'cancelled'].includes(r.status)) throw new AppError('STATE_CONFLICT', '当前状态不需要新建模拟重试。', 409); const jobId = this.enqueue(p, { workspaceId: r.workspace_id, kind: r.kind, assetId: r.asset_id, consentId: r.consent_id, simulate: 'success' }); this.repo.run("UPDATE studio_clones SET status='training',job_id=?,accepted_at=NULL,version=version+1,updated_at=? WHERE id=?", jobId, new Date().toISOString(), r.id); }
    else if (action === 'cancel') { if (r.status !== 'training') throw new AppError('STATE_CONFLICT', '当前没有可取消的模拟训练。', 409); const job = this.repo.job(p, r.job_id); if (['queued', 'retrying', 'running', 'cancellation_requested'].includes(job.status)) this.repo.run('UPDATE jobs SET status=?,updated_at=? WHERE id=?', ['queued','retrying'].includes(job.status) ? 'cancelled' : 'cancellation_requested', new Date().toISOString(), job.id); this.repo.run("UPDATE studio_clones SET status='cancelled',version=version+1,updated_at=? WHERE id=?", new Date().toISOString(), r.id); }
    else { if (r.status === 'revoked') throw new AppError('STATE_CONFLICT', '此模拟参考已撤销。', 409); this.repo.run("UPDATE studio_clones SET status='revoked',delete_status='completed_mock',version=version+1,updated_at=? WHERE id=?", new Date().toISOString(), r.id); this.repo.run("UPDATE studio_preview_frames SET status='stale' WHERE project_id IN (SELECT id FROM studio_projects WHERE instr(document,?)>0)", r.id); }
    return r.id;
  }
}
