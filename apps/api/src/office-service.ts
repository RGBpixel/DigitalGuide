import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError, requireWorkspace, type Principal } from '@digitalguide/domain';
import type { z } from 'zod';
import { relayCreateInput, calendarCreateInput, type OfficeNotification, type OfficeRelay, type CalendarEvent } from '@digitalguide/contracts';
interface ScopeRow { id: string; tenant_id: string; workspace_id: string; version: number; revision: number; expires_at: string; environment: string; app_env: string; created_at: string }
export interface RelayRow extends ScopeRow { sender_user_id: string; recipient_user_id: string; subject: string; body: string; confidentiality: OfficeRelay['confidentiality']; channel: 'local' | 'mock'; scenario: 'normal' | 'failed' | 'unknown'; status: OfficeRelay['status']; scheduled_at: string | null }
export interface CalendarRow extends ScopeRow { organizer_user_id: string; title: string; description: string; location: string; starts_at: string; ends_at: string; timezone: string; reminder_minutes: number; channel: 'local' | 'mock'; status: CalendarEvent['status'] }
export interface OfficeNoticeRow { id: string; tenant_id: string; workspace_id: string; source_kind: 'relay' | 'event'; source_id: string; source_revision: number; recipient_user_id: string; kind: OfficeNotification['kind']; due_at: string; expires_at: string; channel: 'local' | 'mock'; scenario: 'normal' | 'failed' | 'unknown'; status: OfficeNotification['status']; dispatch_status: OfficeNotification['dispatchStatus']; version: number; attempts: number; lease_token: string | null; lease_until: string | null; remote_id: string | null; error_code: string | null; read_at: string | null; acknowledged_at: string | null; environment: string; app_env: string }
const stamp = () => new Date().toISOString();
const iso = (value: string) => new Date(value).toISOString();
export class OfficeService {
  constructor(public repo: Repository, public environment: string, public appEnv: string) {}
  name(userId: string) { return this.repo.get<{ name: string }>('SELECT name FROM users WHERE id=?', userId)?.name || '成员'; }
  member(tenantId: string, workspaceId: string, userId: string) {
    try { const p = this.repo.principal(userId); return p.tenantId === tenantId && p.workspaceIds.includes(workspaceId); } catch { return false; }
  }
  channel(channel: 'local' | 'mock') { if (channel === 'mock' && (this.environment !== 'mock' || this.appEnv === 'production')) throw new AppError('PROVIDER_NOT_CONFIGURED', '真实员工通知渠道尚未接通，请选择本地收件箱。', 409); }
  version(row: { version: number }, version: number) { if (row.version !== version) throw new AppError('VERSION_CONFLICT', '内容或状态已变化，请刷新后核对当前版本。', 409); }
  invalidate(sourceId: string) { this.repo.run("UPDATE idempotency SET response='{}',redacted=1 WHERE instr(response,?)>0", sourceId); }
  relay(p: Principal, id: string): RelayRow {
    const row = this.repo.get<RelayRow>('SELECT * FROM office_relays WHERE id=? AND tenant_id=? AND sender_user_id=? AND environment=? AND app_env=?', id, p.tenantId, p.userId, this.environment, this.appEnv);
    if (!row) throw new AppError('NOT_FOUND', '口信不存在或不属于本人。', 404); requireWorkspace(p, row.workspace_id); return row;
  }
  event(p: Principal, id: string, organizerOnly = false): CalendarRow {
    const row = this.repo.get<CalendarRow>('SELECT * FROM office_calendar_events WHERE id=? AND tenant_id=? AND environment=? AND app_env=?', id, p.tenantId, this.environment, this.appEnv);
    if (!row || (row.organizer_user_id !== p.userId && (organizerOnly || !this.repo.get('SELECT user_id FROM office_event_attendees WHERE event_id=? AND user_id=?', id, p.userId)))) throw new AppError('NOT_FOUND', '会议不存在或无权访问。', 404);
    requireWorkspace(p, row.workspace_id); return row;
  }
  notice(p: Principal, id: string): OfficeNoticeRow {
    const row = this.repo.get<OfficeNoticeRow>("SELECT * FROM office_notifications WHERE id=? AND tenant_id=? AND recipient_user_id=? AND environment=? AND app_env=? AND status<>'pending'", id, p.tenantId, p.userId, this.environment, this.appEnv);
    if (!row) throw new AppError('NOT_FOUND', '提醒不存在或不属于本人。', 404); requireWorkspace(p, row.workspace_id); return row;
  }
  attendees(eventId: string) { return this.repo.all<{ user_id: string; response: 'pending' | 'accepted' | 'declined' }>('SELECT user_id,response FROM office_event_attendees WHERE event_id=? ORDER BY user_id', eventId); }
  source(n: OfficeNoticeRow, now = stamp()) {
    if (n.environment !== this.environment || n.app_env !== this.appEnv || n.due_at > now || n.expires_at <= now || !this.member(n.tenant_id, n.workspace_id, n.recipient_user_id)) return null;
    if (n.source_kind === 'relay') {
      const row = this.repo.get<RelayRow>('SELECT * FROM office_relays WHERE id=?', n.source_id);
      return row && row.tenant_id === n.tenant_id && row.workspace_id === n.workspace_id && row.environment === n.environment && row.app_env === n.app_env && row.revision === n.source_revision && row.recipient_user_id === n.recipient_user_id && ['scheduled', 'sent'].includes(row.status) && row.expires_at > now ? { title: row.subject, body: row.body, senderId: row.sender_user_id } : null;
    }
    const row = this.repo.get<CalendarRow>('SELECT * FROM office_calendar_events WHERE id=?', n.source_id);
    if (!row || row.tenant_id !== n.tenant_id || row.workspace_id !== n.workspace_id || row.environment !== n.environment || row.app_env !== n.app_env || row.revision !== n.source_revision || row.expires_at <= now) return null;
    if (n.kind === 'removed') return { title: '会议安排已变更', body: '您不再属于此会议的参与范围，旧提醒已撤销。', senderId: row.organizer_user_id };
    if (!this.repo.get('SELECT user_id FROM office_event_attendees WHERE event_id=? AND user_id=?', row.id, n.recipient_user_id)) return null;
    if (n.kind === 'cancel' && row.status === 'cancelled') return { title: '会议已取消：' + row.title, body: '组织者已取消会议，请以最新本地日历为准。', senderId: row.organizer_user_id };
    if (row.status !== 'scheduled' || row.ends_at <= now) return null;
    return { title: (n.kind === 'reminder' ? '会议提醒：' : n.kind === 'update' ? '会议已更新：' : '会议邀请：') + row.title, body: row.starts_at + ' — ' + row.ends_at + '（' + row.timezone + '）\n' + (row.location ? '地点：' + row.location + '\n' : '') + row.description, senderId: row.organizer_user_id };
  }
  noticeView(n: OfficeNoticeRow): OfficeNotification {
    const source = ['unread', 'read', 'acknowledged'].includes(n.status) ? this.source(n) : null;
    return { id: n.id, workspaceId: n.workspace_id, sourceKind: n.source_kind, sourceId: n.source_id, sourceRevision: n.source_revision, kind: n.kind, status: n.status, dispatchStatus: n.dispatch_status, version: n.version, title: source?.title || (n.status === 'expired' ? '提醒已到期' : n.status === 'pending' ? '提醒尚未到转达时间' : '原提醒已失效或撤回'), body: source?.body || null, senderName: source ? this.name(source.senderId) : '系统', dueAt: n.due_at, expiresAt: n.expires_at, readAt: n.read_at, acknowledgedAt: n.acknowledged_at, channel: n.channel, remoteId: n.remote_id, errorCode: n.error_code };
  }
  relayView(row: RelayRow): OfficeRelay {
    return { id: row.id, workspaceId: row.workspace_id, senderId: row.sender_user_id, senderName: this.name(row.sender_user_id), recipientId: row.recipient_user_id, recipientName: this.name(row.recipient_user_id), subject: row.subject, body: row.body, confidentiality: row.confidentiality, channel: row.channel, status: row.status, version: row.version, revision: row.revision, scheduledAt: row.scheduled_at, expiresAt: row.expires_at, createdAt: row.created_at, deliveries: this.repo.all<OfficeNoticeRow>('SELECT * FROM office_notifications WHERE source_kind=\'relay\' AND source_id=? ORDER BY created_at', row.id).map(n => this.noticeView(n)) };
  }
  eventView(row: CalendarRow): CalendarEvent {
    return { id: row.id, workspaceId: row.workspace_id, organizerId: row.organizer_user_id, organizerName: this.name(row.organizer_user_id), title: row.title, description: row.description, location: row.location, startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone, reminderMinutes: row.reminder_minutes, channel: row.channel, status: row.status, version: row.version, revision: row.revision, expiresAt: row.expires_at, source: 'local_calendar', attendees: this.attendees(row.id).map(a => ({ id: a.user_id, name: this.name(a.user_id), response: a.response })) };
  }
  withdraw(sourceId: string) {
    this.repo.run("UPDATE office_notifications SET status='withdrawn',dispatch_status='withdrawn',version=version+1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE source_id=? AND status NOT IN ('withdrawn','expired')", stamp(), sourceId);
    this.invalidate(sourceId);
  }
  addNotice(row: ScopeRow, sourceKind: 'relay' | 'event', recipientId: string, kind: OfficeNoticeRow['kind'], dueAt: string, channel: 'local' | 'mock', scenario = 'normal') {
    this.repo.run('INSERT OR IGNORE INTO office_notifications(id,tenant_id,workspace_id,source_kind,source_id,source_revision,recipient_user_id,kind,due_at,expires_at,channel,scenario,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      randomUUID(), row.tenant_id, row.workspace_id, sourceKind, row.id, row.revision, recipientId, kind, dueAt, row.expires_at, channel, scenario, this.environment, this.appEnv, stamp(), stamp());
    this.repo.event(row.tenant_id, row.workspace_id, row.id, 'office.reminder_queued', this.environment);
  }
  validateRelay(p: Principal, workspaceId: string, input: z.infer<typeof relayCreateInput>) {
    requireWorkspace(p, workspaceId); this.channel(input.channel);
    if (!this.member(p.tenantId, workspaceId, input.recipientId)) throw new AppError('NOT_FOUND', '收信人不可用或不属于本工作空间。', 404);
    if (Date.parse(input.expiresAt) <= Date.now() || Date.parse(input.expiresAt) > Date.now() + 90 * 86400000 || (input.scheduledAt && Date.parse(input.scheduledAt) >= Date.parse(input.expiresAt))) throw new AppError('INVALID_TIME', '有效期须在未来 90 天内，并晚于转达时间。', 400);
  }
  createRelay(p: Principal, input: z.infer<typeof relayCreateInput>) {
    this.validateRelay(p, input.workspaceId, input);
    if (this.repo.get<{ n: number }>('SELECT count(*) AS n FROM office_relays WHERE tenant_id=? AND sender_user_id=? AND created_at>=?', p.tenantId, p.userId, stamp().slice(0, 10))!.n >= 100) throw new AppError('QUOTA_EXCEEDED', '今日口信草稿达到上限，请清理或稍后再试。', 429);
    const id = randomUUID(), now = stamp();
    this.repo.run('INSERT INTO office_relays(id,tenant_id,workspace_id,sender_user_id,recipient_user_id,subject,body,confidentiality,channel,scheduled_at,expires_at,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, p.tenantId, input.workspaceId, p.userId, input.recipientId, input.subject, input.body, input.confidentiality, input.channel, input.scheduledAt ? iso(input.scheduledAt) : null, iso(input.expiresAt), this.environment, this.appEnv, now, now);
    return this.relay(p, id);
  }
  editRelay(p: Principal, row: RelayRow, input: z.infer<typeof relayCreateInput> & { version: number }) {
    this.version(row, input.version); if (row.status !== 'draft') throw new AppError('STATE_CONFLICT', '已确认的口信不能覆盖修改，请撤回后重新创建。', 409);
    this.validateRelay(p, row.workspace_id, input);
    this.repo.run('UPDATE office_relays SET recipient_user_id=?,subject=?,body=?,confidentiality=?,channel=?,scheduled_at=?,expires_at=?,version=version+1,revision=revision+1,updated_at=? WHERE id=?', input.recipientId, input.subject, input.body, input.confidentiality, input.channel, input.scheduledAt ? iso(input.scheduledAt) : null, iso(input.expiresAt), stamp(), row.id); this.invalidate(row.id);
  }
  sendRelay(p: Principal, row: RelayRow, version: number) {
    if (['scheduled', 'sent'].includes(row.status)) return;
    this.version(row, version); this.channel(row.channel);
    if (row.status !== 'draft' || row.expires_at <= stamp() || !this.member(row.tenant_id, row.workspace_id, row.recipient_user_id)) throw new AppError('STATE_CONFLICT', '口信已失效、撤回或收件范围变化，请重新核对。', 409);
    this.repo.run("UPDATE office_relays SET status='scheduled',version=version+1,scheduled_at=COALESCE(scheduled_at,?),updated_at=? WHERE id=?", stamp(), stamp(), row.id);
    this.addNotice(row, 'relay', row.recipient_user_id, 'relay', row.scheduled_at || stamp(), row.channel, row.scenario);
    this.repo.event(p.tenantId, row.workspace_id, row.id, 'office.relay_confirmed', this.environment);
  }
  cancelRelay(row: RelayRow, version: number) {
    this.version(row, version); if (['cancelled', 'expired'].includes(row.status)) throw new AppError('STATE_CONFLICT', '口信已经撤回或到期。', 409);
    this.withdraw(row.id); this.repo.run("UPDATE office_relays SET status='cancelled',subject='已撤回口信',body='',revision=revision+1,version=version+1,updated_at=? WHERE id=?", stamp(), row.id);
  }
  validateCalendar(p: Principal, workspaceId: string, input: z.infer<typeof calendarCreateInput>) {
    requireWorkspace(p, workspaceId); this.channel(input.channel);
    try { new Intl.DateTimeFormat('zh-CN', { timeZone: input.timezone }).format(); } catch { throw new AppError('INVALID_TIMEZONE', '会议时区无效，请选择有效的 IANA 时区。', 400); }
    if (Date.parse(input.startsAt) <= Date.now() || Date.parse(input.endsAt) <= Date.parse(input.startsAt) || Date.parse(input.startsAt) > Date.now() + 366 * 86400000 || Date.parse(input.endsAt) - Date.parse(input.startsAt) > 7 * 86400000) throw new AppError('INVALID_TIME', '会议须在未来一年内开始，结束晚于开始，且持续不超过七天。', 400);
    const attendees = [...new Set([p.userId, ...input.attendeeIds])];
    if (attendees.length > 20) throw new AppError('VALIDATION_FAILED', '每场会议含组织者最多 20 人，请减少参与者。', 400);
    if (attendees.some(userId => !this.member(p.tenantId, workspaceId, userId))) throw new AppError('NOT_FOUND', '参与者不属于当前工作空间或账号已不可用。', 404);
    return attendees;
  }
  queueEvent(row: CalendarRow, kind: 'invite' | 'update', removed: string[] = []) {
    for (const a of this.attendees(row.id)) {
      if (a.user_id !== row.organizer_user_id) this.addNotice(row, 'event', a.user_id, kind, stamp(), row.channel);
      this.addNotice(row, 'event', a.user_id, 'reminder', new Date(Date.parse(row.starts_at) - row.reminder_minutes * 60000).toISOString(), row.channel);
    }
    for (const userId of removed) this.addNotice(row, 'event', userId, 'removed', stamp(), row.channel);
  }
  createEvent(p: Principal, input: z.infer<typeof calendarCreateInput>) {
    const attendees = this.validateCalendar(p, input.workspaceId, input);
    if (this.repo.get<{ n: number }>('SELECT count(*) AS n FROM office_calendar_events WHERE tenant_id=? AND organizer_user_id=? AND created_at>=?', p.tenantId, p.userId, stamp().slice(0, 10))!.n >= 50) throw new AppError('QUOTA_EXCEEDED', '今日会议创建达到上限，请稍后再试。', 429);
    const id = randomUUID(), expiresAt = new Date(Date.parse(input.endsAt) + 30 * 86400000).toISOString();
    this.repo.run('INSERT INTO office_calendar_events(id,tenant_id,workspace_id,organizer_user_id,title,description,location,starts_at,ends_at,timezone,reminder_minutes,channel,expires_at,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, p.tenantId, input.workspaceId, p.userId, input.title, input.description, input.location, iso(input.startsAt), iso(input.endsAt), input.timezone, input.reminderMinutes, input.channel, expiresAt, this.environment, this.appEnv, stamp(), stamp());
    for (const userId of attendees) this.repo.run('INSERT INTO office_event_attendees(event_id,user_id,response) VALUES (?,?,?)', id, userId, userId === p.userId ? 'accepted' : 'pending');
    const row = this.event(p, id); this.queueEvent(row, 'invite'); return row;
  }
  updateEvent(p: Principal, row: CalendarRow, input: z.infer<typeof calendarCreateInput> & { version: number }) {
    this.version(row, input.version); if (row.status !== 'scheduled') throw new AppError('STATE_CONFLICT', '已取消或结束的会议不能重新改写。', 409);
    const next = this.validateCalendar(p, row.workspace_id, input), old = this.attendees(row.id).map(a => a.user_id);
    this.withdraw(row.id); this.repo.run('DELETE FROM office_event_attendees WHERE event_id=?', row.id);
    for (const userId of next) this.repo.run('INSERT INTO office_event_attendees(event_id,user_id,response) VALUES (?,?,?)', row.id, userId, userId === p.userId ? 'accepted' : 'pending');
    this.repo.run('UPDATE office_calendar_events SET title=?,description=?,location=?,starts_at=?,ends_at=?,timezone=?,reminder_minutes=?,channel=?,expires_at=?,version=version+1,revision=revision+1,updated_at=? WHERE id=?', input.title, input.description, input.location, iso(input.startsAt), iso(input.endsAt), input.timezone, input.reminderMinutes, input.channel, new Date(Date.parse(input.endsAt) + 30 * 86400000).toISOString(), stamp(), row.id);
    this.queueEvent(this.event(p, row.id), 'update', old.filter(userId => !next.includes(userId)));
  }
  cancelEvent(row: CalendarRow, version: number) {
    this.version(row, version); if (row.status !== 'scheduled') throw new AppError('STATE_CONFLICT', '当前会议已经取消或结束。', 409);
    this.withdraw(row.id); this.repo.run("UPDATE office_calendar_events SET status='cancelled',version=version+1,revision=revision+1,updated_at=? WHERE id=?", stamp(), row.id);
    const fresh = this.repo.get<CalendarRow>('SELECT * FROM office_calendar_events WHERE id=?', row.id)!;
    for (const attendee of this.attendees(row.id)) if (attendee.user_id !== row.organizer_user_id) this.addNotice(fresh, 'event', attendee.user_id, 'cancel', stamp(), fresh.channel);
  }
  sweep(now = new Date()) {
    const time = now.toISOString();
    for (const row of this.repo.all<RelayRow>("SELECT * FROM office_relays WHERE environment=? AND app_env=? AND expires_at<=? AND status<>'expired'", this.environment, this.appEnv, time)) {
      this.withdraw(row.id); this.repo.run("UPDATE office_relays SET status='expired',subject='口信已到期',body='',version=version+1 WHERE id=?", row.id);
    }
    for (const row of this.repo.all<CalendarRow>("SELECT * FROM office_calendar_events WHERE environment=? AND app_env=? AND ((expires_at<=? AND status<>'expired') OR (ends_at<=? AND status='scheduled'))", this.environment, this.appEnv, time, time)) {
      this.withdraw(row.id);
      if (row.expires_at <= time) this.repo.run("UPDATE office_calendar_events SET status='expired',title='会议记录已到期',description='',location='',version=version+1 WHERE id=?", row.id);
      else this.repo.run("UPDATE office_calendar_events SET status='completed',version=version+1 WHERE id=?", row.id);
    }
    const expired = this.repo.all<{ id: string; source_id: string }>("SELECT id,source_id FROM office_notifications WHERE environment=? AND app_env=? AND expires_at<=? AND status<>'expired'", this.environment, this.appEnv, time);
    for (const n of expired) { this.repo.run("UPDATE office_notifications SET status='expired',dispatch_status='withdrawn',lease_token=NULL,lease_until=NULL,version=version+1 WHERE id=?", n.id); this.invalidate(n.source_id); }
  }
}

