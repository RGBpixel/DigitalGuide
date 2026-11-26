import { clearSpeakerBuffer } from './speaker-lifecycle.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, requireWorkspace, type Principal } from '@digitalguide/domain';
import { personSettingsInput, memoryProposeInput, memoryDecisionInput, memoryNoteInput, type MemoryView, type MemoryPerson, type MemoryFact, type MemoryNote, type PrivacyReceipt } from '@digitalguide/contracts';
import type { SessionRow } from './reception-service.js';
import { VisitService } from './visit-service.js';

export interface PersonRow {
  id: string; tenant_id: string; workspace_id: string; owner_user_id: string | null; guest_session_id: string | null;
  display_name: string; roles: string; identity_kind: MemoryPerson['identity']; status: string; version: number;
  personalization: number; do_not_disturb: number; quiet_start: string; quiet_end: string; cooldown_minutes: number;
  last_greeted_at: string | null; consent_at: string; expires_at: string; created_at: string;
}
interface FactRow { id: string; person_id: string; fact_key: MemoryFact['key']; value: string; source_kind: MemoryFact['sourceKind']; source_session_id: string | null; source_message_id: string | null; visibility: MemoryFact['visibility']; status: MemoryFact['status']; version: number; expires_at: string; confirmed_at: string | null; created_at: string }
interface NoteRow { id: string; person_id: string; kind: MemoryNote['kind']; text: string; source_session_id: string | null; source_message_ids: string; status: MemoryNote['status']; version: number; expires_at: string }
const future = (days: number, now = Date.now()) => new Date(now + days * 86400000).toISOString();
export class MemoryService {
  constructor(public repo: Repository, public environment: string, public appEnv: string) {}
  active(row: PersonRow | undefined): PersonRow {
    if (!row || row.status !== 'active' || row.expires_at <= new Date().toISOString()) throw new AppError('NOT_FOUND', '资料不存在、已到期或不属于本人。', 404);
    return row;
  }
  self(p: Principal, workspaceId: string) {
    requireWorkspace(p, workspaceId);
    return this.repo.get<PersonRow>("SELECT * FROM people WHERE tenant_id=? AND workspace_id=? AND owner_user_id=? AND status='active' AND environment=? AND app_env=?", p.tenantId, workspaceId, p.userId, this.environment, this.appEnv);
  }
  owned(p: Principal, personId: string) {
    const row = this.active(this.repo.get<PersonRow>("SELECT * FROM people WHERE id=? AND tenant_id=? AND owner_user_id=? AND environment=? AND app_env=?", personId, p.tenantId, p.userId, this.environment, this.appEnv));
    requireWorkspace(p, row.workspace_id); return row;
  }
  guest(session: SessionRow) {
    const row = this.repo.get<PersonRow>("SELECT p.* FROM people p JOIN memory_session_links l ON l.person_id=p.id WHERE l.session_id=? AND l.focus_version=? AND p.tenant_id=? AND p.workspace_id=? AND p.status='active' AND p.environment=? AND p.app_env=?", session.id, session.focus_version, session.tenant_id, session.workspace_id, this.environment, this.appEnv);
    return row?.expires_at && row.expires_at > new Date().toISOString() ? row : undefined;
  }
  version(row: { version: number }, version: number) { if (row.version !== version) throw new AppError('VERSION_CONFLICT', '资料已更新，请重新载入后核对。', 409); }
  invalidate(personId: string, sessionId?: string | null) {
    if (!personId) throw new Error('A non-empty privacy subject is required');
    this.repo.run("UPDATE idempotency SET response='{}',redacted=1 WHERE instr(response,?)>0", personId);
    if (sessionId) this.repo.run("UPDATE idempotency SET response='{}',redacted=1 WHERE instr(response,?)>0 OR instr(action,?)>0", sessionId, '/sessions/' + sessionId);
  }
  touch(row: PersonRow, event: string) {
    this.invalidate(row.id, row.guest_session_id);
    const affected = this.repo.all<{ session_id: string }>("SELECT DISTINCT session_id FROM reception_messages WHERE memory_person_id=? AND status IN ('ready','playing')", row.id);
    this.repo.run("UPDATE reception_messages SET text='相关个人资料已更新，旧回复已清除。',status='cancelled' WHERE memory_person_id=?", row.id);
    for (const item of affected) this.repo.run("UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=? AND status IN ('active','human')", item.session_id);
    this.repo.run('UPDATE people SET version=version+1,updated_at=? WHERE id=?', new Date().toISOString(), row.id);
    this.repo.event(row.tenant_id, row.workspace_id, row.id, event, this.environment);
  }
  enroll(input: { displayName: string; roles: string[]; retentionDays: number }, p: Principal, session?: SessionRow) {
    if (session && this.repo.get("SELECT id FROM people WHERE guest_session_id=? AND status='active'", session.id)) throw new AppError('STATE_CONFLICT', '本次会话已有资料或服务对象已变化，请联系前台处理，不能沿用旧资料。', 409);
    const now = new Date().toISOString(), personId = randomUUID();
    this.repo.run('INSERT INTO people(id,tenant_id,workspace_id,owner_user_id,guest_session_id,display_name,roles,identity_kind,notice_version,consent_at,expires_at,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      personId, p.tenantId, p.workspaceIds[0], session ? null : p.userId, session?.id || null, input.displayName,
      JSON.stringify([...new Set([...(session ? [] : ['employee']), ...input.roles])]), session ? 'self_reported' : 'account_verified',
      'memory-v1', now, future(input.retentionDays), this.environment, this.appEnv, now, now);
    if (session) this.repo.run('INSERT INTO memory_session_links(session_id,person_id,focus_version,consent_at,transcript_expires_at) VALUES (?,?,?,?,?)', session.id, personId, session.focus_version, now, future(30));
    this.repo.event(p.tenantId, p.workspaceIds[0], personId, 'person.enrolled', this.environment);
    return this.active(this.repo.get<PersonRow>('SELECT * FROM people WHERE id=?', personId));
  }
  person(row: PersonRow): MemoryPerson {
    return { id: row.id, workspaceId: row.workspace_id, displayName: row.display_name, roles: JSON.parse(row.roles), identity: row.identity_kind, version: row.version, personalization: !!row.personalization, doNotDisturb: !!row.do_not_disturb, quietStart: row.quiet_start, quietEnd: row.quiet_end, cooldownMinutes: row.cooldown_minutes, expiresAt: row.expires_at, consentAt: row.consent_at, noticeVersion: 'memory-v1' };
  }
  facts(personId: string): MemoryFact[] {
    return this.repo.all<FactRow>('SELECT * FROM memory_facts WHERE person_id=? ORDER BY created_at,id', personId).map(f => ({ id: f.id, personId: f.person_id, key: f.fact_key, value: f.value, sourceKind: f.source_kind, sourceSessionId: f.source_session_id, sourceMessageId: f.source_message_id, visibility: f.visibility, status: f.status, version: f.version, expiresAt: f.expires_at, confirmedAt: f.confirmed_at, createdAt: f.created_at }));
  }
  notes(personId: string): MemoryNote[] {
    return this.repo.all<NoteRow>('SELECT * FROM memory_notes WHERE person_id=? ORDER BY created_at,id', personId).map(n => ({ id: n.id, personId: n.person_id, kind: n.kind, text: n.text, sourceSessionId: n.source_session_id, sourceMessageIds: JSON.parse(n.source_message_ids), status: n.status, version: n.version, expiresAt: n.expires_at }));
  }
  view(row?: PersonRow): MemoryView { return row ? { person: this.person(this.active(this.repo.get<PersonRow>('SELECT * FROM people WHERE id=?', row.id))), facts: this.facts(row.id), notes: this.notes(row.id) } : { person: null, facts: [], notes: [] }; }
  settings(row: PersonRow, input: z.infer<typeof personSettingsInput>) {
    this.version(row, input.version);
    this.repo.run('UPDATE people SET display_name=?,roles=?,personalization=?,do_not_disturb=?,quiet_start=?,quiet_end=?,cooldown_minutes=? WHERE id=?',
      input.displayName, JSON.stringify([...new Set([...(row.owner_user_id ? ['employee'] : []), ...input.roles])]), +input.personalization, +input.doNotDisturb, input.quietStart, input.quietEnd, input.cooldownMinutes, row.id);
    this.touch(row, 'person.settings_changed');
  }
  source(row: PersonRow, messageId: string, session?: SessionRow) {
    if (!session || session.id !== row.guest_session_id || this.guest(session)?.id !== row.id) throw new AppError('INVALID_SOURCE', '来源不属于当前本人会话。', 409);
    const message = this.repo.get<{ text: string; input_source: string; speaker_decision_id: string | null }>("SELECT text,input_source,speaker_decision_id FROM reception_messages WHERE id=? AND session_id=? AND tenant_id=? AND workspace_id=? AND role='visitor' AND focus_version=?", messageId, session.id, row.tenant_id, row.workspace_id, session.focus_version);
    if (!message) throw new AppError('INVALID_SOURCE', '只能选择当前发问人已接收的文字，不能使用旁人、旧目标或系统回复。', 409);
    if (message.input_source === 'verified_mock_audio' && !this.repo.get("SELECT id FROM speaker_segment_decisions WHERE id=? AND session_id=? AND focus_version=? AND attribution='target' AND final=1 AND accepted=1", message.speaker_decision_id, session.id, session.focus_version)) throw new AppError('INVALID_SOURCE', '该字幕没有当前目标的最终确认。', 409);
    return message;
  }
  propose(row: PersonRow, input: z.infer<typeof memoryProposeInput>, session?: SessionRow) {
    const now = new Date().toISOString();
    if (input.expiresAt <= now || input.expiresAt > row.expires_at) throw new AppError('INVALID_EXPIRY', '记忆有效期不能超过本人授权期限，且须晚于当前时间。', 400);
    if (this.repo.get<{ n: number }>('SELECT count(*) AS n FROM memory_facts WHERE person_id=?', row.id)!.n >= 100) throw new AppError('QUOTA_EXCEEDED', '本档案最多保留 100 条记忆，请先清理旧条目。', 409);
    if (input.sourceMessageId && !this.source(row, input.sourceMessageId, session).text.includes(input.value)) throw new AppError('INVALID_SOURCE', '会话来源没有包含这项声明，请选用原文或改为本人填写。', 409);
    const factId = randomUUID();
    this.repo.run('INSERT INTO memory_facts(id,person_id,tenant_id,workspace_id,fact_key,value,source_kind,source_session_id,source_message_id,source_focus_version,visibility,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      factId, row.id, row.tenant_id, row.workspace_id, input.key, input.value, input.sourceMessageId ? (this.source(row, input.sourceMessageId, session).input_source === 'verified_mock_audio' ? 'verified_mock_audio' : 'session_text') : 'self_statement', session?.id || null, input.sourceMessageId || null, session?.focus_version ?? null, input.visibility, input.expiresAt, now, now);
    this.touch(row, 'memory.proposed'); return factId;
  }
  decide(row: PersonRow, input: z.infer<typeof memoryDecisionInput>) {
    const fact = this.repo.get<FactRow>('SELECT * FROM memory_facts WHERE id=? AND person_id=?', input.factId, row.id);
    if (!fact) throw new AppError('NOT_FOUND', '记忆条目不存在或无权访问。', 404);
    this.version(fact, input.version);
    if (fact.expires_at <= new Date().toISOString() || ['expired', 'revoked', 'rejected'].includes(fact.status)) throw new AppError('STATE_CONFLICT', '此记忆已失效，请重新提交候选。', 409);
    if (input.action === 'confirm' && fact.status !== 'pending') throw new AppError('STATE_CONFLICT', '只有待确认记忆可以确认。', 409);
    if (input.action === 'correct' && !input.value) throw new AppError('VALIDATION_FAILED', '请输入纠正后的内容，修改后需重新确认。', 400);
    this.repo.run('DELETE FROM memory_lookup WHERE fact_id=?', fact.id);
    const status = input.action === 'confirm' ? 'confirmed' : input.action === 'correct' ? 'pending' : input.action === 'reject' ? 'rejected' : 'revoked';
    const value = input.action === 'correct' ? input.value! : ['reject', 'revoke'].includes(input.action) ? '' : fact.value;
    this.repo.run('UPDATE memory_facts SET status=?,value=?,version=version+1,confirmed_at=?,source_kind=?,source_message_id=?,updated_at=? WHERE id=?',
      status, value, status === 'confirmed' ? new Date().toISOString() : null, input.action === 'correct' ? 'self_statement' : fact.source_kind, input.action === 'correct' ? null : fact.source_message_id, new Date().toISOString(), fact.id);
    if (status === 'confirmed') this.repo.run('INSERT INTO memory_lookup VALUES (?,?,?)', fact.id, row.id, value);
    this.touch(row, 'memory.' + input.action);
  }
  note(row: PersonRow, input: z.infer<typeof memoryNoteInput>, session?: SessionRow) {
    for (const messageId of input.sourceMessageIds) this.source(row, messageId, session);
    if (this.repo.get<{ n: number }>('SELECT count(*) AS n FROM memory_notes WHERE person_id=?', row.id)!.n >= 100) throw new AppError('QUOTA_EXCEEDED', '摘要与待办最多保留 100 项，请先清理。', 409);
    const noteId = randomUUID(), expiresAt = [future(30), row.expires_at].sort()[0];
    this.repo.run('INSERT INTO memory_notes(id,person_id,tenant_id,workspace_id,kind,text,source_session_id,source_message_ids,source_focus_version,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      noteId, row.id, row.tenant_id, row.workspace_id, input.kind, input.text, session?.id || null, JSON.stringify([...new Set(input.sourceMessageIds)]), session?.focus_version ?? null, expiresAt, new Date().toISOString());
    this.touch(row, 'memory.note_created');
  }
  noteControl(row: PersonRow, input: { noteId: string; version: number; action: 'complete' | 'delete' }) {
    const note = this.repo.get<NoteRow>('SELECT * FROM memory_notes WHERE id=? AND person_id=?', input.noteId, row.id);
    if (!note) throw new AppError('NOT_FOUND', '摘要或待办不存在。', 404); this.version(note, input.version);
    if (input.action === 'delete') this.repo.run('DELETE FROM memory_notes WHERE id=?', note.id);
    else { if (note.kind !== 'todo' || note.status !== 'open') throw new AppError('STATE_CONFLICT', '只有未完成待办可以标为完成。', 409); this.repo.run("UPDATE memory_notes SET status='completed',version=version+1 WHERE id=?", note.id); }
    this.touch(row, 'memory.note_' + input.action);
  }
  lookup(row: PersonRow, query: string) {
    if (!row.personalization || row.expires_at <= new Date().toISOString()) return [];
    return this.repo.all<{ id: string; key: string; value: string }>("SELECT f.id,f.fact_key AS key,f.value FROM memory_lookup l JOIN memory_facts f ON f.id=l.fact_id WHERE l.person_id=? AND f.person_id=? AND f.tenant_id=? AND f.workspace_id=? AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>? AND instr(l.value,?)>0 ORDER BY f.created_at LIMIT 20", row.id, row.id, row.tenant_id, row.workspace_id, new Date().toISOString(), query);
  }
  greet(row: PersonRow, now = new Date()) {
    const timezone = (row.guest_session_id ? this.repo.get<{ timezone: string }>('SELECT v.timezone FROM reception_sessions s JOIN reception_terminals t ON t.id=s.terminal_id JOIN venues v ON v.id=t.venue_id WHERE s.id=?', row.guest_session_id) : this.repo.get<{ timezone: string }>('SELECT timezone FROM venues WHERE workspace_id=? LIMIT 1', row.workspace_id))?.timezone || 'Asia/Shanghai';
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const quiet = row.quiet_start === row.quiet_end || (row.quiet_start < row.quiet_end ? clock >= row.quiet_start && clock < row.quiet_end : clock >= row.quiet_start || clock < row.quiet_end);
    const reason = !row.personalization ? 'disabled' : row.do_not_disturb ? 'do_not_disturb' : quiet ? 'quiet_hours' : row.last_greeted_at && Date.parse(row.last_greeted_at) + row.cooldown_minutes * 60000 > now.getTime() ? 'cooldown' : null;
    if (reason) return { allowed: false, reason, text: null };
    const nickname = this.lookup(row, '').find(f => f.key === 'nickname')?.value;
    // Only an explicitly public nickname is used. Preferences/private reminders are never spoken here.
    const text = nickname ? nickname + '，您好。现在有什么可以帮您？' : '您好，现在方便交流吗？';
    this.repo.run('UPDATE people SET last_greeted_at=? WHERE id=?', now.toISOString(), row.id); this.touch(row, 'person.greeting_requested');
    return { allowed: true, reason: null, text };
  }
  export(row: PersonRow) {
    const sessions = this.repo.all<{ id: string; role: string; text: string; sessionId: string; createdAt: string }>('SELECT m.id,m.role,m.text,m.session_id AS sessionId,m.created_at AS createdAt FROM reception_messages m JOIN memory_session_links l ON l.session_id=m.session_id AND l.focus_version=m.focus_version WHERE l.person_id=? AND m.tenant_id=? AND m.workspace_id=? ORDER BY m.created_at,m.rowid', row.id, row.tenant_id, row.workspace_id);
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), ...this.view(row), transcript: sessions, exclusions: ['其他人员资料', '受访人内部备注', '登录凭据'] };
  }
  invalidateSessionCache(sessionId: string) {
    this.repo.run("UPDATE idempotency SET response='{}',redacted=1 WHERE instr(response,?)>0 OR instr(action,?)>0", sessionId, '/sessions/' + sessionId);
  }
  erase(row: PersonRow, reason = 'owner_request'): PrivacyReceipt {
    const requestId = randomUUID(), now = new Date().toISOString();
    this.repo.run('DELETE FROM memory_lookup WHERE person_id=?', row.id);
    this.repo.run('DELETE FROM memory_facts WHERE person_id=?', row.id); this.repo.run('DELETE FROM memory_notes WHERE person_id=?', row.id);
    const bindings = this.repo.all<{ session_id: string; focus_version: number }>('SELECT session_id,focus_version FROM memory_session_links WHERE person_id=?', row.id);
    for (const binding of bindings) {
      const sessionId = binding.session_id, session = this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', sessionId);
      if (session) { const visits = new VisitService(this.repo, this.environment, this.appEnv), visit = visits.bySession(session); if (visit && visit.focus_version === binding.focus_version && !['completed', 'cancelled', 'declined'].includes(visit.status)) visits.escalate(visit, 'personal_data_removed'); }
      clearSpeakerBuffer(this.repo, sessionId);
      this.repo.run('DELETE FROM conversation_tool_requests WHERE reply_id IN (SELECT id FROM reception_messages WHERE session_id=? AND (focus_version=? OR memory_person_id=?))', sessionId, binding.focus_version, row.id);
      this.repo.run('DELETE FROM reception_messages WHERE session_id=? AND (focus_version=? OR memory_person_id=?)', sessionId, binding.focus_version, row.id);
      this.repo.run("UPDATE visits SET guest_name='已删除资料',company='',purpose='',appointment_ref='',host_private_note=NULL,confirmed_hash=NULL,version=version+1 WHERE session_id=? AND focus_version=?", sessionId, binding.focus_version);
      this.invalidateSessionCache(sessionId);
    }
    this.repo.run("UPDATE memory_recovery_credentials SET token_hash='',revoked_at=COALESCE(revoked_at,?) WHERE person_id=?", now, row.id);
    this.invalidate(row.id);
    this.repo.run('DELETE FROM memory_session_links WHERE person_id=?', row.id);
    this.repo.run('DELETE FROM memory_session_greetings WHERE person_id=?', row.id);
    this.repo.run("UPDATE people SET display_name='已删除资料',roles='[]',owner_user_id=NULL,guest_session_id=NULL,status='deleted',personalization=0,last_greeted_at=NULL,version=version+1,updated_at=? WHERE id=?", now, row.id);
    this.repo.run('INSERT INTO privacy_requests VALUES (?,?,?,?,?,?,?,?,?)', requestId, row.id, row.tenant_id, row.workspace_id, reason, 'completed', now, 'not_applicable', now);
    this.repo.event(row.tenant_id, row.workspace_id, requestId, 'privacy.local_completed', this.environment);
    return { requestId, status: 'completed', local: 'completed', external: 'not_applicable', retained: ['不含原文的审计及删除回执编号', '来访与通知的最小状态记录（如有）'] };
  }
  sweep(now = new Date()) {
    const stamp = now.toISOString();
    this.repo.run("UPDATE memory_recovery_credentials SET revoked_at=COALESCE(revoked_at,?),token_hash='' WHERE environment=? AND app_env=? AND expires_at<=? AND token_hash<>''", stamp, this.environment, this.appEnv, stamp);
    const people = this.repo.all<PersonRow>("SELECT * FROM people WHERE status='active' AND environment=? AND app_env=? AND expires_at<=?", this.environment, this.appEnv, stamp);
    for (const row of people) this.erase(row, 'retention_expired');
    const expired = this.repo.all<{ id: string; person_id: string }>("SELECT f.id,f.person_id FROM memory_facts f JOIN people p ON p.id=f.person_id WHERE p.environment=? AND p.app_env=? AND f.expires_at<=? AND f.status IN ('pending','confirmed')", this.environment, this.appEnv, stamp);
    for (const fact of expired) { this.repo.run('DELETE FROM memory_lookup WHERE fact_id=?', fact.id); this.repo.run("UPDATE memory_facts SET value='',status='expired',version=version+1 WHERE id=?", fact.id); this.invalidate(fact.person_id); }
    const notes = this.repo.all<{ id: string; person_id: string }>('SELECT n.id,n.person_id FROM memory_notes n JOIN people p ON p.id=n.person_id WHERE p.environment=? AND p.app_env=? AND n.expires_at<=?', this.environment, this.appEnv, stamp);
    for (const note of notes) { this.repo.run('DELETE FROM memory_notes WHERE id=?', note.id); this.invalidate(note.person_id); }
    const stale = this.repo.all<{ session_id: string }>("SELECT DISTINCT m.session_id FROM reception_messages m JOIN reception_sessions s ON s.id=m.session_id LEFT JOIN memory_session_links l ON l.session_id=s.id WHERE s.environment=? AND s.app_env=? AND ((l.session_id IS NULL AND m.created_at<=?) OR l.transcript_expires_at<=?)", this.environment, this.appEnv, new Date(now.getTime() - 86400000).toISOString(), stamp);
    for (const s of stale) { clearSpeakerBuffer(this.repo, s.session_id); this.repo.run('DELETE FROM conversation_tool_requests WHERE session_id=?', s.session_id); this.repo.run('DELETE FROM reception_messages WHERE session_id=?', s.session_id); this.invalidateSessionCache(s.session_id); }
    const oldVisits = this.repo.all<{ id: string; session_id: string }>("SELECT v.id,v.session_id FROM visits v JOIN reception_sessions s ON s.id=v.session_id WHERE s.environment=? AND s.app_env=? AND v.created_at<=? AND v.guest_name<>'已删除资料'", this.environment, this.appEnv, new Date(now.getTime() - 30 * 86400000).toISOString());
    for (const visit of oldVisits) {
      this.repo.run("UPDATE visits SET guest_name='已删除资料',company='',purpose='',appointment_ref='',host_private_note=NULL,confirmed_hash=NULL,version=version+1 WHERE id=?", visit.id);
      this.repo.run("UPDATE visit_deliveries SET status='cancelled',version=version+1 WHERE visit_id=? AND status='queued'", visit.id);
      this.invalidateSessionCache(visit.session_id);
    }
    return { people: people.length, facts: expired.length, notes: notes.length, transcripts: stale.length, visits: oldVisits.length };
  }
}

