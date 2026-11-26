import { z } from 'zod';
const id = z.uuid();
export const visitStatus = z.enum(['draft', 'awaiting_confirmation', 'notifying', 'waiting_host', 'accepted', 'declined', 'escalated', 'completed', 'cancelled']);
export const deliveryStatus = z.enum(['queued', 'submitting', 'submitted', 'delivered', 'acknowledged', 'failed', 'unknown', 'cancelled']);
export const visitChannel=z.enum(['local','mock']);
export const visitDraftInput = z.strictObject({ guestName: z.string().trim().min(1).max(40), company: z.string().trim().max(80).default(''), hostName: z.string().trim().min(1).max(40), purpose: z.string().trim().min(1).max(200), appointmentRef: z.string().trim().max(80).default(''), version: z.int().positive().nullable(), focusVersion: z.int().nonnegative(),channel:visitChannel.default('mock') });
export const visitConfirmInput = z.strictObject({ version: z.int().positive(), focusVersion: z.int().nonnegative(), confirmationToken: z.string().min(20).max(160), expiresAt: z.iso.datetime(), noticeVersion: z.literal('visit-v1'), confirmed: z.literal(true),channel:visitChannel.default('mock') });
export const visitNotifyInput = z.strictObject({ version: z.int().positive(), focusVersion: z.int().nonnegative(),channel:visitChannel.default('mock') });
export const visitGuestControlInput = z.strictObject({ version: z.int().positive(), focusVersion: z.int().nonnegative(), action: z.enum(['cancel', 'complete']) });
export const visitEraseInput=z.strictObject({version:z.int().positive(),focusVersion:z.int().nonnegative(),confirmed:z.literal(true)});
export const visitErasureReceiptSchema=z.object({requestId:id,scope:z.literal('visit_registration'),status:z.literal('completed'),completedAt:z.iso.datetime(),external:z.literal('not_applicable')});
export const guidanceCode = z.enum(['front_desk', 'waiting_area', 'meeting_a']);
export const hostResponseInput = z.strictObject({ version: z.int().positive(), decision: z.enum(['accepted', 'declined']), guidanceCode: guidanceCode.optional(), privateNote: z.string().trim().max(300).default('') });
export const visitManageInput = z.strictObject({ version: z.int().positive(), action: z.enum(['escalate', 'complete', 'cancel']) });
export const mockNotificationInput = z.strictObject({ version: z.int().positive(), scenario: z.enum(['normal', 'failed', 'unknown']) });
export const notificationReceiptInput = z.strictObject({ eventId: id, deliveryId: id, environment: z.literal('mock'), schemaVersion: z.literal(1), status: z.enum(['delivered', 'acknowledged', 'failed', 'unknown']), occurredAt: z.iso.datetime() });
export const mockReceiptInput = z.strictObject({ version: z.int().positive(), status: notificationReceiptInput.shape.status });
export const deliverySchema = z.object({ id, status: deliveryStatus, version: z.int().positive(), environment: z.string(), remoteId: z.string().nullable(), errorCode: z.string().nullable(),channel:visitChannel.optional(),availability:z.enum(['active','withdrawn']).optional() });
export const visitSchema = z.object({ id, sessionId: id, guestName: z.string(), company: z.string(), hostName: z.string(), purpose: z.string(), appointmentRef: z.string(), status: visitStatus, version: z.int().positive(), focusVersion: z.int().nonnegative(), identity: z.literal('self_reported'),notificationChannel:visitChannel.optional(),dataErased:z.boolean().optional(), environment: z.string(), confirmedAt: z.iso.datetime().nullable(), completedAt: z.iso.datetime().nullable(), hostDeadline: z.iso.datetime().nullable(), publicMessage: z.string(), guidance: z.string().nullable(), delivery: deliverySchema.nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const internalVisitSchema = visitSchema.extend({ workspaceId: id, venueId: id, recipientIsMe: z.boolean(), privateNote: z.string().nullable(), escalatedReason: z.string().nullable(),canRespond:z.boolean().optional() });
export type Visit = z.infer<typeof visitSchema>;
export interface GuestVisitView { visit: Visit | null; confirmation: { token: string; expiresAt: string } | null;notificationChannels?:z.infer<typeof visitChannel>[];privacyReceipt?:z.infer<typeof visitErasureReceiptSchema>|null }
export interface InternalVisit extends Visit { workspaceId: string; venueId: string; recipientIsMe: boolean; privateNote: string | null; escalatedReason: string | null;canRespond?:boolean }
export const visitOperations = [
  ['post', '/guest/sessions/{id}/visit', visitDraftInput, '保存本人来访草稿'],
  ['post', '/guest/sessions/{id}/visit/confirm', visitConfirmInput, '访客明确确认当前版本'],
  ['post', '/guest/sessions/{id}/visit/notify', visitNotifyInput, '提交本次确认的模拟通知'],
  ['post', '/guest/sessions/{id}/visit/control', visitGuestControlInput, '取消或结束本次来访'],
  ['post', '/guest/sessions/{id}/visit/erase', visitEraseInput, '当前访客明确删除本人登记字段；最小回执不恢复原文'],
  ['post', '/visits/{id}/respond', hostResponseInput, '仅指定接待人可回复'],
  ['post', '/visits/{id}/control', visitManageInput, '前台升级、结束或取消'],
  ['post', '/visits/{id}/mock-notification', mockNotificationInput, '设置尚未派发通知的模拟场景'],
  ['post', '/visits/{id}/mock-receipt', mockReceiptInput, '注入签名模拟通知回执']
] as const;
