import { randomUUID } from 'node:crypto';
import { Repository } from '@digitalguide/database';
import { AppError, assertUsableAsset, requirePermission } from '@digitalguide/domain';
import { ProviderError, selectProvider, type TaskProvider } from '@digitalguide/providers';
import type { JobInput } from '@digitalguide/contracts';

interface QueueRow { id: string; tenant_id: string; workspace_id: string; actor_id: string; payload: string; attempts: number; max_attempts: number; status: string; lease_token: string | null }
export function validateJobAssets(repo: Repository, row: QueueRow, payload: JobInput) {
  const p = repo.principal(row.actor_id);
  if (p.tenantId !== row.tenant_id || !p.workspaceIds.includes(row.workspace_id)) throw new AppError('FORBIDDEN', '任务创建人的工作空间权限已失效。', 403);
  requirePermission(p, 'job.write');
  if (payload.kind === 'provider.check') return;
  requirePermission(p, 'asset.train');
  const asset = repo.asset(p, payload.assetId || ''); assertUsableAsset(asset);
  const consent = repo.get('SELECT id FROM consents WHERE id=? AND tenant_id=? AND workspace_id=? AND asset_id=? AND purpose=? AND revoked_at IS NULL AND expires_at>?', payload.consentId || '', row.tenant_id, row.workspace_id, asset.id, payload.kind === 'training.avatar' ? 'train_avatar' : 'train_voice', new Date().toISOString());
  if (!consent) throw new AppError('CONSENT_REQUIRED', '用途授权已撤回或到期，任务已停止。', 409);
}
export async function runOne(repo: Repository, mode: string, provider: TaskProvider = selectProvider(mode), now = new Date()) {
  const iso = now.toISOString(), leaseToken = randomUUID();
  const row = repo.transaction(() => {
    const cancelled = repo.all<QueueRow>("SELECT * FROM jobs WHERE environment=? AND status='cancellation_requested' AND (lease_until IS NULL OR lease_until<=?)", mode, iso);
    for (const job of cancelled) {
      repo.run("UPDATE jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?", iso, job.id);
      repo.event(job.tenant_id, job.workspace_id, job.id, 'job.cancelled', mode);
    }
    const exhausted = repo.all<QueueRow>("SELECT * FROM jobs WHERE environment=? AND status='running' AND lease_until<=? AND attempts>=max_attempts", mode, iso);
    for (const job of exhausted) {
      repo.run("UPDATE jobs SET status='failed',error_code='RETRY_EXHAUSTED',error_message='重试次数已用完，请检查提供商状态后重新提交。',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?", iso, job.id);
      repo.event(job.tenant_id, job.workspace_id, job.id, 'job.failed', mode);
    }
    const next = repo.get<QueueRow>("SELECT * FROM jobs WHERE environment=? AND ((status IN ('queued','retrying') AND available_at<=?) OR (status='running' AND lease_until<=?)) AND NOT EXISTS (SELECT 1 FROM provider_health h WHERE h.tenant_id=jobs.tenant_id AND h.provider_id=? AND h.open_until>?) AND (SELECT count(*) FROM jobs active WHERE active.tenant_id=jobs.tenant_id AND active.environment=jobs.environment AND active.status IN ('running','cancellation_requested') AND active.lease_until>?)<? ORDER BY created_at,id LIMIT 1", mode, iso, iso, provider.capabilities.id, iso, iso, provider.capabilities.limits.maxConcurrent);
    if (!next) return undefined;
    const circuit = repo.get<{ open_until: string | null }>('SELECT open_until FROM provider_health WHERE tenant_id=? AND provider_id=?', next.tenant_id, provider.capabilities.id);
    if (circuit?.open_until && circuit.open_until > iso) {
      repo.run('UPDATE jobs SET available_at=? WHERE id=?', circuit.open_until, next.id);
      return undefined;
    }
    const concurrent = repo.get<{ count: number }>("SELECT count(*) AS count FROM jobs WHERE tenant_id=? AND environment=? AND status IN ('running','cancellation_requested') AND lease_until>?", next.tenant_id, mode, iso)!.count;
    if (concurrent >= provider.capabilities.limits.maxConcurrent) return undefined;
    repo.run("UPDATE jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?", leaseToken, new Date(now.getTime() + 10000).toISOString(), iso, next.id);
    return { ...next, attempts: next.attempts + 1 };
  });
  if (!row) return false;
  const payload: JobInput = JSON.parse(row.payload);
  let result: unknown, failure: { code: string; message: string; retryable: boolean; unknown: boolean } | undefined;
  try { validateJobAssets(repo, row, payload); result = await provider.execute(row.id, payload, row.attempts); }
  catch (error) {
    failure = error instanceof ProviderError ? { code: error.code, message: error.message, retryable: error.retryable, unknown: error.unknown }
      : error instanceof AppError ? { code: error.code, message: error.message, retryable: false, unknown: false }
      : { code: 'WORKER_FAILED', message: '任务执行异常，请查看提供商状态或联系管理员。', retryable: false, unknown: false };
  }
  repo.transaction(() => {
    const current = repo.get<{ status: string; lease_token: string; lease_until: string }>('SELECT status,lease_token,lease_until FROM jobs WHERE id=?', row.id);
    const completed = new Date().toISOString();
    if (!current || current.lease_token !== leaseToken || current.lease_until <= completed) return; // expired workers cannot commit.
    if (current.status === 'cancellation_requested') {
      repo.run("UPDATE jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?", completed, row.id);
      repo.event(row.tenant_id, row.workspace_id, row.id, 'job.cancelled', mode); return;
    }
    if (current.status !== 'running') return;
    if (!failure) {
      try { validateJobAssets(repo, row, payload); } catch (error) { failure = { code: 'CONSENT_REQUIRED', message: error instanceof AppError ? error.message : '授权校验失败，请重新检查。', retryable: false, unknown: false }; }
    }
    const status = failure ? failure.unknown ? 'unknown' : failure.retryable && row.attempts < row.max_attempts ? 'retrying' : 'failed' : 'succeeded';
    repo.run('UPDATE jobs SET status=?,result=?,error_code=?,error_message=?,available_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?', status, failure ? null : JSON.stringify(result), failure?.code || null, failure?.message || null, new Date(Date.now() + Math.min(row.attempts * 500, 5000)).toISOString(), completed, row.id);
    if (failure && failure.code.startsWith('PROVIDER_')) {
      repo.run('INSERT INTO provider_health(tenant_id,provider_id,failures) VALUES (?,?,1) ON CONFLICT(tenant_id,provider_id) DO UPDATE SET failures=failures+1', row.tenant_id, provider.capabilities.id);
      repo.run('UPDATE provider_health SET open_until=? WHERE tenant_id=? AND provider_id=? AND failures>=3', new Date(Date.now() + 30000).toISOString(), row.tenant_id, provider.capabilities.id);
    } else if (!failure) repo.run('DELETE FROM provider_health WHERE tenant_id=? AND provider_id=?', row.tenant_id, provider.capabilities.id);
    if (status === 'succeeded') repo.run('INSERT OR IGNORE INTO provider_usage(job_id,tenant_id,workspace_id,environment,units,cost_minor,created_at) VALUES (?,?,?,?,1,NULL,?)', row.id, row.tenant_id, row.workspace_id, mode, completed);
    repo.event(row.tenant_id, row.workspace_id, row.id, 'job.' + status, mode);
  });
  return true;
}
export function dispatchOutbox(repo: Repository, mode: string) {
  return repo.transaction(() => {
    const events = repo.all<{ id: string }>('SELECT id FROM outbox_events WHERE environment=? AND delivered_at IS NULL ORDER BY created_at LIMIT 100', mode);
    for (const event of events) {
      const now = new Date().toISOString();
      // M1 consumer is the local event feed. External consumers are added by their business tasks.
      repo.run('INSERT OR IGNORE INTO event_deliveries VALUES (?,?)', event.id, now);
      repo.run('UPDATE outbox_events SET delivered_at=? WHERE id=?', now, event.id);
    }
    return events.length;
  });
}
