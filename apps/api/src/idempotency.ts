import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { AppError, canonical } from '@digitalguide/domain';

export function executeIdempotent<T>(repo: Repository, req: FastifyRequest, tenantId: string, actorId: string, work: () => T, code = 200): { data: T; code: number } {
  const key = z.string().min(8).max(128).parse(req.headers['idempotency-key']);
  const action = req.method + ' ' + req.url.split('?')[0];
  const hash = createHash('sha256').update(canonical(req.body ?? {})).digest('hex');
  return repo.transaction(() => {
    const previous = repo.get<{ request_hash: string; response: string; status_code: number; redacted: number }>('SELECT * FROM idempotency WHERE tenant_id=? AND actor_id=? AND action=? AND key=?', tenantId, actorId, action, key);
    if (previous) {
      if (previous.request_hash !== hash) throw new AppError('IDEMPOTENCY_CONFLICT', '同一操作编号的内容发生变化，请重新发起操作。', 409);
      if (previous.redacted) throw new AppError('DATA_REMOVED', '此操作的旧响应已因资料变更或删除而清理，请重新载入当前状态。', 409);
      return { data: JSON.parse(previous.response) as T, code: previous.status_code };
    }
    const data = work();
    repo.run('INSERT INTO idempotency(tenant_id,actor_id,action,key,request_hash,response,status_code,created_at) VALUES (?,?,?,?,?,?,?,?)', tenantId, actorId, action, key, hash, JSON.stringify(data), code, new Date().toISOString());
    return { data, code };
  });
}
