import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError, canonical } from '@digitalguide/domain';
import { notificationReceiptInput } from '@digitalguide/contracts';
import type { Config } from './config.js';
import { VisitService, type DeliveryRow } from './visit-service.js';

function signingKey(config: Config) { return createHmac('sha256', config.sessionSecret).update('mock-notification:' + config.appEnv).digest('hex'); }
export function signNotificationReceipt(config: Config, body: unknown, timestamp: string) { return createHmac('sha256', signingKey(config)).update(timestamp + '.' + canonical(body)).digest('hex'); }
export function applyNotificationReceipt(repo: Repository, config: Config, raw: unknown, timestamp: unknown, signature: unknown) {
  if (config.providerMode !== 'mock' || config.appEnv === 'production') throw new AppError('CAPABILITY_UNAVAILABLE', '模拟回调仅在本地模拟环境开放。', 409);
  if (typeof timestamp !== 'string' || !/^\d{10,13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(signNotificationReceipt(config, raw, timestamp)))) throw new AppError('INVALID_SIGNATURE', '通知回执签名无效或已过期，未更新业务状态。', 403);
  const input = notificationReceiptInput.parse(raw), service = new VisitService(repo, config.providerMode, config.appEnv);
  const hash = createHash('sha256').update(canonical(input)).digest('hex');
  const apply = () => {
    const previous = repo.get<{ request_hash: string; disposition: string }>('SELECT request_hash,disposition FROM notification_callback_events WHERE event_id=?', input.eventId);
    if (previous) {
      if (previous.request_hash !== hash) throw new AppError('IDEMPOTENCY_CONFLICT', '同一通知事件编号的内容不一致。', 409);
      return { disposition: previous.disposition, duplicate: true };
    }
    const delivery = repo.get<DeliveryRow>('SELECT * FROM visit_deliveries WHERE id=? AND environment=? AND app_env=?', input.deliveryId, config.providerMode, config.appEnv);
    if (!delivery) throw new AppError('NOT_FOUND', '当前环境没有此通知记录。', 404);
    const ranks: Record<string, number> = { queued: 0, submitting: 1, submitted: 2, failed: 1, unknown: 1, delivered: 3, acknowledged: 4, cancelled: 5 };
    const target = input.status === 'acknowledged' ? 4 : input.status === 'delivered' ? 3 : 1;
    const ignored = ['delivered', 'acknowledged'].includes(input.status) ? ranks[delivery.status] >= target : ['delivered', 'acknowledged', 'cancelled', 'failed', 'unknown'].includes(delivery.status);
    if (!ignored) {
      repo.run('UPDATE visit_deliveries SET status=?,version=version+1,lease_token=NULL,lease_until=NULL,remote_id=COALESCE(remote_id,?),error_code=?,updated_at=? WHERE id=?', input.status, 'mock-notification:' + delivery.id, input.status === 'failed' ? 'MOCK_NOTIFICATION_FAILED' : input.status === 'unknown' ? 'NOTIFICATION_RESULT_UNKNOWN' : null, new Date().toISOString(), delivery.id);
      const visit = service.row(delivery.visit_id);
      if (['delivered', 'acknowledged'].includes(input.status) && visit.status === 'notifying') {
        if (visit.confirmed_hash !== service.hash(visit)) service.escalate(visit, 'recipient_changed_after_submission');
        else service.state(visit, 'waiting_host');
      }
      if (['failed', 'unknown'].includes(input.status) && ['notifying', 'waiting_host'].includes(visit.status)) service.escalate(visit, input.status === 'unknown' ? 'notification_unknown' : 'notification_failed');
      repo.event(delivery.tenant_id, delivery.workspace_id, delivery.id, 'notification.' + input.status, config.providerMode);
    }
    repo.run('INSERT INTO notification_callback_events VALUES (?,?,?,?,?,?)', input.eventId, delivery.id, config.providerMode, hash, ignored ? 'ignored' : 'applied', new Date().toISOString());
    return { disposition: ignored ? 'ignored' : 'applied', duplicate: false };
  };
  return repo.db.isTransaction ? apply() : repo.transaction(apply);
}
