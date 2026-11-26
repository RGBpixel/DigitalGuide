import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, requireWorkspace, type Principal } from '@digitalguide/domain';
import { studioImportInput, type StudioImport, type StudioImportPage } from '@digitalguide/contracts';
export interface StudioImportRow { id: string; tenant_id: string; workspace_id: string; actor_id: string; name: string; file_name: string; format: 'pdf' | 'pptx'; storage_key: string; status: StudioImport['status']; version: number; result: string | null; error_message: string | null; attempts: number; lease_token: string | null; lease_until: string | null; updated_at: string }
export interface StudioMediaRow { id: string; import_id: string; tenant_id: string; workspace_id: string; storage_key: string; sha256: string; width: number; height: number; kind: string }
export class StudioImports {
  constructor(public repo: Repository, public environment: string, public appEnv: string, public dataDir: string) {}
  import(p: Principal, id: string) { const row = this.repo.get<StudioImportRow>('SELECT * FROM studio_imports WHERE id=? AND tenant_id=? AND environment=? AND app_env=?', id, p.tenantId, this.environment, this.appEnv); if (!row) throw new AppError('NOT_FOUND', '导入来源不存在或不在当前环境。', 404); requireWorkspace(p, row.workspace_id); return row; }
  view(r: StudioImportRow): StudioImport { const result = r.result ? JSON.parse(r.result) as { pages: StudioImportPage[]; warnings: string[] } : { pages: [], warnings: [] }; return { id: r.id, workspaceId: r.workspace_id, name: r.name, fileName: r.file_name, format: r.format, status: r.status, version: r.version, pages: r.status === 'review' ? result.pages : [], warnings: r.status === 'review' ? result.warnings : [], errorMessage: r.error_message, attempts: r.attempts, updatedAt: r.updated_at }; }
  create(p: Principal, input: z.infer<typeof studioImportInput>) {
    requireWorkspace(p, input.workspaceId); if (Array.from(input.fileName).some(c => c.codePointAt(0)! < 32) || /[\\/:]/.test(input.fileName) || !/\.(pdf|pptx)$/i.test(input.fileName)) throw new AppError('UNSUPPORTED_DOCUMENT', '请选择 PDF 或无宏 PPTX，旧版 PPT 请先另存为 PPTX。', 422);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64) || input.contentBase64.length % 4 !== 0) throw new AppError('INVALID_MEDIA', '文档编码无效，请重新选择文件。');
    const bytes = Buffer.from(input.contentBase64, 'base64'); if (bytes.length < 8 || bytes.length > 8 * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', '文档需在八 MB 以内，请拆分后上传。', 413);
    const format = input.fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'pptx';
    if ((format === 'pdf' && bytes.subarray(0, 1024).indexOf(Buffer.from('%PDF-')) < 0) || (format === 'pptx' && bytes.readUInt32LE(0) !== 0x04034b50)) throw new AppError('INVALID_MEDIA', '文件扩展名和实际内容不一致，请重新选择文件。', 422);
    if (this.repo.get<{ n: number }>("SELECT count(*) n FROM studio_imports WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? AND status IN ('queued','processing')", p.tenantId, input.workspaceId, this.environment, this.appEnv)!.n >= 3) throw new AppError('IMPORT_QUEUE_FULL', '当前工作空间已有三个文档在解析，请等待或取消后继续。', 429);
    if (this.repo.get<{ n: number }>('SELECT count(*) n FROM studio_imports WHERE tenant_id=? AND created_at>=?', p.tenantId, new Date().toISOString().slice(0, 10))!.n >= 20) throw new AppError('QUOTA_EXCEEDED', '本地导入每日最多二十份，请稍后继续。', 429);
    const id = randomUUID(), key = id + '.document', at = new Date().toISOString(); writeFileSync(path.join(this.dataDir, 'objects', key), bytes, { flag: 'wx' });
    this.repo.run('INSERT INTO studio_imports(id,tenant_id,workspace_id,actor_id,name,file_name,format,storage_key,sha256,size,rights_note,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, p.tenantId, input.workspaceId, p.userId, input.name, input.fileName, format, key, createHash('sha256').update(bytes).digest('hex'), bytes.length, input.rightsNote, this.environment, this.appEnv, at, at); return id;
  }
  cancel(r: StudioImportRow, version: number) {
    if (r.version !== version) throw new AppError('VERSION_CONFLICT', '导入状态已变化，请重新核对。', 409);
    if (!['queued', 'processing', 'review'].includes(r.status)) throw new AppError('STATE_CONFLICT', '该导入已结束，不能重复取消。', 409);
    if (this.repo.get('SELECT id FROM studio_projects WHERE instr(document,?)>0', r.id) || this.repo.get('SELECT id FROM studio_templates WHERE instr(document,?)>0', r.id)) throw new AppError('SOURCE_IN_USE', '工程或模板仍在使用此来源，请先移除关联再取消。', 409);
    this.repo.run("UPDATE studio_imports SET status='cancelled',result=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=?", new Date().toISOString(), r.id);
  }
  media(p: Principal, id: string) { const row = this.repo.get<StudioMediaRow>('SELECT * FROM studio_import_media WHERE id=? AND tenant_id=?', id, p.tenantId); if (!row) throw new AppError('NOT_FOUND', '导入图片不存在。', 404); const source = this.import(p, row.import_id); if (source.status !== 'review') throw new AppError('SOURCE_UNAVAILABLE', '此导入图片尚未就绪或已取消。', 409); requireWorkspace(p, row.workspace_id); return row; }
}
