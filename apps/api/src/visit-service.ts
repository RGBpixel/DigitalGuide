import { createHash, randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError, canonical, requirePermission, requireWorkspace, type Principal } from '@digitalguide/domain';
import type { InternalVisit, Visit } from '@digitalguide/contracts';
import type { SessionRow } from './reception-service.js';

export interface VisitRow { id: string; tenant_id: string; workspace_id: string; venue_id: string; session_id: string; host_id: string | null; host_name: string; guest_name: string; company: string; purpose: string; appointment_ref: string; status: Visit['status']; version: number; focus_version: number; confirmed_hash: string | null; confirmed_at: string | null; host_deadline: string | null; responded_by: string | null; host_private_note: string | null; guidance_code: string | null; escalated_reason: string | null; completed_at: string | null; mock_scenario: 'normal' | 'failed' | 'unknown'; created_at: string; updated_at: string }
export interface HostRow { id: string; user_id: string; tenant_id: string; workspace_id: string; public_name: string; enabled: number }
export interface DeliveryRow { id: string; visit_id: string; tenant_id: string; workspace_id: string; recipient_user_id: string; environment: string; app_env: string; status: NonNullable<Visit['delivery']>['status']; version: number; scenario: 'normal' | 'failed' | 'unknown'; attempts: number; lease_token: string | null; lease_until: string | null; remote_id: string | null; error_code: string | null }
export const guidance = {
  front_desk: '请在前台等候，由工作人员与您会合。',
  waiting_area: '请前往一层访客等候区，接待人会到现场迎接。',
  meeting_a: '请先到前台领取访客指引，由工作人员陪同前往演示会议室 A。'
};
export class VisitService {
  constructor(public repo: Repository, public environment: string, public appEnv: string) {}
  bySession(session: SessionRow) { return this.repo.get<VisitRow>('SELECT * FROM visits WHERE session_id=? AND tenant_id=? AND workspace_id=?', session.id, session.tenant_id, session.workspace_id); }
  row(id: string): VisitRow {
    const row = this.repo.get<VisitRow>('SELECT v.* FROM visits v JOIN reception_sessions s ON s.id=v.session_id WHERE v.id=? AND s.environment=? AND s.app_env=?', id, this.environment, this.appEnv);
    if (!row) throw new AppError('NOT_FOUND', '来访记录不存在或不在当前环境。', 404); return row;
  }
  host(row: VisitRow): HostRow | undefined { return row.host_id ? this.repo.get<HostRow>('SELECT * FROM reception_hosts WHERE id=? AND tenant_id=? AND workspace_id=?', row.host_id, row.tenant_id, row.workspace_id) : undefined; }
  availableHost(host: HostRow | undefined) {
    if (!host?.enabled) return false;
    try { const p = this.repo.principal(host.user_id); requirePermission(p, 'visit.respond'); return p.tenantId === host.tenant_id && p.workspaceIds.includes(host.workspace_id); } catch { return false; }
  }
  confirmedRecipient(row: VisitRow) { return this.repo.get<{ user_id: string | null }>('SELECT user_id FROM visit_confirmation_targets WHERE visit_id=?', row.id)?.user_id || null; }
  delivery(visitId: string) { return this.repo.get<DeliveryRow>('SELECT * FROM visit_deliveries WHERE visit_id=? AND environment=? AND app_env=?', visitId, this.environment, this.appEnv); }
  scoped(p: Principal, visitId: string, ownOnly = false) {
    const row = this.row(visitId);
    if (row.tenant_id !== p.tenantId) throw new AppError('NOT_FOUND', '来访记录不存在或无权访问。', 404);
    requireWorkspace(p, row.workspace_id);
    if (ownOnly) {
      requirePermission(p, 'visit.respond');
      if (this.confirmedRecipient(row) !== p.userId) throw new AppError('NOT_FOUND', '此接待请求不属于当前账号。', 404);
    } else requirePermission(p, 'visit.manage');
    return row;
  }
  hash(row: VisitRow) { return createHash('sha256').update(canonical({ guestName: row.guest_name, company: row.company, purpose: row.purpose, appointmentRef: row.appointment_ref, hostName: row.host_name, hostId: row.host_id, recipientRef: this.host(row)?.user_id || null, sessionId: row.session_id, focusVersion: row.focus_version })).digest('hex'); }
  version(row: VisitRow, version: number) { if (row.version !== version) throw new AppError('VERSION_CONFLICT', '来访内容或处理状态已更新，请刷新后重新确认。', 409); }
  focus(row: VisitRow, session: SessionRow, focusVersion: number) {
    if (focusVersion !== session.focus_version || row.focus_version !== session.focus_version) throw new AppError('VERSION_CONFLICT', '服务对象或接管状态已切换，旧的来访确认已失效。', 409);
  }
  publicView(row: VisitRow): Visit {
    const delivery = this.delivery(row.id);
    const messages: Record<Visit['status'], string> = { draft: '请核对您的来访资料。', awaiting_confirmation: '资料仅为本人自述，核对后再确认通知接待人。', notifying: delivery ? '模拟通知正在排队或提交，尚未得到接待人同意。' : '登记已确认，尚未提交通知。', waiting_host: '模拟渠道已接受通知请求，正在等待接待人回复。', accepted: '接待人已明确同意本次来访，请按指引行动。', declined: '接待人暂时无法接待，请联系前台工作人员。', escalated: '本次接待需要工作人员协助，系统没有代替接待人表示同意。', completed: '本次来访处理已结束。感谢您的配合。', cancelled: '本次来访已取消。' };
    return { id: row.id, sessionId: row.session_id, guestName: row.guest_name, company: row.company, hostName: row.host_name, purpose: row.purpose, appointmentRef: row.appointment_ref, status: row.status, version: row.version, focusVersion: row.focus_version, identity: 'self_reported', environment: this.environment, confirmedAt: row.confirmed_at, completedAt: row.completed_at, hostDeadline: row.host_deadline, publicMessage: messages[row.status], guidance: row.status === 'accepted' && row.guidance_code ? guidance[row.guidance_code as keyof typeof guidance] || null : null, delivery: delivery ? { id: delivery.id, status: delivery.status, version: delivery.version, environment: delivery.environment, remoteId: delivery.remote_id, errorCode: delivery.error_code } : null, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  internalView(row: VisitRow, p: Principal): InternalVisit { return { ...this.publicView(row), workspaceId: row.workspace_id, venueId: row.venue_id, recipientIsMe: this.confirmedRecipient(row) === p.userId, privateNote: row.host_private_note, escalatedReason: row.escalated_reason }; }
  state(row: VisitRow, status: Visit['status'], reason: string | null = null) {
    this.repo.run('UPDATE visits SET status=?,version=version+1,escalated_reason=?,updated_at=? WHERE id=?', status, reason, new Date().toISOString(), row.id);
    this.repo.event(row.tenant_id, row.workspace_id, row.id, 'visit.' + status, this.environment);
    return this.row(row.id);
  }
  stopQueued(row: VisitRow) { this.repo.run("UPDATE visit_deliveries SET status='cancelled',version=version+1,updated_at=? WHERE visit_id=? AND status='queued'", new Date().toISOString(), row.id); }
  escalate(row: VisitRow, reason: string) {
    if (['completed', 'cancelled', 'declined', 'escalated'].includes(row.status)) return row;
    this.stopQueued(row);
    const session = this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', row.session_id);
    if (session?.status === 'active') {
      this.repo.run("UPDATE reception_sessions SET status='human',version=version+1,reply_epoch=reply_epoch+1,focus_version=focus_version+1 WHERE id=? AND status='active'", session.id);
      this.repo.run("UPDATE reception_messages SET status='cancelled' WHERE session_id=? AND role='assistant' AND status IN ('ready','playing')", session.id);
      this.repo.event(row.tenant_id, row.workspace_id, session.id, 'session.handoff', this.environment);
    }
    return this.state(row, 'escalated', reason);
  }
  onSessionEnd(session: SessionRow) {
    const row = this.bySession(session); if (!row) return;
    if (['draft', 'awaiting_confirmation'].includes(row.status)) this.state(row, 'cancelled', 'session_closed');
    else if (['notifying', 'waiting_host'].includes(row.status)) this.escalate(row, 'session_closed');
  }
  sweep(now = new Date()) {
    const rows = this.repo.all<VisitRow>("SELECT v.* FROM visits v JOIN reception_sessions s ON s.id=v.session_id WHERE s.environment=? AND s.app_env=? AND v.status IN ('notifying','waiting_host') AND v.host_deadline IS NOT NULL AND v.host_deadline<=?", this.environment, this.appEnv, now.toISOString());
    for (const row of rows) this.escalate(row, 'host_timeout');
    return rows.length;
  }
  saveDraft(session: SessionRow, input: { guestName: string; company: string; hostName: string; purpose: string; appointmentRef: string; version: number | null; focusVersion: number }) {
    if (input.focusVersion !== session.focus_version) throw new AppError('VERSION_CONFLICT', '会话服务对象已变化，请重新填写并确认。', 409);
    const existing = this.bySession(session);
    if (existing && !['draft', 'awaiting_confirmation'].includes(existing.status)) throw new AppError('STATE_CONFLICT', '已确认的来访不能直接改写，请取消或联系前台。', 409);
    if (existing) this.version(existing, input.version || 0);
    else if (input.version !== null) throw new AppError('VERSION_CONFLICT', '来访草稿不存在，请重新载入。', 409);
    const host = this.repo.get<HostRow>('SELECT * FROM reception_hosts WHERE tenant_id=? AND workspace_id=? AND public_name=? AND enabled=1', session.tenant_id, session.workspace_id, input.hostName);
    const now = new Date().toISOString();
    if (existing) this.repo.run("UPDATE visits SET guest_name=?,company=?,host_name=?,host_id=?,purpose=?,appointment_ref=?,focus_version=?,version=version+1,status='awaiting_confirmation',confirmed_hash=NULL,confirmed_at=NULL,updated_at=? WHERE id=?", input.guestName, input.company, input.hostName, host?.id || null, input.purpose, input.appointmentRef, session.focus_version, now, existing.id);
    else {
      const venue = this.repo.get<{ venue_id: string }>('SELECT venue_id FROM reception_terminals WHERE id=?', session.terminal_id)!;
      const visitId = randomUUID();
      this.repo.run('INSERT INTO visits(id,tenant_id,workspace_id,venue_id,session_id,host_id,host_name,guest_name,company,purpose,appointment_ref,status,focus_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,\'awaiting_confirmation\',?,?,?)', visitId, session.tenant_id, session.workspace_id, venue.venue_id, session.id, host?.id || null, input.hostName, input.guestName, input.company, input.purpose, input.appointmentRef, session.focus_version, now, now);
    }
    this.repo.run('UPDATE reception_sessions SET activity_at=? WHERE id=?', now, session.id);
    const row = this.bySession(session)!; this.repo.event(row.tenant_id, row.workspace_id, row.id, 'visit.draft_saved', this.environment); return row;
  }
}
