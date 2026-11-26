import fs from 'node:fs';
import type { FastifyRequest,FastifyReply } from 'fastify';
import { AppError } from '@digitalguide/domain';
export function privateFile(req: FastifyRequest,reply: FastifyReply,file: string,mediaType: string,name?: string) {
  if (!fs.existsSync(file)) throw new AppError('MEDIA_MISSING','素材文件缺失，请重新上传或生成。',409);
  const size = fs.statSync(file).size;reply.type(mediaType).header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Accept-Ranges','bytes');
  if (name) reply.header('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name).replace(/'/g,'%27'));
  if (req.headers.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if (!m || (!m[1] && !m[2])) return reply.code(416).header('Content-Range','bytes */'+size).send();
    const start = m[1] ? +m[1] : Math.max(0,size-+m[2]),end = m[1] ? m[2] ? Math.min(size-1,+m[2]) : size-1 : size-1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return reply.code(416).header('Content-Range','bytes */'+size).send();
    return reply.code(206).header('Content-Range',`bytes ${start}-${end}/${size}`).header('Content-Length',end-start+1).send(fs.createReadStream(file,{ start,end }));
  }
  return reply.header('Content-Length',size).send(fs.createReadStream(file));
}
