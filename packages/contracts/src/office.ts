import { z } from 'zod';
const id = z.uuid(), version = z.int().positive(), date = z.iso.datetime();
export const officeChannel = z.enum(['local', 'mock']);
const relayFields = { recipientId: id, subject: z.string().trim().min(1).max(100), body: z.string().trim().min(1).max(1000), confidentiality: z.enum(['private', 'public']).default('private'), channel: officeChannel.default('local'), scheduledAt: date.nullable().default(null), expiresAt: date };
export const relayCreateInput = z.strictObject({ workspaceId: id, ...relayFields });
export const relayEditInput = z.strictObject({ version, ...relayFields });
export const officeConfirmInput = z.strictObject({ version, confirmed: z.literal(true) });
export const officeVersionInput = z.strictObject({ version });
export const officeScenarioInput = z.strictObject({ version, scenario: z.enum(['normal', 'failed', 'unknown']) });
export const notificationControlInput = z.strictObject({ version, action: z.enum(['read', 'acknowledge']) });
export const calendarFields = { title: z.string().trim().min(1).max(100), description: z.string().trim().max(1000).default(''), location: z.string().trim().max(120).default(''), startsAt: date, endsAt: date, timezone: z.string().min(1).max(64).default('Asia/Shanghai'), attendeeIds: z.array(id).min(1).max(20), reminderMinutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]).default(10), channel: officeChannel.default('local'), confirmed: z.literal(true) };
export const calendarCreateInput = z.strictObject({ workspaceId: id, ...calendarFields });
export const calendarUpdateInput = z.strictObject({ version, ...calendarFields });
export const calendarRespondInput = z.strictObject({ version, response: z.enum(['accepted', 'declined']) });
export const officeNotificationSchema = z.object({ id, workspaceId: id, sourceKind: z.enum(['relay', 'event']), sourceId: id, sourceRevision: version, kind: z.enum(['relay', 'invite', 'reminder', 'update', 'cancel', 'removed']), status: z.enum(['pending', 'unread', 'read', 'acknowledged', 'withdrawn', 'expired']), dispatchStatus: z.enum(['queued', 'submitting', 'local', 'submitted_mock', 'failed', 'unknown', 'withdrawn']), version, title: z.string(), body: z.string().nullable(), senderName: z.string(), dueAt: date, expiresAt: date, readAt: date.nullable(), acknowledgedAt: date.nullable(), channel: officeChannel, remoteId: z.string().nullable(), errorCode: z.string().nullable() });
export const officeRelaySchema = z.object({ id, workspaceId: id, senderId: id, senderName: z.string(), recipientId: id, recipientName: z.string(), subject: z.string(), body: z.string(), confidentiality: z.enum(['private', 'public']), channel: officeChannel, status: z.enum(['draft', 'scheduled', 'sent', 'cancelled', 'expired']), version, revision: version, scheduledAt: date.nullable(), expiresAt: date, createdAt: date, deliveries: z.array(officeNotificationSchema) });
export const calendarEventSchema = z.object({ id, workspaceId: id, organizerId: id, organizerName: z.string(), title: z.string(), description: z.string(), location: z.string(), startsAt: date, endsAt: date, timezone: z.string(), reminderMinutes: z.int(), channel: officeChannel, status: z.enum(['scheduled', 'cancelled', 'completed', 'expired']), version, revision: version, expiresAt: date, source: z.literal('local_calendar'), attendees: z.array(z.object({ id, name: z.string(), response: z.enum(['pending', 'accepted', 'declined']) })) });
export type OfficeNotification = z.infer<typeof officeNotificationSchema>;
export type OfficeRelay = z.infer<typeof officeRelaySchema>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export interface OfficeMember { id: string; name: string }
export const officeOperations = [
  ['post', '/office/relays', relayCreateInput, '本人创建本地口信草稿'],
  ['post', '/office/relays/{id}/edit', relayEditInput, '本人修改尚未转达的草稿'],
  ['post', '/office/relays/{id}/send', officeConfirmInput, '确认当前版本并定时转达'],
  ['post', '/office/relays/{id}/cancel', officeConfirmInput, '撤回本地口信，不能伪称撤回外部已提交消息'],
  ['post', '/office/relays/{id}/scenario', officeScenarioInput, '仅管理员配置模拟渠道场景'],
  ['post', '/office/notifications/{id}/control', notificationControlInput, '仅收信人标记已读或本人确认'],
  ['post', '/office/calendar', calendarCreateInput, '本人明确创建本地会议与提醒'],
  ['post', '/office/calendar/{id}/update', calendarUpdateInput, '组织者改期，撤销旧版提醒'],
  ['post', '/office/calendar/{id}/cancel', officeConfirmInput, '组织者取消会议及旧提醒'],
  ['post', '/office/calendar/{id}/respond', calendarRespondInput, '本人回应当前会议版本']
] as const;
