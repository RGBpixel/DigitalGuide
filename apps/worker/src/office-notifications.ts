import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError } from '@digitalguide/domain';
import { OfficeDeliveryError, selectOfficeProvider, type OfficeDeliveryProvider, type OfficeDeliveryReceipt } from '@digitalguide/providers';
import { OfficeService, type OfficeNoticeRow } from '../../api/src/office-service.js';
export function officeProvider(repo: Repository, mode: string, appEnv: string) {
  return selectOfficeProvider(mode, appEnv, {
    get(id) { return repo.get<{ hash: string; remoteId: string }>('SELECT request_hash AS hash,remote_id AS remoteId FROM office_mock_submissions WHERE notification_id=?', id); },
    put(id, hash, remoteId) { repo.run('INSERT OR IGNORE INTO office_mock_submissions VALUES (?,?,?,?)', id, hash, remoteId, new Date().toISOString()); }
  });
}
export async function processOfficeNotification(repo: Repository, mode: string, appEnv: string, provider?: OfficeDeliveryProvider, now = new Date()) {
  const service = new OfficeService(repo, mode, appEnv), lease = randomUUID(), time = now.toISOString();
  const claimed = repo.transaction(() => {
    service.sweep(now);
    const row = repo.get<OfficeNoticeRow>("SELECT * FROM office_notifications n WHERE n.environment=? AND n.app_env=? AND n.status='pending' AND n.due_at<=? AND (n.dispatch_status='queued' OR (n.dispatch_status='submitting' AND n.lease_until<=?)) AND NOT EXISTS (SELECT 1 FROM office_notifications busy WHERE busy.tenant_id=n.tenant_id AND busy.environment=n.environment AND busy.app_env=n.app_env AND busy.dispatch_status='submitting' AND busy.lease_until>?) ORDER BY n.due_at,n.id LIMIT 1", mode, appEnv, time, time, time);
    if (!row) return null;
    repo.run("UPDATE office_notifications SET dispatch_status='submitting',lease_token=?,lease_until=?,attempts=attempts+1,version=version+1,updated_at=? WHERE id=?", lease, new Date(now.getTime() + 15000).toISOString(), time, row.id);
    return { row, recovering: row.dispatch_status === 'submitting' };
  });
  if (!claimed) return false;
  const n = claimed.row, source = service.source(n, time);
  let result: OfficeDeliveryReceipt | null = null, dispatch: OfficeNoticeRow['dispatch_status'] = 'local', errorCode: string | null = null;
  if (!source) dispatch = 'withdrawn';
  else if (n.channel === 'mock') {
    try {
      const adapter = provider || officeProvider(repo, mode, appEnv);
      if (claimed.recovering) { result = await adapter.lookup(n.id); if (!result) { dispatch = 'unknown'; errorCode = 'CHANNEL_RESULT_UNKNOWN'; } }
      else result = await adapter.send({ notificationId: n.id, recipientId: n.recipient_user_id, sourceId: n.source_id, revision: n.source_revision, kind: n.kind, title: source.title, body: source.body, scenario: n.scenario });
      if (result) dispatch = 'submitted_mock';
    } catch (error) {
      const known = error instanceof OfficeDeliveryError || error instanceof AppError;
      errorCode = known ? error.code : 'CHANNEL_RESULT_UNKNOWN';
      dispatch = error instanceof AppError || (error instanceof OfficeDeliveryError && !error.unknown) ? 'failed' : 'unknown';
      if (dispatch === 'unknown') { try { result = await (provider || officeProvider(repo, mode, appEnv)).lookup(n.id); if (result) { dispatch = 'submitted_mock'; errorCode = null; } } catch { /* keep unknown; never resend */ } }
    }
  }
  repo.transaction(() => {
    const current = repo.get<OfficeNoticeRow>('SELECT * FROM office_notifications WHERE id=?', n.id)!;
    const finalTime = new Date(Math.max(now.getTime(), Date.now())).toISOString();
    if (current.lease_token !== lease || current.dispatch_status !== 'submitting' || !current.lease_until || current.lease_until <= finalTime) return;
    if (!service.source(current, finalTime)) dispatch = 'withdrawn';
    repo.run('UPDATE office_notifications SET status=?,dispatch_status=?,remote_id=?,error_code=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=?', dispatch === 'withdrawn' ? 'withdrawn' : 'unread', dispatch, result?.remoteId || null, errorCode, finalTime, n.id);
    if (dispatch !== 'withdrawn' && n.source_kind === 'relay') repo.run("UPDATE office_relays SET status='sent',version=version+1,updated_at=? WHERE id=? AND revision=? AND status='scheduled'", finalTime, n.source_id, n.source_revision);
    repo.event(n.tenant_id, n.workspace_id, n.id, dispatch === 'withdrawn' ? 'office.notification_withdrawn' : 'office.notification_available', mode);
  });
  return true;
}

