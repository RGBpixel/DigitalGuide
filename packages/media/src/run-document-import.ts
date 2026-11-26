import { fork } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { AppError } from '@digitalguide/domain';
import type { ImportedDocument } from './document-import.js';
export function runDocumentImport(bytes: Buffer, format: 'pdf' | 'pptx', root: string, signal?: AbortSignal): Promise<ImportedDocument> {
  return new Promise((resolve, reject) => {
    const built = path.join(root, 'dist', 'document-import.mjs'), development = process.env.APP_ENV !== 'production' && existsSync(path.join(root,'packages/media/src/document-worker.ts')), entry = development ? path.join(root, 'packages/media/src/document-worker.ts') : built;
    if (!existsSync(entry)) { reject(new AppError('IMPORT_WORKER_MISSING', '本地解析进程尚未构建，请安装依赖并重新构建。', 503)); return; }
    const child = fork(entry, [], { cwd: root, execArgv: [...(development ? ['--import', 'tsx'] : []), '--max-old-space-size=256'], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json' }); let settled = false;
    const fail = (error: AppError) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); child.kill(); reject(error); };
    const abort = () => fail(new AppError('IMPORT_CANCELLED', '文档导入已取消。', 409));
    const timer = setTimeout(() => fail(new AppError('IMPORT_TIMEOUT', '文档解析超过三十秒，请简化文件或拆分后重试。', 422)), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => fail(new AppError('IMPORT_WORKER_FAILED', '无法启动解析进程，请检查本地依赖后重试。', 503)));
    child.on('exit', () => { if (!settled) fail(new AppError('IMPORT_WORKER_FAILED', '解析进程未能完成，请简化文件或检查本地依赖。', 422)); });
    child.on('message', (message: { ok: boolean; result?: Omit<ImportedDocument, 'media'> & { media: { id: string; png: string; width: number; height: number; kind: 'image' | 'reference' }[] }; code?: string; message?: string }) => {
      if (settled) return; if (!message.ok || !message.result) { fail(new AppError(message.code || 'DOCUMENT_IMPORT_FAILED', message.message || '文档解析失败，请检查文件后重试。', 422)); return; }
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({ ...message.result, media: message.result.media.map(m => ({ ...m, png: Buffer.from(m.png, 'base64') })) });
    });
    if (signal?.aborted) abort(); else child.send({ contentBase64: bytes.toString('base64'), format });
  });
}
