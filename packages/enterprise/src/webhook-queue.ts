import { randomUUID } from 'node:crypto';
import { AppError } from '../../domain/src/index.js';
import { webhookResultSchema, type WebhookLease, type WebhookResult } from '../../contracts/src/developer-webhooks.js';
import type { IdentityRow, IdentityWorkflow } from './identity-workflows.js';
import type { WebhookHost } from './webhook-runtime.js';
function* q(sql: string, args: unknown[] = []): IdentityWorkflow<IdentityRow[]> { return (yield { kind: 'query', sql, args }) as IdentityRow[]; }
function* now(): IdentityWorkflow<string> { return (yield { kind: 'now' }) as string; }
const n = (v: unknown) => Number(v);
const joined = 'SELECT d.*,s.app_id,s.destination_id,s.enabled sub_enabled,s.version sub_version,s.fingerprint sub_fingerprint,s.topics,a.enabled app_enabled,a.scopes,e.topic,e.payload FROM developer_webhook_deliveries d JOIN developer_webhook_subscriptions s ON s.id=d.subscription_id JOIN developer_apps a ON a.id=s.app_id JOIN developer_webhook_events e ON e.id=d.event_id';
export function webhookSourceAllowed(row: IdentityRow) {
  return n(row.app_enabled) === 1 && n(row.sub_enabled) === 1 && n(row.sub_version) === n(row.generation) && row.sub_fingerprint === row.fingerprint && (row.topic === 'webhook.test' || (JSON.parse(String(row.topics)) as string[]).includes(String(row.topic)) && (JSON.parse(String(row.scopes)) as string[]).includes(row.topic === 'projects.changed' ? 'projects.read' : 'exports.read'));
}
export function webhookFinalState(result: WebhookResult, attempt: number, maxAttempts: number) {
  if (result.outcome === 'accepted') return 'delivered'; if (result.outcome === 'rejected') return 'failed'; if (result.outcome === 'blocked') return 'blocked'; if (attempt < maxAttempts) return 'retrying'; return result.outcome === 'unknown' ? 'unknown' : 'failed';
}
function assertResult(result: WebhookResult) {
  const { outcome: o, code: c, httpStatus: s } = result;
  if (o === 'accepted' && (s === null || s < 200 || s >= 300 || c !== 'HTTP_ACCEPTED') || o === 'unknown' && (s !== null || c !== 'TRANSPORT_UNCERTAIN') || o === 'retryable' && (s === null || !(s === 429 || s >= 500) || c !== 'HTTP_RETRYABLE') || o === 'blocked' && (s !== null || !['CONFIG_REQUIRED', 'CONFIG_CHANGED', 'EXTERNAL_NOT_AUTHORIZED', 'SCOPE_WITHDRAWN', 'PAYLOAD_INVALID'].includes(c)) || o === 'rejected' && (s === null || s < 300 || s >= 500 || s === 429 || !['REDIRECT_BLOCKED', 'HTTP_REJECTED'].includes(c))) throw new AppError('WEBHOOK_OUTCOME_INVALID', '回调结果与HTTP回执不符，未记录成功。', 409);
}
export class WebhookQueue {
  constructor(readonly host: Pick<WebhookHost, 'providerMode' | 'appEnv'>, readonly native = false) {}
  private parameters() { return [this.host.providerMode, this.host.appEnv]; }
  *claim(): IdentityWorkflow<WebhookLease | null> {
    const token = randomUUID();
    if (this.native) return (yield* q("SELECT dg_native_webhook_queue('claim',?::jsonb) value", [JSON.stringify({ leaseToken: token })]))[0].value as WebhookLease | null;
    let at = yield* now();
    const expired = yield* q("SELECT r.delivery_id,r.attempt,r.lease_token FROM developer_webhook_attempts r JOIN developer_webhook_deliveries d ON d.id=r.delivery_id WHERE r.outcome='sending' AND r.lease_until<=? AND d.environment=? AND d.app_env=? ORDER BY d.id,r.attempt LIMIT 100", [at, ...this.parameters()]);
    for (const old of expired) {
      const row = (yield* q(joined + ' WHERE d.id=?', [old.delivery_id]))[0], attempt = (yield* q('SELECT * FROM developer_webhook_attempts WHERE delivery_id=? AND attempt=?', [old.delivery_id, old.attempt]))[0];
      at = yield* now(); if (attempt.outcome !== 'sending' || String(attempt.lease_until) > at) continue;
      const allowed = webhookSourceAllowed(row), withdrawn = !allowed || row.status === 'cancelled' || n(attempt.scope_withdrawn) === 1;
      yield* q("UPDATE developer_webhook_attempts SET outcome='unknown',error_code=?,finished_at=?,scope_withdrawn=? WHERE delivery_id=? AND attempt=?", [withdrawn ? 'SCOPE_WITHDRAWN' : 'LEASE_EXPIRED', at, withdrawn ? 1 : 0, row.id, old.attempt]);
      if (row.status === 'sending' && row.lease_token === old.lease_token) yield* q('UPDATE developer_webhook_deliveries SET status=?,last_code=?,lease_token=NULL,lease_until=NULL,available_at=?,updated_at=? WHERE id=?', [!allowed ? 'cancelled' : n(row.attempts) < n(row.max_attempts) ? 'retrying' : 'unknown', !allowed ? 'SCOPE_WITHDRAWN' : 'LEASE_EXPIRED', new Date(Date.parse(at) + 5000).toISOString(), at, row.id]);
    }
    if (n((yield* q("SELECT count(*) n FROM developer_webhook_deliveries WHERE environment=? AND app_env=? AND status='sending' AND lease_until>?", [...this.parameters(), at]))[0].n) >= 4) return null;
    const rows = yield* q(joined + " WHERE d.environment=? AND d.app_env=? AND d.status IN('queued','retrying') AND d.available_at<=? AND d.attempts<d.max_attempts ORDER BY d.created_at,d.id LIMIT 100", [...this.parameters(), at]);
    for (const row of rows) {
      at = yield* now(); if (!webhookSourceAllowed(row)) { yield* q("UPDATE developer_webhook_deliveries SET status='cancelled',last_code='SCOPE_WITHDRAWN',updated_at=? WHERE id=?", [at, row.id]); continue; }
      const attempt = n(row.attempts) + 1, until = new Date(Date.parse(at) + 20000).toISOString();
      yield* q("UPDATE developer_webhook_deliveries SET status='sending',attempts=?,lease_token=?,lease_until=?,updated_at=? WHERE id=?", [attempt, token, until, at, row.id]);
      yield* q("INSERT INTO developer_webhook_attempts(delivery_id,attempt,lease_token,lease_until,outcome,started_at,scope_withdrawn) VALUES(?,?,?,?,'sending',?,0)", [row.id, attempt, token, until, at]);
      return { id: String(row.id), eventId: String(row.event_id), subscriptionId: String(row.subscription_id), applicationId: String(row.app_id), destinationId: String(row.destination_id), fingerprint: String(row.fingerprint), tenantId: String(row.tenant_id), workspaceId: String(row.workspace_id), environment: this.host.providerMode, appEnv: this.host.appEnv, generation: n(row.generation), attempt, maxAttempts: n(row.max_attempts), leaseToken: token, leaseUntil: until, event: JSON.parse(String(row.payload)) };
    } return null;
  }
  *ready(lease: Pick<WebhookLease, 'id' | 'leaseToken'>, fingerprint: string, bodySHA256: string): IdentityWorkflow<{ ready: boolean; status: string; code?: string }> {
    if (this.native) return (yield* q("SELECT dg_native_webhook_queue('ready',?::jsonb) value", [JSON.stringify({ id: lease.id, leaseToken: lease.leaseToken, fingerprint, bodySHA256 })]))[0].value as { ready: boolean; status: string; code?: string };
    const row = (yield* q(joined + ' WHERE d.id=? AND d.environment=? AND d.app_env=?', [lease.id, ...this.parameters()]))[0]; if (!row) return { ready: false, status: 'cancelled' };
    const attempt = (yield* q('SELECT * FROM developer_webhook_attempts WHERE delivery_id=? AND lease_token=?', [lease.id, lease.leaseToken]))[0], at = yield* now();
    if (!attempt || attempt.outcome !== 'sending' || String(attempt.lease_until) <= at) return { ready: false, status: String(row.status) };
    const withdrawn = !webhookSourceAllowed(row) || row.status !== 'sending' || row.lease_token !== lease.leaseToken || n(attempt.scope_withdrawn) === 1;
    if (withdrawn || row.fingerprint !== fingerprint) {
      const status = withdrawn ? 'cancelled' : 'blocked', code = withdrawn ? 'SCOPE_WITHDRAWN' : 'CONFIG_CHANGED';
      yield* q("UPDATE developer_webhook_attempts SET outcome='blocked',error_code=?,finished_at=?,scope_withdrawn=? WHERE delivery_id=? AND attempt=?", [code, at, withdrawn ? 1 : 0, row.id, attempt.attempt]);
      yield* q('UPDATE developer_webhook_deliveries SET status=?,last_code=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?', [status, code, at, row.id]); return { ready: false, status, code };
    }
    if (!/^[a-f0-9]{64}$/.test(bodySHA256)) throw new AppError('WEBHOOK_PAYLOAD_INVALID', '回调正文摘要无效，未发送。', 409);
    yield* q('UPDATE developer_webhook_attempts SET body_sha256=? WHERE delivery_id=? AND attempt=?', [bodySHA256, row.id, attempt.attempt]); return { ready: true, status: 'sending' };
  }
  *finish(lease: Pick<WebhookLease, 'id' | 'leaseToken'>, value: WebhookResult): IdentityWorkflow<{ recorded: boolean; status: string; scopeWithdrawn?: boolean }> {
    const result = webhookResultSchema.parse(value); assertResult(result);
    if (this.native) return (yield* q("SELECT dg_native_webhook_queue('finish',?::jsonb) value", [JSON.stringify({ id: lease.id, leaseToken: lease.leaseToken, ...result })]))[0].value as { recorded: boolean; status: string; scopeWithdrawn?: boolean };
    const row = (yield* q(joined + ' WHERE d.id=? AND d.environment=? AND d.app_env=?', [lease.id, ...this.parameters()]))[0]; if (!row) return { recorded: false, status: 'cancelled' };
    const attempt = (yield* q('SELECT * FROM developer_webhook_attempts WHERE delivery_id=? AND lease_token=?', [lease.id, lease.leaseToken]))[0], at = yield* now();
    if (!attempt || attempt.outcome !== 'sending' || String(attempt.lease_until) <= at) return { recorded: false, status: String(row.status) };
    if (result.outcome !== 'blocked' && !attempt.body_sha256) throw new AppError('WEBHOOK_OUTCOME_INVALID', '此尝试尚未完成发送前核对，不能记录HTTP结果。', 409);
    const withdrawn = !webhookSourceAllowed(row) || row.status !== 'sending' || row.lease_token !== lease.leaseToken || n(attempt.scope_withdrawn) === 1;
    yield* q('UPDATE developer_webhook_attempts SET outcome=?,error_code=?,http_status=?,finished_at=?,scope_withdrawn=? WHERE delivery_id=? AND attempt=?', [result.outcome, result.code, result.httpStatus, at, withdrawn ? 1 : 0, row.id, attempt.attempt]);
    const status = withdrawn ? 'cancelled' : webhookFinalState(result, n(row.attempts), n(row.max_attempts)), delay = Math.max(Math.min(300, 5 * 3 ** Math.min(4, n(row.attempts) - 1)), result.retryAfterSeconds);
    yield* q('UPDATE developer_webhook_deliveries SET status=?,last_code=?,http_status=?,lease_token=NULL,lease_until=NULL,available_at=?,updated_at=? WHERE id=?', [status, withdrawn ? 'SCOPE_WITHDRAWN' : result.code, result.httpStatus, status === 'retrying' ? new Date(Date.parse(at) + delay * 1000).toISOString() : row.available_at, at, row.id]);
    return { recorded: true, status, scopeWithdrawn: withdrawn };
  }
}
