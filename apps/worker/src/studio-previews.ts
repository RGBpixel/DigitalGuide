import path from 'node:path';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError, requirePermission, requireWorkspace } from '@digitalguide/domain';
import { renderStoryboard } from '../../../packages/media/src/storyboard-preview.js';
import { StudioService, type FrameRow } from '../../api/src/studio-service.js';
import type { PreviewJobRow } from '../../api/src/studio-preview-service.js';
import type { Config } from '../../api/src/config.js';
import { TimelinePreviews } from '../../api/src/timeline-preview-service.js';
import { TimelineVideoFrames } from '../../../packages/media/src/timeline-video-sources.js';
import { ownedFile } from '../../../packages/media/src/files.js';
export async function runStudioPreview(repo: Repository, config: Config) {
  const token = randomUUID(), at = new Date().toISOString(), studio = new StudioService(repo, config.providerMode, config.appEnv, config.dataDir);
  const row = repo.transaction(() => {
    repo.run("UPDATE studio_preview_jobs SET status='failed',error_message='预览恢复次数已用完，请重新审阅并生成。',lease_token=NULL,lease_until=NULL,updated_at=? WHERE environment=? AND app_env=? AND status='rendering' AND lease_until<=? AND attempts>=2", at, config.providerMode, config.appEnv, at);
    const next = repo.get<PreviewJobRow>("SELECT * FROM studio_preview_jobs WHERE environment=? AND app_env=? AND (status='queued' OR (status='rendering' AND lease_until<=? AND attempts<2)) ORDER BY created_at,id LIMIT 1", config.providerMode, config.appEnv, at); if (!next) return null;
    repo.run("UPDATE studio_preview_jobs SET status='rendering',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?", token, new Date(Date.now() + 90000).toISOString(), at, next.id); return next;
  });
  if (!row) return false; const written: string[] = [];
  try {
    const p = repo.principal(row.actor_id); requirePermission(p, 'studio.write'); requireWorkspace(p, row.workspace_id); const project = studio.project(p, row.project_id), plan = studio.plan(p, project, row.project_version);
    if (project.workspace_id !== row.workspace_id || project.tenant_id !== row.tenant_id || !plan.canPreview || plan.hash !== row.plan_hash) throw new AppError('PLAN_CHANGED', '工程或素材已变化，请重新审阅后生成。', 409);
    const doc = JSON.parse(project.document), ids = JSON.parse(row.segment_ids) as string[], outputs: { segmentId: string; hash: string; existing: FrameRow | null; bytes?: Buffer; width: number; height: number }[] = [];
    for (const id of ids) {
      const current = repo.get<PreviewJobRow>('SELECT * FROM studio_preview_jobs WHERE id=?', row.id); if (current?.status !== 'rendering' || current.lease_token !== token) return true;
      const hash = studio.fingerprint(p, project, doc, id), existing = repo.get<FrameRow>('SELECT * FROM studio_preview_frames WHERE project_id=? AND segment_id=? AND fingerprint=?', project.id, id, hash);
      if (existing && existsSync(path.join(config.dataDir, 'objects', existing.storage_key))) outputs.push({ segmentId: id, hash, existing, width: existing.width, height: existing.height });
      else { const files = new TimelinePreviews(repo,config.providerMode,config.appEnv,config.dataDir,config.root).files(p,doc,row.workspace_id),videos = new TimelineVideoFrames(Object.fromEntries(Object.entries(files.videos).map(([id,v]) => [id,{ file: ownedFile(path.join(config.dataDir,'objects'),v.key),specs: v.specs }])),config.root,640,640,15);try { const result = await renderStoryboard(doc,id,reference => studio.image(p,row.workspace_id,reference),videos);outputs.push({ segmentId: id,hash,existing: existing || null,bytes: result.bytes,width: result.width,height: result.height }); } finally { await videos.dispose(); } }
    }
    repo.transaction(() => {
      const current = repo.get<PreviewJobRow>('SELECT * FROM studio_preview_jobs WHERE id=?', row.id); if (current?.status !== 'rendering' || current.lease_token !== token || current.lease_until! <= new Date().toISOString()) return;
      const owner = repo.principal(row.actor_id); requirePermission(owner, 'studio.write'); requireWorkspace(owner, row.workspace_id); const active = studio.project(owner, row.project_id), fresh = studio.plan(owner, active, row.project_version);
      if (!fresh.canPreview || fresh.hash !== row.plan_hash) throw new AppError('PLAN_CHANGED', '生成期间工程或授权已变化，旧预览没有提交，请重新审阅。', 409);
      for (const output of outputs) {
        if (!output.bytes && output.existing) { repo.run("UPDATE studio_preview_frames SET status='ready' WHERE id=?", output.existing.id); continue; }
        const id = output.existing?.id || randomUUID(), key = randomUUID() + '.png', file = path.join(config.dataDir, 'objects', key); writeFileSync(file, output.bytes!, { flag: 'wx' }); written.push(file);
        if (output.existing) repo.run("UPDATE studio_preview_frames SET storage_key=?,status='ready',width=?,height=? WHERE id=?", key, output.width, output.height, id);
        else repo.run("INSERT INTO studio_preview_frames VALUES (?,?,?,?,?,'ready',?,?,?)", id, row.project_id, output.segmentId, output.hash, key, output.width, output.height, new Date().toISOString());
      }
      repo.run("UPDATE studio_preview_jobs SET status='succeeded',error_message=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?", new Date().toISOString(), row.id); repo.event(row.tenant_id, row.workspace_id, row.project_id, 'studio.storyboard_preview_completed', config.providerMode);
    });
  } catch (e) {
    const directory = path.resolve(config.dataDir, 'objects') + path.sep; for (const file of written) if (path.resolve(file).startsWith(directory)) { try { unlinkSync(file); } catch { /* Only newly written, rolled-back previews. */ } }
    repo.transaction(() => { repo.run("UPDATE studio_preview_jobs SET status='failed',error_message=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='rendering' AND lease_token=?", e instanceof AppError ? e.message : '本地分镜预览失败，请检查素材或拆分后重试。', new Date().toISOString(), row.id, token); });
  }
  return true;
}
