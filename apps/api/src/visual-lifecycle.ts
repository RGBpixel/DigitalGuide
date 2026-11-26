import type { Repository } from '@digitalguide/database';
const inFlight = new WeakMap<Repository, Map<string, { grantId: string; controller: AbortController }>>();
export function visualControllers(repo: Repository) { let map = inFlight.get(repo); if (!map) { map = new Map(); inFlight.set(repo, map); } return map; }
export function releaseVisualGrant(repo: Repository, grantId: string, reason: string, status: 'revoked' | 'expired' = 'revoked') {
  const grant = repo.get<{ session_id: string; status: string }>('SELECT session_id,status FROM visual_grants WHERE id=?', grantId);
  if (!grant || grant.status !== 'active') return;
  for (const { grantId: active, controller } of visualControllers(repo).values()) if (active === grantId) controller.abort();
  repo.run('UPDATE visual_grants SET status=?,version=version+1,revoked_at=?,ended_reason=? WHERE id=?', status, new Date().toISOString(), reason, grantId);
  repo.run("UPDATE visual_requests SET status='cancelled',error_code='VISUAL_CONTEXT_REVOKED',completed_at=? WHERE grant_id=? AND status IN ('pending','completed')", new Date().toISOString(), grantId);
  repo.run("UPDATE reception_messages SET text='本次画面授权已结束，相关画面回复已清除。',visual_context=NULL,status='cancelled' WHERE session_id=? AND instr(visual_context,?)>0", grant.session_id, grantId);
  repo.run('UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=?', grant.session_id);
  repo.run("UPDATE idempotency SET response='{}',redacted=1 WHERE instr(response,?)>0 OR instr(action,?)>0", grantId, '/sessions/' + grant.session_id);
}
export function releaseSessionVisuals(repo: Repository, sessionId: string, reason: string) {
  for (const grant of repo.all<{ id: string }>("SELECT id FROM visual_grants WHERE session_id=? AND status='active'", sessionId)) releaseVisualGrant(repo, grant.id, reason);
}
export function cancelVisualRequests(repo: Repository, sessionId: string) {
  for (const r of repo.all<{ id: string }>("SELECT id FROM visual_requests WHERE session_id=? AND status='pending'", sessionId)) {
    visualControllers(repo).get(r.id)?.controller.abort('request_cancelled');
    repo.run("UPDATE visual_requests SET status='cancelled',error_code='REQUEST_CANCELLED',completed_at=? WHERE id=?", new Date().toISOString(), r.id);
  }
}
export function sweepVisuals(repo: Repository, environment: string, appEnv: string) {
  const at = new Date().toISOString();
  for (const grant of repo.all<{ id: string }>("SELECT g.id FROM visual_grants g JOIN reception_sessions s ON s.id=g.session_id WHERE g.environment=? AND g.app_env=? AND g.status='active' AND (g.expires_at<=? OR s.status<>'active' OR s.focus_version<>g.focus_version)", environment, appEnv, at)) releaseVisualGrant(repo, grant.id, 'expired_or_focus_changed', 'expired');
  const stale = repo.all<{ id: string }>("SELECT r.id FROM visual_requests r JOIN reception_sessions s ON s.id=r.session_id WHERE s.environment=? AND s.app_env=? AND r.status='pending' AND r.expires_at<=?", environment, appEnv, at);
  for (const r of stale) { visualControllers(repo).get(r.id)?.controller.abort(); repo.run("UPDATE visual_requests SET status='failed',error_code='VISION_TIMEOUT',completed_at=? WHERE id=?", at, r.id); }
}
