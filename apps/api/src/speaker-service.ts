import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, assertUsableAsset } from '@digitalguide/domain';
import { speakerStartInput, speakerEventInput, type SpeakerFocusView, type SceneAppSnapshot } from '@digitalguide/contracts';
import { selectSpeakerProvider, selectTargetSpeechProvider } from '@digitalguide/providers';
import { ReceptionService, type SessionRow } from './reception-service.js';
import { ReceptionConversation } from './reception-conversation.js';
import { SceneService } from './knowledge-service.js';
import { SpeakerReferences, type SpeakerReferenceRow } from './speaker-references.js';
import { advanceSpeakerFocus, clearSpeakerBuffer, eraseMockSpeakerReference, releaseSessionSpeaker, speakerBufferStats, stageSpeakerPartial } from './speaker-lifecycle.js';
import { cancelVisualRequests } from './visual-lifecycle.js';
export interface FocusRow { session_id: string; state: SpeakerFocusView['state']; reference_id: string | null; mode: 'temporary' | 'enrolled'; provider_id: string; extraction_id: string; source_channel_id: string; focus_version: number; config_version: number; fallback: SpeakerFocusView['fallback']; last_reason: string; usage_target_token: string | null; quality: string; expires_at: string }
export class SpeakerService {
  reception: ReceptionService; scenes: SceneService; refs: SpeakerReferences;
  constructor(public repo: Repository, public environment: string, public appEnv: string, secret: string) { this.reception = new ReceptionService(repo, environment, appEnv); this.scenes = new SceneService(repo, environment, appEnv); this.refs = new SpeakerReferences(repo, environment, appEnv, secret); }
  focus(sessionId: string) { return this.repo.get<FocusRow>('SELECT * FROM speaker_focus_sessions WHERE session_id=?', sessionId); }
  policy(s: SessionRow) {
    if (!s.scene_app_snapshot) throw new AppError('CAPABILITY_UNAVAILABLE', '请先选择启用专注对话的场景应用，文字接待仍可使用。', 409);
    const snapshot = JSON.parse(s.scene_app_snapshot) as SceneAppSnapshot; this.scenes.active(snapshot);
    const current = this.scenes.snapshot(this.scenes.app({ tenantId: s.tenant_id, userId: 'guest:' + s.id, workspaceIds: [s.workspace_id], role: 'viewer' }, snapshot.id));
    if (!snapshot.speakerProvider || snapshot.speakerProvider === 'disabled') throw new AppError('CAPABILITY_UNAVAILABLE', '此场景未启用专注对话。', 409);
    if (snapshot.speakerProvider !== current.speakerProvider || snapshot.targetSpeechProvider !== current.targetSpeechProvider) throw new AppError('CAPABILITY_UNAVAILABLE', '声音策略已更新，请由前台开始新会话。', 409);
    return { snapshot, provider: selectSpeakerProvider(snapshot.speakerProvider, this.environment, this.appEnv), extraction: selectTargetSpeechProvider(snapshot.targetSpeechProvider || 'disabled', this.environment, this.appEnv) };
  }
  view(s: SessionRow): SpeakerFocusView {
    const f = this.focus(s.id); let capabilities: SpeakerFocusView['capabilities'] = null, enabled = false;
    try { const policy = this.policy(s); capabilities = policy.provider.capabilities; enabled = true; } catch (e) { if (!(e instanceof AppError)) throw e; }
    const r = f?.reference_id ? this.repo.get<SpeakerReferenceRow>('SELECT * FROM speaker_references WHERE id=?', f.reference_id) : undefined;
    const counts = this.repo.get<{ accepted: number; rejected: number }>("SELECT COALESCE(sum(accepted),0) accepted,COALESCE(sum(CASE WHEN accepted=0 AND reason<>'awaiting_final' THEN 1 ELSE 0 END),0) rejected FROM speaker_segment_decisions WHERE session_id=? AND focus_version=?", s.id, s.focus_version)!;
    return { state: f?.state || 'idle', enabled, configured: enabled, simulated: enabled || !!f, mode: f?.mode || null, focusVersion: s.focus_version, sessionVersion: s.version, fallback: f?.fallback || 'text', reason: f?.last_reason || (enabled ? 'not_started' : 'not_configured'), reference: r ? { scope: r.scope, status: r.status, quality: f?.quality || r.quality, expiresAt: f!.expires_at } : null, capabilities, pttReady: !!this.repo.get('SELECT id FROM speaker_ptt_permits WHERE session_id=? AND focus_version=? AND consumed_at IS NULL AND expires_at>?', s.id, s.focus_version, new Date().toISOString()), counts: { ...counts, buffered: speakerBufferStats(this.repo, s.id).segments } };
  }
  active(s: SessionRow) {
    const p = this.policy(s), f = this.focus(s.id);
    if (s.status !== 'active' || !f || f.focus_version !== s.focus_version || ['ended', 'idle', 'handoff_pending'].includes(f.state) || f.expires_at <= new Date().toISOString()) throw new AppError('FOCUS_NOT_ACTIVE', '专注对话尚未开始或已结束，请重新确认服务对象。', 409);
    return { ...p, focus: f };
  }
  freshTemporary(s: SessionRow, provider: string) {
    const id = randomUUID(), at = new Date().toISOString(), expiresAt = new Date(Math.min(Date.now() + 5 * 60000, Date.parse(s.expires_at))).toISOString();
    this.repo.run('INSERT INTO speaker_references(id,tenant_id,workspace_id,session_id,scope,label,provider_id,purpose,notice_version,consent_at,expires_at,created_at,environment,app_env) VALUES (?,?,?,?,\'temporary\',\'本次临时参考\',?,\'speaker_focus\',\'speaker-v1\',?,?,?,?,?)', id, s.tenant_id, s.workspace_id, s.id, provider, at, expiresAt, at, this.environment, this.appEnv);
    return this.repo.get<SpeakerReferenceRow>('SELECT * FROM speaker_references WHERE id=?', id)!;
  }
  start(s: SessionRow, input: z.infer<typeof speakerStartInput>) {
    this.reception.version(s, input.version, input.focusVersion); if (s.status !== 'active') throw new AppError('STATE_CONFLICT', '当前已转人工，不能开启自动专注对话。', 409);
    if (this.repo.get<{ n: number }>("SELECT count(*) n FROM outbox_events WHERE aggregate_id=? AND type='speaker.focus_version_changed' AND created_at>?", s.id, new Date(Date.now() - 60000).toISOString())!.n >= 12) throw new AppError('RATE_LIMITED', '声音参考切换过于频繁，请稍后继续。', 429);
    const p = this.policy(s), enrolled = input.mode === 'enrolled' ? this.refs.consume(s, input.useCode!, p.provider.id) : undefined;
    const current = advanceSpeakerFocus(this.repo, s, 'start'); releaseSessionSpeaker(this.repo, current, 'reference_replaced');
    const r = enrolled || this.freshTemporary(current, p.provider.id), at = new Date().toISOString(), expiresAt = new Date(Math.min(Date.parse(current.expires_at), Date.parse(r.expires_at), Date.now() + 5 * 60000)).toISOString();
    this.repo.run("INSERT INTO speaker_focus_sessions(session_id,state,reference_id,mode,provider_id,extraction_id,source_channel_id,focus_version,config_version,fallback,last_reason,expires_at,updated_at) VALUES (?,'acquiring',?,?,?,?,?,?,?,'text','sample_required',?,?) ON CONFLICT(session_id) DO UPDATE SET state='acquiring',reference_id=excluded.reference_id,mode=excluded.mode,provider_id=excluded.provider_id,extraction_id=excluded.extraction_id,source_channel_id=excluded.source_channel_id,focus_version=excluded.focus_version,config_version=excluded.config_version,fallback='text',last_reason='sample_required',usage_target_token=NULL,quality='pending',expires_at=excluded.expires_at,updated_at=excluded.updated_at", current.id, r.id, input.mode, p.provider.id, p.extraction.id, 'terminal:' + current.terminal_id, current.focus_version, p.snapshot.version, expiresAt, at);
    this.repo.event(s.tenant_id, s.workspace_id, s.id, 'speaker.focus_acquiring', this.environment); return this.view(current);
  }
  sample(s: SessionRow, version: number, focusVersion: number, fixture: string) {
    this.reception.version(s, version, focusVersion); const p = this.active(s), f = p.focus;
    if (!['acquiring', 'reacquiring', 'uncertain'].includes(f.state) || !f.reference_id) throw new AppError('STATE_CONFLICT', '当前不需要参考确认，请先选择重新锁定。', 409);
    const r = this.repo.get<SpeakerReferenceRow>('SELECT * FROM speaker_references WHERE id=?', f.reference_id);
    if (!r || !['pending', 'active'].includes(r.status) || r.expires_at <= new Date().toISOString()) throw new AppError('REFERENCE_EXPIRED', '声音参考已失效，请重新开始。', 409);
    const acquired = p.provider.acquire(fixture, f.mode), adequate = acquired.quality === 'adequate';
    if (r.scope === 'temporary') this.repo.run('UPDATE speaker_references SET quality=?,provider_reference=?,target_token=?,status=?,version=version+1 WHERE id=?', acquired.quality, acquired.providerReference, acquired.targetToken, adequate ? 'active' : 'pending', r.id);
    this.repo.run('UPDATE speaker_focus_sessions SET state=?,quality=?,usage_target_token=?,last_reason=?,updated_at=? WHERE session_id=?', adequate ? 'locked' : 'uncertain', acquired.quality, acquired.targetToken, adequate ? 'reference_confirmed_mock' : 'reference_' + acquired.quality, new Date().toISOString(), s.id);
    this.repo.run('UPDATE reception_sessions SET version=version+1,activity_at=? WHERE id=?', new Date().toISOString(), s.id);
    this.repo.event(s.tenant_id, s.workspace_id, s.id, adequate ? 'speaker.focus_locked' : 'speaker.focus_uncertain', this.environment);
    return this.view(this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', s.id)!);
  }
  reacquire(s: SessionRow, version: number, focusVersion: number) {
    if (this.repo.get<{ n: number }>("SELECT count(*) n FROM outbox_events WHERE aggregate_id=? AND type='speaker.focus_version_changed' AND created_at>?", s.id, new Date(Date.now() - 60000).toISOString())!.n >= 12) throw new AppError('RATE_LIMITED', '声音参考切换过于频繁，请稍后继续。', 429);
    this.reception.version(s, version, focusVersion); const old = this.active(s).focus, p = this.policy(s), current = advanceSpeakerFocus(this.repo, s, 'reacquire');
    if (old.mode === 'temporary' && old.reference_id) eraseMockSpeakerReference(this.repo, old.reference_id);
    const r = old.mode === 'temporary' ? this.freshTemporary(current, p.provider.id) : this.repo.get<SpeakerReferenceRow>('SELECT * FROM speaker_references WHERE id=?', old.reference_id!)!;
    this.repo.run("UPDATE speaker_focus_sessions SET state='reacquiring',reference_id=?,usage_target_token=NULL,quality='pending',focus_version=?,last_reason='sample_required',expires_at=?,updated_at=? WHERE session_id=?", r.id, current.focus_version, new Date(Math.min(Date.parse(current.expires_at), Date.parse(r.expires_at), Date.now() + 5 * 60000)).toISOString(), new Date().toISOString(), s.id);
    this.repo.event(s.tenant_id, s.workspace_id, s.id, 'speaker.focus_acquiring', this.environment); return this.view(current);
  }
  release(s: SessionRow, version: number, focusVersion: number, reason = 'participant_released') {
    this.reception.version(s, version, focusVersion); this.active(s); const current = advanceSpeakerFocus(this.repo, s, reason); releaseSessionSpeaker(this.repo, current, reason);
    this.repo.event(s.tenant_id, s.workspace_id, s.id, 'speaker.focus_released', this.environment); return this.view(current);
  }
  fallback(s: SessionRow, version: number, focusVersion: number, mode: 'text' | 'near_field' | 'ptt') {
    this.reception.version(s, version, focusVersion); this.active(s); clearSpeakerBuffer(this.repo, s.id);
    if (mode === 'text') return this.release(s, version, focusVersion, 'text_fallback');
    this.repo.run('UPDATE speaker_focus_sessions SET fallback=?,last_reason=?,updated_at=? WHERE session_id=?', mode, mode === 'ptt' ? 'ptt_confirmation_required' : 'move_closer_then_reacquire', new Date().toISOString(), s.id);
    this.repo.run('UPDATE reception_sessions SET version=version+1 WHERE id=?', s.id); return this.view(this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', s.id)!);
  }
  ptt(s: SessionRow, version: number, focusVersion: number) {
    this.reception.version(s, version, focusVersion); const f = this.active(s).focus;
    if (f.fallback !== 'ptt') throw new AppError('STATE_CONFLICT', '请先选择按键回退模式。', 409);
    this.repo.run('DELETE FROM speaker_ptt_permits WHERE session_id=?', s.id); const at = new Date().toISOString();
    this.repo.run('INSERT INTO speaker_ptt_permits VALUES (?,?,?,?,NULL,?)', randomUUID(), s.id, s.focus_version, new Date(Math.min(Date.now() + 10000, Date.parse(f.expires_at))).toISOString(), at);
    this.repo.run('UPDATE reception_sessions SET version=version+1 WHERE id=?', s.id); return this.view(this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', s.id)!);
  }
  handoff(s: SessionRow, version: number, focusVersion: number) {
    this.reception.version(s, version, focusVersion); const policy = this.policy(s);
    if (s.status !== 'active') throw new AppError('STATE_CONFLICT', '请由工作人员处理人工接管中的交接。', 409);
    const p = { tenantId: s.tenant_id, userId: 'guest:' + s.id, role: 'viewer' as const, workspaceIds: [s.workspace_id] };
    if (s.profile_snapshot) { const profile = JSON.parse(s.profile_snapshot); assertUsableAsset(this.repo.asset(p, profile.avatarAssetId)); if (profile.voiceAssetId) assertUsableAsset(this.repo.asset(p, profile.voiceAssetId)); }
    this.reception.end(s, 'speaker_participant_handoff');
    const id = randomUUID(), at = new Date().toISOString(), expiresAt = new Date(Date.now() + (s.service_scene==='restaurant'?6*3600000:15*60000)).toISOString();
    this.repo.run("INSERT INTO reception_sessions(id,tenant_id,workspace_id,terminal_id,track_hash,status,source,environment,app_env,created_at,activity_at,expires_at,profile_snapshot,scene_app_snapshot) VALUES (?,?,?,?,?,'active','manual',?,?,?,?,?,?,?)", id, s.tenant_id, s.workspace_id, s.terminal_id, 'manual:' + id, s.environment, s.app_env, at, at, expiresAt, s.profile_snapshot, s.scene_app_snapshot);
    this.repo.run('UPDATE reception_sessions SET service_scene=? WHERE id=?',s.service_scene,id);
    this.repo.run("INSERT INTO speaker_focus_sessions(session_id,state,reference_id,mode,provider_id,extraction_id,source_channel_id,focus_version,config_version,fallback,last_reason,expires_at,updated_at) VALUES (?,'handoff_pending',NULL,'temporary',?,?,?,0,?,'text','next_visitor_confirmation_required',?,?)", id, policy.provider.id, policy.extraction.id, 'terminal:' + s.terminal_id, policy.snapshot.version, expiresAt, at);
    this.repo.run('UPDATE reception_terminals SET version=version+1 WHERE id=?', s.terminal_id);
    this.reception.addMessage(id, 'system', '已开启下一位的独立匿名接待。请本人确认服务对象后再开启专注对话。', 'received', 0, 0);
    this.repo.event(s.tenant_id, s.workspace_id, id, 'speaker.focus_changed', this.environment);
    return { sessionId: id, terminalUrl: '/terminal/' + id };
  }
  event(s: SessionRow, input: z.infer<typeof speakerEventInput>, requestId: string) {
    const at = Date.now(); if (s.focus_version !== input.focusVersion) return { accepted: false, reason: 'stale_focus', interrupted: false };
    const p = this.active(s), f = p.focus;
    if (this.repo.get<{ n: number }>('SELECT count(*) n FROM speaker_segment_decisions WHERE session_id=? AND created_at>?', s.id, new Date(Date.now() - 60000).toISOString())!.n >= 500) throw new AppError('RATE_LIMITED', '模拟事件过于频繁，请稍后继续。', 429);
    const previous = this.repo.get<{ sequence: number; final: number }>('SELECT sequence,final FROM speaker_segment_decisions WHERE session_id=? AND focus_version=? AND segment_id=? ORDER BY sequence DESC LIMIT 1', s.id, s.focus_version, input.segmentId);
    if (previous && (previous.final || previous.sequence >= input.sequence)) return { accepted: false, reason: 'duplicate_or_out_of_order', interrupted: false };
    const d = p.provider.decide(input.fixture), extraction = p.extraction.extract(input.fixture); let reason = d.reason, accepted = false, interrupted = false, buffered = false;
    if (d.trackingLost) { clearSpeakerBuffer(this.repo, s.id); this.repo.run("UPDATE speaker_focus_sessions SET state='uncertain',last_reason='tracking_lost',updated_at=? WHERE session_id=?", new Date().toISOString(), s.id); reason = 'tracking_lost'; }
    else if (f.fallback === 'ptt' && !d.requiresPtt) reason = 'ptt_confirmation_required';
    else if (d.requiresPtt) {
      const permit = this.repo.get<{ id: string }>('SELECT id FROM speaker_ptt_permits WHERE session_id=? AND focus_version=? AND consumed_at IS NULL AND expires_at>?', s.id, s.focus_version, new Date().toISOString());
      if (f.fallback === 'ptt' && permit && input.text.trim()) { this.repo.run('UPDATE speaker_ptt_permits SET consumed_at=? WHERE id=?', new Date().toISOString(), permit.id); accepted = true; reason = 'ptt_target_confirmed_mock'; } else reason = 'ptt_confirmation_required';
    } else if (f.state !== 'locked' || !f.usage_target_token) reason = 'focus_not_locked';
    else if (d.speechStarted) {
      if (d.attribution === 'target' && p.provider.capabilities.targetBargeIn) {
        interrupted = !!this.repo.get("SELECT id FROM reception_messages WHERE session_id=? AND status IN ('playing','ready') AND role='assistant'", s.id);
        this.reception.cancelReplies(s); cancelVisualRequests(this.repo, s.id); this.repo.run('UPDATE reception_sessions SET reply_epoch=reply_epoch+1,version=version+1 WHERE id=?', s.id); reason = 'target_barge_in_mock';
      } else reason = d.attribution === 'other' ? 'non_target_speech' : 'early_attribution_unavailable';
    } else if (!d.final) {
      if (d.attribution === 'other') { clearSpeakerBuffer(this.repo, s.id, input.segmentId); reason = 'non_target_partial'; } else { buffered = stageSpeakerPartial(this.repo, s, input.segmentId, input.text); reason = buffered ? 'awaiting_final' : 'partial_buffer_limit'; }
    } else if (!extraction.usable) {
      reason = extraction.reason; if (['overlap_final', 'uncertain_final'].includes(input.fixture)) { clearSpeakerBuffer(this.repo, s.id); this.repo.run("UPDATE speaker_focus_sessions SET state='uncertain',last_reason=?,updated_at=? WHERE session_id=?", reason, new Date().toISOString(), s.id); }
    } else if (d.attribution !== 'target') reason = 'non_target_final';
    else if (!input.text.trim()) reason = 'empty_final';
    else { accepted = true; reason = 'target_final_confirmed_mock'; }
    if (d.final || d.trackingLost) clearSpeakerBuffer(this.repo, s.id, d.trackingLost ? undefined : input.segmentId);
    const decisionId = randomUUID();
    this.repo.run('INSERT INTO speaker_segment_decisions(id,session_id,focus_version,segment_id,sequence,fixture,attribution,final,accepted,interrupted,reason,elapsed_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', decisionId, s.id, s.focus_version, input.segmentId, input.sequence, input.fixture, accepted ? 'target' : d.attribution, +d.final, +accepted, +interrupted, reason, Date.now() - at, new Date().toISOString());
    if (accepted) {
      const current = this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', s.id)!;
      interrupted = !!this.repo.get("SELECT id FROM reception_messages WHERE session_id=? AND status='playing' AND role='assistant'", s.id) || interrupted;
      try { new ReceptionConversation(this.repo, this.environment, this.appEnv).consume(current, input.text.trim(), requestId, decisionId); }
      catch (e) { if (!(e instanceof AppError) || !['RATE_LIMITED', 'QUOTA_EXCEEDED'].includes(e.code)) throw e; accepted = false; interrupted = false; reason = e.code.toLowerCase(); this.repo.run('UPDATE speaker_segment_decisions SET accepted=0,reason=? WHERE id=?', reason, decisionId); }
      this.repo.run('UPDATE speaker_segment_decisions SET interrupted=? WHERE id=?', +interrupted, decisionId);
    }
    this.repo.audit({ tenantId: s.tenant_id, userId: 'speaker-simulator:' + s.id, role: 'viewer', workspaceIds: [s.workspace_id] }, s.workspace_id, accepted ? 'speaker.segment_accepted_mock' : 'speaker.segment_filtered', decisionId, requestId, reason);
    return { accepted, buffered, interrupted, reason, decisionId, focusVersion: s.focus_version, simulated: true };
  }
}
