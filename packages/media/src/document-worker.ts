import { importStudioDocument } from './document-import.js';
import { AppError } from '@digitalguide/domain';
let delivered=false;process.on('disconnect',()=>{if(!delivered)process.exit(1);});
process.once('message', async (message: { contentBase64: string; format: 'pdf' | 'pptx' }) => {
  try { const result = await importStudioDocument(Buffer.from(message.contentBase64, 'base64'), message.format); delivered=true;process.send?.({ ok: true, result: { ...result, media: result.media.map(m => ({ ...m, png: m.png.toString('base64') })) } }, () => process.disconnect()); }
  catch (e) { delivered=true;process.send?.({ ok: false, code: e instanceof AppError ? e.code : 'DOCUMENT_IMPORT_FAILED', message: e instanceof AppError ? e.message : '文档解析失败，请检查文件或拆分后重试。' }, () => process.disconnect()); }
});
