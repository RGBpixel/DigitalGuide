import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, requireWorkspace, type Principal } from '@digitalguide/domain';
import { speakerEnrollInput, type SpeakerReference } from '@digitalguide/contracts';
import { selectSpeakerProvider } from '@digitalguide/providers';
import type { SessionRow } from './reception-service.js';
import { advanceSpeakerFocus, eraseMockSpeakerReference, releaseSessionSpeaker } from './speaker-lifecycle.js';
export interface SpeakerReferenceRow { id: string; tenant_id: string; workspace_id: string; owner_user_id: string | null; session_id: string | null; scope: 'temporary' | 'enrolled'; label: string; provider_id: string; provider_reference: string | null; target_token: string | null; quality: SpeakerReference['quality']; status: SpeakerReference['status']; version: number; expires_at: string; created_at: string; delete_status: SpeakerReference['deleteStatus'] }
interface TicketRow { id: string; reference_id: string; session_id: string; focus_version: number; token_hash: string; expires_at: string; used_at: string | null; revoked_at: string | null; created_at: string }
export interface SpeakerUseDescriptor { id: string; referenceId: string; sessionId: string; expiresAt: string }
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class SpeakerReferences {
  constructor(public repo: Repository, public environment: string, public appEnv: string, public secret: string) {}
  owned(p: Principal, id: string) {
    const row = this.repo.get<SpeakerReferenceRow>("SELECT * FROM speaker_references WHERE id=? AND tenant_id=? AND owner_user_id=? AND scope='enrolled' AND environment=? AND app_env=?", id, p.tenantId, p.userId, this.environment, this.appEnv);
    if (!row) throw new AppError('NOT_FOUND', '声音参考不存在或不属于本人。', 404); requireWorkspace(p, row.workspace_id); return row;
  }
  view(r: SpeakerReferenceRow): SpeakerReference { return { id: r.id, workspaceId: r.workspace_id, label: r.label, scope: r.scope, quality: r.quality, status: r.status, version: r.version, provider: r.provider_id, expiresAt: r.expires_at, deleteStatus: r.delete_status, createdAt: r.created_at }; }
  enroll(p: Principal, input: z.infer<typeof speakerEnrollInput>) {
    requireWorkspace(p, input.workspaceId); const provider = selectSpeakerProvider(input.provider, this.environment, this.appEnv), acquired = provider.acquire(input.fixture, 'enrolled');
    if (acquired.quality !== 'adequate') throw new AppError('REFERENCE_QUALITY_INSUFFICIENT', '参考质量不足或包含多人，请使用单一清晰样例重新登记。', 409);
    if (this.repo.get<{ n: number }>("SELECT count(*) n FROM speaker_references WHERE tenant_id=? AND owner_user_id=? AND status IN ('pending','active')", p.tenantId, p.userId)!.n >= 10) throw new AppError('QUOTA_EXCEEDED', '本人最多保留十份有效参考，请先清理旧参考。', 409);
    const id = randomUUID(), at = new Date().toISOString();
    this.repo.run('INSERT INTO speaker_references(id,tenant_id,workspace_id,owner_user_id,scope,label,provider_id,provider_reference,target_token,quality,status,purpose,notice_version,consent_at,expires_at,created_at,environment,app_env) VALUES (?,?,?,?,\'enrolled\',?,?,?,?,?,\'active\',?,?,?,?,?,?,?)', id, p.tenantId, input.workspaceId, p.userId, input.label, provider.id, acquired.providerReference, acquired.targetToken, acquired.quality, input.purpose, input.noticeVersion, at, new Date(Date.now() + input.retentionDays * 86400000).toISOString(), at, this.environment, this.appEnv);
    this.repo.audit(p, input.workspaceId, 'speaker.reference_enrolled_mock', id, id); return this.view(this.owned(p, id));
  }
  code(t: TicketRow, r: SpeakerReferenceRow) { return 'SF1.' + t.id + '.' + createHmac('sha256', this.secret).update(['speaker-use', t.id, r.id, r.version, t.session_id, t.focus_version, t.expires_at, this.environment, this.appEnv].join(':')).digest('base64url'); }
  issue(p: Principal, r: SpeakerReferenceRow, version: number, sessionId: string, focusVersion?: number): SpeakerUseDescriptor {
    if (r.version !== version || r.status !== 'active' || r.expires_at <= new Date().toISOString()) throw new AppError('STATE_CONFLICT', '参考版本已变化、已删除或到期。', 409);
    const s = this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=? AND tenant_id=? AND workspace_id=? AND environment=? AND app_env=?', sessionId, p.tenantId, r.workspace_id, this.environment, this.appEnv);
    if (!s || s.status !== 'active' || (focusVersion !== undefined && s.focus_version !== focusVersion)) throw new AppError('STATE_CONFLICT', '目标会话或服务对象已变化，请重新核对接待页面。', 409);
    if (!s.scene_app_snapshot || JSON.parse(s.scene_app_snapshot).speakerProvider !== r.provider_id) throw new AppError('SCOPE_CONFLICT', '此参考与接待场景的声音服务不匹配，请核对后重新授权。', 409);
    if (this.repo.get<{ n: number }>('SELECT count(*) n FROM speaker_use_tickets WHERE reference_id=? AND created_at>?', r.id, new Date(Date.now() - 60000).toISOString())!.n >= 12) throw new AppError('RATE_LIMITED', '签发过于频繁，请稍后重试。', 429);
    const id = randomUUID(), expiresAt = new Date(Math.min(Date.now() + 60000, Date.parse(s.expires_at), Date.parse(r.expires_at))).toISOString();
    const t: TicketRow = { id, reference_id: r.id, session_id: s.id, focus_version: s.focus_version, expires_at: expiresAt, token_hash: '', used_at: null, revoked_at: null, created_at: new Date().toISOString() }; t.token_hash = sha(this.code(t, r));
    this.repo.run('INSERT INTO speaker_use_tickets(id,reference_id,session_id,focus_version,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?,?)', t.id, r.id, s.id, s.focus_version, t.token_hash, t.expires_at, t.created_at);
    return { id, referenceId: r.id, sessionId: s.id, expiresAt };
  }
  reveal(p: Principal, d: SpeakerUseDescriptor) {
    const r = this.owned(p, d.referenceId), t = this.repo.get<TicketRow>('SELECT * FROM speaker_use_tickets WHERE id=? AND reference_id=?', d.id, r.id), s = t ? this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', t.session_id) : undefined;
    if (!t || t.used_at || t.revoked_at || t.expires_at <= new Date().toISOString() || r.status !== 'active' || !s || s.status !== 'active' || s.focus_version !== t.focus_version) throw new AppError('STATE_CONFLICT', '使用码已失效，请重新核对并签发。', 409);
    return { ...d, useCode: this.code(t, r) };
  }
  consume(s: SessionRow, code: string, provider: string) {
    const ticketId = code.split('.')[1], t = this.repo.get<TicketRow>('SELECT * FROM speaker_use_tickets WHERE id=? AND session_id=? AND focus_version=?', ticketId, s.id, s.focus_version);
    const r = t ? this.repo.get<SpeakerReferenceRow>('SELECT * FROM speaker_references WHERE id=? AND tenant_id=? AND workspace_id=? AND environment=? AND app_env=?', t.reference_id, s.tenant_id, s.workspace_id, this.environment, this.appEnv) : undefined;
    if (!t || !r || t.used_at || t.revoked_at || t.expires_at <= new Date().toISOString() || r.status !== 'active' || r.expires_at <= new Date().toISOString() || r.provider_id !== provider || !equal(t.token_hash, sha(code)) || !equal(code, this.code(t, r))) throw new AppError('REFERENCE_USE_DENIED', '参考使用码无效、已用或不适用于本次服务，请本人重新授权。', 409);
    this.repo.run("UPDATE speaker_use_tickets SET used_at=?,token_hash='' WHERE id=?", new Date().toISOString(), t.id); return r;
  }
  remove(p: Principal, r: SpeakerReferenceRow, version: number) {
    if (r.version !== version) throw new AppError('VERSION_CONFLICT', '参考已变化，请刷新后核对。', 409);
    for (const s of this.repo.all<SessionRow>("SELECT s.* FROM reception_sessions s JOIN speaker_focus_sessions f ON f.session_id=s.id WHERE f.reference_id=? AND s.status IN ('active','human')", r.id)) { const changed = advanceSpeakerFocus(this.repo, s, 'enrolled_reference_withdrawn'); releaseSessionSpeaker(this.repo, changed, 'enrolled_reference_withdrawn'); }
    eraseMockSpeakerReference(this.repo, r.id); this.repo.audit(p, r.workspace_id, 'speaker.reference_deleted_mock', r.id, r.id); return this.view(this.owned(p, r.id));
  }
}
