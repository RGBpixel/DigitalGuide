import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, requireWorkspace, type Principal } from '@digitalguide/domain';
import { studioPreviewInput, type StudioPreviewJob } from '@digitalguide/contracts';
import { StudioService, type StudioProjectRow } from './studio-service.js';
export interface PreviewJobRow { id: string; project_id: string; tenant_id: string; workspace_id: string; actor_id: string; project_version: number; plan_hash: string; segment_ids: string; status: StudioPreviewJob['status']; attempts: number; lease_token: string | null; lease_until: string | null; error_message: string | null; updated_at: string }
export class StudioPreviews {
  constructor(public repo: Repository, public environment: string, public appEnv: string, public dataDir: string) {}
  row(p: Principal, id: string) { const r = this.repo.get<PreviewJobRow>('SELECT * FROM studio_preview_jobs WHERE id=? AND tenant_id=? AND environment=? AND app_env=?', id, p.tenantId, this.environment, this.appEnv); if (!r) throw new AppError('NOT_FOUND', '分镜预览任务不存在。', 404); requireWorkspace(p, r.workspace_id); return r; }
  view(r: PreviewJobRow): StudioPreviewJob { return { id: r.id, projectId: r.project_id, status: r.status, version: r.project_version, errorMessage: r.error_message, updatedAt: r.updated_at }; }
  create(p: Principal, project: StudioProjectRow, input: z.infer<typeof studioPreviewInput>) {
    const studio = new StudioService(this.repo, this.environment, this.appEnv, this.dataDir), plan = studio.plan(p, project, input.version);
    if (!plan.canPreview || plan.hash !== input.planHash) throw new AppError('PLAN_CHANGED', '工程、素材或专项授权已变化，请重新审阅制作计划。', 409);
    if (new Set(input.segmentIds).size !== input.segmentIds.length || input.segmentIds.some(id => !plan.steps.some(s => s.id === id))) throw new AppError('INVALID_SEGMENT', '所选分镜重复或不属于本工程。', 409);
    if (this.repo.get("SELECT id FROM studio_preview_jobs WHERE project_id=? AND status IN ('queued','rendering')", project.id)) throw new AppError('PREVIEW_IN_PROGRESS', '该工程已有分镜预览正在生成，请等待或取消。', 409);
    const id = randomUUID(), at = new Date().toISOString(); this.repo.run('INSERT INTO studio_preview_jobs(id,project_id,tenant_id,workspace_id,actor_id,project_version,plan_hash,segment_ids,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, project.id, p.tenantId, project.workspace_id, p.userId, project.version, input.planHash, JSON.stringify(input.segmentIds), this.environment, this.appEnv, at, at); this.repo.run('INSERT INTO studio_review_plans VALUES (?,?,?,?,?,?)', randomUUID(), project.id, project.version, input.planHash, p.userId, at); return id;
  }
  cancel(r: PreviewJobRow, version: number) { if (version !== r.project_version) throw new AppError('VERSION_CONFLICT', '预览来源版本不一致，请刷新任务。', 409); if (!['queued', 'rendering'].includes(r.status)) throw new AppError('STATE_CONFLICT', '该预览任务已经结束。', 409); this.repo.run("UPDATE studio_preview_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?", new Date().toISOString(), r.id); }
}
