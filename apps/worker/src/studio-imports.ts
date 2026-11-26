import path from 'node:path';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, requirePermission, requireWorkspace } from '@digitalguide/domain';
import { studioElement } from '@digitalguide/contracts';
import { inspectMedia } from '@digitalguide/media';
import { runDocumentImport } from '../../../packages/media/src/run-document-import.js';
import type { StudioImportRow } from '../../api/src/studio-import-service.js';
import type { Config } from '../../api/src/config.js';
const pageSchema = z.strictObject({ id: z.uuid(), number: z.int().min(1).max(40), title: z.string().min(1).max(100), text: z.string().max(4000), notes: z.string().max(4000), width: z.int().min(320).max(4096), height: z.int().min(320).max(4096), elements: z.array(studioElement).max(60), referenceMediaId: z.uuid().nullable(), warnings: z.array(z.string().max(500)).max(100) });
export async function runStudioImport(repo: Repository, config: Config) {
  const token = randomUUID(), now = new Date().toISOString();
  const row = repo.transaction(() => {
    repo.run("UPDATE studio_imports SET status='failed',error_code='IMPORT_RETRY_EXHAUSTED',error_message='解析重试已用完，请重新上传拆分后的文档。',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE environment=? AND app_env=? AND status='processing' AND lease_until<=? AND attempts>=2", now, config.providerMode, config.appEnv, now);
    const next = repo.get<StudioImportRow>("SELECT * FROM studio_imports WHERE environment=? AND app_env=? AND (status='queued' OR (status='processing' AND lease_until<=? AND attempts<2)) ORDER BY created_at,id LIMIT 1", config.providerMode, config.appEnv, now); if (!next) return null;
    repo.run("UPDATE studio_imports SET status='processing',attempts=attempts+1,lease_token=?,lease_until=?,version=version+1,updated_at=? WHERE id=?", token, new Date(Date.now() + 90000).toISOString(), now, next.id); return next;
  });
  if (!row) return false;
  const written: string[] = [], abort = new AbortController(), timer = setInterval(() => { const current = repo.get<{ status: string; lease_token: string | null }>('SELECT status,lease_token FROM studio_imports WHERE id=?', row.id); if (current?.status !== 'processing' || current.lease_token !== token) abort.abort(); }, 500);
  try {
    const p = repo.principal(row.actor_id); requirePermission(p, 'studio.write'); requireWorkspace(p, row.workspace_id); if (p.tenantId !== row.tenant_id) throw new AppError('FORBIDDEN', '导入创建人的权限已变化。', 403);
    const result = await runDocumentImport(readFileSync(path.join(config.dataDir, 'objects', row.storage_key)), row.format, config.root, abort.signal), pages = z.array(pageSchema).min(1).max(40).parse(result.pages);
    const ids = new Set(result.media.map(m => z.uuid().parse(m.id))); if (ids.size !== result.media.length || new Set(pages.map(p => p.id)).size !== pages.length) throw new Error('Invalid duplicate conversion IDs');
    if (pages.some(p => (p.referenceMediaId && !ids.has(p.referenceMediaId)) || p.elements.some(e => e.type === 'image' && (!e.importMediaId || !ids.has(e.importMediaId))))) throw new Error('Invalid conversion media reference');
    repo.transaction(() => {
      const current = repo.get<StudioImportRow>('SELECT * FROM studio_imports WHERE id=?', row.id); if (current?.status !== 'processing' || current.lease_token !== token || current.lease_until! <= new Date().toISOString()) return;
      const owner = repo.principal(row.actor_id); requirePermission(owner, 'studio.write'); requireWorkspace(owner, row.workspace_id); if (owner.tenantId !== row.tenant_id) throw new AppError('FORBIDDEN', '导入创建人的权限已变化。', 403);
      for (const media of result.media) {
        const specs = inspectMedia(media.png); if (specs.mediaType !== 'image/png' || specs.specs.width !== media.width || specs.specs.height !== media.height) throw new Error('Invalid conversion image');
        const key = media.id + '.png', file = path.join(config.dataDir, 'objects', key); writeFileSync(file, media.png, { flag: 'wx' }); written.push(file);
        repo.run('INSERT INTO studio_import_media VALUES (?,?,?,?,?,?,?,?,?,?)', media.id, row.id, row.tenant_id, row.workspace_id, key, createHash('sha256').update(media.png).digest('hex'), media.width, media.height, media.kind, new Date().toISOString());
      }
      repo.run("UPDATE studio_imports SET status='review',result=?,error_code=NULL,error_message=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=?", JSON.stringify({ pages, warnings: z.array(z.string().max(500)).max(100).parse(result.warnings) }), new Date().toISOString(), row.id);
      repo.event(row.tenant_id, row.workspace_id, row.id, 'studio.import_review_ready', config.providerMode);
    });
  } catch (e) {
    const directory = path.resolve(config.dataDir, 'objects') + path.sep;
    for (const file of written) if (path.resolve(file).startsWith(directory)) { try { unlinkSync(file); } catch { /* Only files created by this failed conversion are eligible. */ } }
    repo.transaction(() => { repo.run("UPDATE studio_imports SET status='failed',error_code=?,error_message=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND status='processing' AND lease_token=?", e instanceof AppError ? e.code : 'DOCUMENT_IMPORT_FAILED', e instanceof AppError ? e.message : '文档解析失败，请检查文件或拆分后重新上传。', new Date().toISOString(), row.id, token); });
  } finally { clearInterval(timer); }
  return true;
}
