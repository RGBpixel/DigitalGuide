import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { NotificationFailure, selectNotificationProvider, type NotificationProvider } from '@digitalguide/providers';
import { VisitService, type DeliveryRow } from '../../api/src/visit-service.js';
import type { SessionRow } from '../../api/src/reception-service.js';

export function notificationProvider(repo: Repository, mode: string) {
  return selectNotificationProvider(mode, {
    get(id) { return repo.get<{ hash: string; remoteId: string }>('SELECT request_hash AS hash,remote_id AS remoteId FROM mock_notification_submissions WHERE delivery_id=?', id); },
    put(id, hash, remoteId) { repo.run('INSERT OR IGNORE INTO mock_notification_submissions VALUES (?,?,?,?)', id, hash, remoteId, new Date().toISOString()); }
  });
}
export async function processVisitNotification(repo: Repository, mode: string, appEnv: string, provider: NotificationProvider = notificationProvider(repo, mode)) {
  const service = new VisitService(repo, mode, appEnv), lease = randomUUID(), now = new Date().toISOString();
  const claimed = repo.transaction(() => {
    service.sweep();
    const row = repo.get<DeliveryRow>("SELECT * FROM visit_deliveries WHERE environment=? AND app_env=? AND (status='queued' OR (status='submitting' AND lease_until<=?)) AND NOT EXISTS (SELECT 1 FROM visit_deliveries busy WHERE busy.tenant_id=visit_deliveries.tenant_id AND busy.environment=visit_deliveries.environment AND busy.app_env=visit_deliveries.app_env AND busy.status='submitting' AND busy.lease_until>?) ORDER BY created_at,id LIMIT 1", mode, appEnv, now, now);
    if (!row) return undefined;
    const recovering = row.status === 'submitting';
    repo.run("UPDATE visit_deliveries SET status='submitting',attempts=attempts+1,lease_token=?,lease_until=?,version=version+1,updated_at=? WHERE id=?", lease, new Date(Date.now() + 10000).toISOString(), now, row.id);
    return { row, recovering };
  });
  if (!claimed) return false;
  const delivery = claimed.row, visit = service.row(delivery.visit_id), session = repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', visit.session_id)!;
  let result: Awaited<ReturnType<NotificationProvider['send']>> | null = null, errorCode: string | null = null, unknown = false, cancelled = false;
  try {
    if (claimed.recovering) { result = await provider.lookup(delivery.id); if (!result) { errorCode = 'NOTIFICATION_RESULT_UNKNOWN'; unknown = true; } }
    else if (visit.status !== 'notifying' || !visit.confirmed_hash || visit.confirmed_hash !== service.hash(visit) || session.status !== 'active' || visit.focus_version !== session.focus_version || !service.availableHost(service.host(visit)) || service.host(visit)?.user_id !== delivery.recipient_user_id) cancelled = true;
    else result = await provider.send({ deliveryId: delivery.id, visitRef: visit.id, recipientRef: delivery.recipient_user_id, visitorName: visit.guest_name, company: visit.company, purpose: visit.purpose, scenario: delivery.scenario });
  } catch (error) {
    errorCode = error instanceof NotificationFailure ? error.code : 'NOTIFICATION_RESULT_UNKNOWN';
    unknown = !(error instanceof NotificationFailure) || error.unknown;
    if (unknown) { try { result = await provider.lookup(delivery.id); if (result) { unknown = false; errorCode = null; } } catch { /* retain unknown; never resend */ } }
  }
  repo.transaction(() => {
    const current = repo.get<DeliveryRow>('SELECT * FROM visit_deliveries WHERE id=?', delivery.id)!;
    if (current.lease_token !== lease || !current.lease_until || current.lease_until <= new Date().toISOString() || current.status !== 'submitting') return;
    const status = cancelled ? 'cancelled' : result ? 'submitted' : unknown ? 'unknown' : 'failed';
    repo.run('UPDATE visit_deliveries SET status=?,remote_id=?,error_code=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=?', status, result?.remoteId || null, errorCode, new Date().toISOString(), delivery.id);
    const fresh = service.row(visit.id);
    if (status === 'submitted' && fresh.status === 'notifying' && fresh.confirmed_hash !== service.hash(fresh)) service.escalate(fresh, 'recipient_changed_after_submission');
    else if (status === 'submitted' && fresh.status === 'notifying') {
      repo.run('UPDATE visits SET host_deadline=? WHERE id=?', new Date(Date.now() + 60000).toISOString(), fresh.id);
      service.state(fresh, 'waiting_host');
    } else if (['cancelled', 'failed', 'unknown'].includes(status) && ['notifying', 'waiting_host'].includes(fresh.status)) service.escalate(fresh, cancelled ? 'session_context_changed' : status === 'unknown' ? 'notification_unknown' : 'notification_failed');
    repo.event(delivery.tenant_id, delivery.workspace_id, delivery.id, 'notification.' + status, mode);
  });
  return true;
}
