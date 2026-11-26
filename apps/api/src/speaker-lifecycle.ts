import type { Repository } from '@digitalguide/database';
import { cancelConversationTools } from './conversation-tools.js';
import { releaseSessionVisuals, cancelVisualRequests } from './visual-lifecycle.js';
import type { SessionRow } from './reception-service.js';
import { selectSpeakerProvider } from '@digitalguide/providers';
interface PartialBuffer { sessionId: string; focusVersion: number; text: string; chunks: number; timer: ReturnType<typeof setTimeout>; expiresAt: number }
const buffers = new WeakMap<Repository, Map<string, PartialBuffer>>();
function entries(repo: Repository) { let map = buffers.get(repo); if (!map) { map = new Map(); buffers.set(repo, map); } return map; }
export function clearSpeakerBuffer(repo: Repository, sessionId: string, segmentId?: string) {
  for (const [key, item] of entries(repo)) if (item.sessionId === sessionId && (!segmentId || key.endsWith(':' + segmentId))) { clearTimeout(item.timer); item.text = ''; entries(repo).delete(key); }
}
export function clearAllSpeakerBuffers(repo: Repository) { for (const item of entries(repo).values()) { clearTimeout(item.timer); item.text = ''; } entries(repo).clear(); }
export function speakerBufferStats(repo: Repository, sessionId: string) {
  const own = [...entries(repo).values()].filter(v => v.sessionId === sessionId); return { segments: own.length, characters: own.reduce((n, v) => n + v.text.length, 0) };
}
export function stageSpeakerPartial(repo: Repository, s: SessionRow, segmentId: string, text: string) {
  const map = entries(repo), key = s.id + ':' + s.focus_version + ':' + segmentId, old = map.get(key), own = [...map.values()].filter(v => v.sessionId === s.id);
  if ((!old && own.length >= 4) || (old?.chunks || 0) >= 16 || own.reduce((n, v) => n + (v === old ? 0 : v.text.length), 0) + text.length > 4000) { clearSpeakerBuffer(repo, s.id, segmentId); return false; }
  if (old) { old.text = text; old.chunks++; return true; }
  const timer = setTimeout(() => clearSpeakerBuffer(repo, s.id, segmentId), 5000); timer.unref(); map.set(key, { sessionId: s.id, focusVersion: s.focus_version, text, chunks: 1, timer, expiresAt: Date.now() + 5000 }); return true;
}
export function eraseMockSpeakerReference(repo: Repository, id: string, expired = false) {
  const r = repo.get<{ provider_id: string; provider_reference: string | null; environment: string; app_env: string; status: string }>('SELECT provider_id,provider_reference,environment,app_env,status FROM speaker_references WHERE id=?', id);
  if (r?.provider_reference && ['active', 'pending'].includes(r.status) && r.provider_id.startsWith('mock-') && r.environment === 'mock' && r.app_env !== 'production') selectSpeakerProvider(r.provider_id, r.environment, r.app_env).deleteReference(r.provider_reference);
  repo.run("UPDATE speaker_references SET provider_reference=NULL,target_token=NULL,status=?,delete_status=CASE WHEN provider_id LIKE 'mock-%' THEN 'completed_mock' ELSE 'pending_external' END,deleted_at=?,version=version+1 WHERE id=? AND status IN ('active','pending')", expired ? 'expired' : 'deleted', new Date().toISOString(), id);
  repo.run("UPDATE speaker_use_tickets SET token_hash='',revoked_at=COALESCE(revoked_at,?) WHERE reference_id=?", new Date().toISOString(), id);
}
export function releaseSessionSpeaker(repo: Repository, s: SessionRow, reason: string, nextFocusVersion = s.focus_version) {
  clearSpeakerBuffer(repo, s.id);
  for (const r of repo.all<{ id: string }>("SELECT id FROM speaker_references WHERE session_id=? AND scope='temporary' AND status IN ('active','pending')", s.id)) eraseMockSpeakerReference(repo, r.id);
  repo.run("UPDATE speaker_focus_sessions SET state='ended',reference_id=NULL,usage_target_token=NULL,quality='pending',focus_version=?,last_reason=?,updated_at=? WHERE session_id=?", nextFocusVersion, reason, new Date().toISOString(), s.id);
  repo.run('DELETE FROM speaker_ptt_permits WHERE session_id=?', s.id);
  repo.run("UPDATE speaker_use_tickets SET token_hash='',revoked_at=COALESCE(revoked_at,?) WHERE session_id=? AND used_at IS NULL", new Date().toISOString(), s.id);
}
export function advanceSpeakerFocus(repo: Repository, s: SessionRow, reason: string): SessionRow {
  const next = s.focus_version + 1, at = new Date().toISOString();
  clearSpeakerBuffer(repo, s.id); cancelVisualRequests(repo, s.id); releaseSessionVisuals(repo, s.id, 'speaker.' + reason); cancelConversationTools(repo, s.id);
  repo.run("UPDATE reception_messages SET status='cancelled' WHERE session_id=? AND role='assistant' AND status IN ('ready','playing')", s.id);
  repo.run('INSERT OR IGNORE INTO memory_session_links(session_id,person_id,focus_version,consent_at,transcript_expires_at) SELECT l.session_id,l.person_id,?,l.consent_at,l.transcript_expires_at FROM memory_session_links l JOIN people p ON p.id=l.person_id WHERE l.session_id=? AND l.focus_version=? AND p.guest_session_id=? AND p.status=\'active\' AND p.expires_at>?', next, s.id, s.focus_version, s.id, at);
  repo.run('UPDATE people SET version=version+1,updated_at=? WHERE id IN (SELECT person_id FROM memory_session_links WHERE session_id=? AND focus_version=?)', at, s.id, next);
  const visits = repo.all<{ id: string; status: string }>('SELECT id,status FROM visits WHERE session_id=? AND focus_version=?', s.id, s.focus_version);
  for (const v of visits) {
    const unsubmitted = v.status === 'notifying' && !repo.get('SELECT id FROM visit_deliveries WHERE visit_id=?', v.id);
    if (unsubmitted) { repo.run("UPDATE visits SET status='awaiting_confirmation',confirmed_at=NULL,confirmed_hash=NULL WHERE id=?", v.id); repo.run('DELETE FROM visit_confirmation_targets WHERE visit_id=?', v.id); }
    repo.run('UPDATE visits SET focus_version=?,version=version+1,updated_at=? WHERE id=?', next, at, v.id);
  }
  repo.run('UPDATE reception_sessions SET focus_version=?,version=version+1,reply_epoch=reply_epoch+1,activity_at=? WHERE id=?', next, at, s.id);
  repo.run("UPDATE idempotency SET response='{}',redacted=1 WHERE instr(response,?)>0 OR instr(action,?)>0", s.id, '/sessions/' + s.id);
  repo.run('DELETE FROM speaker_ptt_permits WHERE session_id=?', s.id);
  repo.event(s.tenant_id, s.workspace_id, s.id, 'speaker.focus_version_changed', s.environment);
  return repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', s.id)!;
}
export function sweepSpeakerState(repo: Repository, environment: string, appEnv: string) {
  const at = new Date().toISOString();
  for (const r of repo.all<{ id: string }>("SELECT id FROM speaker_references WHERE environment=? AND app_env=? AND status IN ('active','pending') AND expires_at<=?", environment, appEnv, at)) {
    eraseMockSpeakerReference(repo, r.id, true);
    for (const s of repo.all<SessionRow>("SELECT s.* FROM reception_sessions s JOIN speaker_focus_sessions f ON f.session_id=s.id WHERE f.reference_id=? AND s.status IN ('active','human')", r.id)) { const changed = advanceSpeakerFocus(repo, s, 'reference_expired'); releaseSessionSpeaker(repo, changed, 'reference_expired'); }
  }
  for (const s of repo.all<SessionRow>("SELECT s.* FROM reception_sessions s JOIN speaker_focus_sessions f ON f.session_id=s.id WHERE s.environment=? AND s.app_env=? AND f.state<>'ended' AND (f.expires_at<=? OR f.focus_version<>s.focus_version OR s.status<>'active')", environment, appEnv, at)) {
    const f = repo.get<{ focus_version: number }>('SELECT focus_version FROM speaker_focus_sessions WHERE session_id=?', s.id)!;
    const changed = s.status === 'active' && f.focus_version === s.focus_version ? advanceSpeakerFocus(repo, s, 'focus_expired') : s;
    releaseSessionSpeaker(repo, changed, 'focus_expired_or_changed');
  }
  repo.run('DELETE FROM speaker_ptt_permits WHERE expires_at<=?', at);
  repo.run("UPDATE speaker_use_tickets SET token_hash='',revoked_at=COALESCE(revoked_at,?) WHERE expires_at<=? AND token_hash<>''", at, at);
}
