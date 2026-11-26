import { z } from 'zod';
const id = z.uuid(), version = z.int().positive(), focusVersion = z.int().nonnegative().optional();
export const personRole = z.enum(['employee', 'visitor', 'customer']);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const personEnrollInput = z.strictObject({ workspaceId: id.optional(), displayName: z.string().trim().min(1).max(60), roles: z.array(z.enum(['visitor', 'customer'])).max(2).default([]), consent: z.literal(true), noticeVersion: z.literal('memory-v1'), retentionDays: z.union([z.literal(30), z.literal(90), z.literal(180)]).default(180), focusVersion });
export const personSettingsInput = z.strictObject({ version, displayName: z.string().trim().min(1).max(60), roles: z.array(z.enum(['visitor', 'customer'])).max(2), personalization: z.boolean(), doNotDisturb: z.boolean(), quietStart: time, quietEnd: time, cooldownMinutes: z.int().min(5).max(1440), focusVersion });
export const factKey = z.enum(['nickname', 'company', 'like', 'avoid', 'interest']);
export const memoryProposeInput = z.strictObject({ key: factKey, value: z.string().trim().min(1).max(200), visibility: z.enum(['private', 'reception']).default('private'), sourceMessageId: id.optional(), expiresAt: z.iso.datetime(), focusVersion });
export const memoryDecisionInput = z.strictObject({ factId: id, version, action: z.enum(['confirm', 'reject', 'revoke', 'correct']), value: z.string().trim().min(1).max(200).optional(), confirmed: z.literal(true), focusVersion });
export const memoryNoteInput = z.strictObject({ kind: z.enum(['summary', 'todo']), text: z.string().trim().min(1).max(800), sourceMessageIds: z.array(id).max(20).default([]), reviewed: z.literal(true), focusVersion });
export const memoryNoteControlInput = z.strictObject({ noteId: id, version, action: z.enum(['complete', 'delete']), focusVersion });
export const memoryEraseInput = z.strictObject({ version, confirmed: z.literal(true), focusVersion });
export const memoryGreetingInput = z.strictObject({ version, focusVersion });
export const recoveryIssueInput = z.strictObject({ version, focusVersion: z.int().nonnegative(), confirmed: z.literal(true) });
export const memoryRestoreInput = z.strictObject({ recoveryCode: z.string().trim().regex(/^DG1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/), focusVersion: z.int().nonnegative(), consent: z.literal(true), noticeVersion: z.literal('memory-v1') });
export interface RecoveryDescriptor { personId: string; credentialId: string; expiresAt: string }
export interface RecoveryIssue extends RecoveryDescriptor { recoveryCode: string }
export const memoryFactSchema = z.object({ id, personId: id, key: factKey, value: z.string(), sourceKind: z.enum(['self_statement', 'session_text', 'verified_mock_audio']), sourceSessionId: id.nullable(), sourceMessageId: id.nullable(), visibility: z.enum(['private', 'reception']), status: z.enum(['pending', 'confirmed', 'rejected', 'revoked', 'expired']), version, expiresAt: z.iso.datetime(), confirmedAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime() });
export const memoryNoteSchema = z.object({ id, personId: id, kind: z.enum(['summary', 'todo']), text: z.string(), sourceSessionId: id.nullable(), sourceMessageIds: z.array(id), status: z.enum(['open', 'completed']), version, expiresAt: z.iso.datetime() });
export const personSchema = z.object({ id, workspaceId: id, displayName: z.string(), roles: z.array(personRole), identity: z.enum(['self_reported', 'account_verified']), version, personalization: z.boolean(), doNotDisturb: z.boolean(), quietStart: time, quietEnd: time, cooldownMinutes: z.int(), expiresAt: z.iso.datetime(), consentAt: z.iso.datetime(), noticeVersion: z.literal('memory-v1') });
export const memoryViewSchema = z.object({ person: personSchema.nullable(), facts: z.array(memoryFactSchema), notes: z.array(memoryNoteSchema) });
export type MemoryView = z.infer<typeof memoryViewSchema>;
export type MemoryPerson = z.infer<typeof personSchema>;
export type MemoryFact = z.infer<typeof memoryFactSchema>;
export type MemoryNote = z.infer<typeof memoryNoteSchema>;
export interface PersonDirectoryItem { id: string; displayName: string; workspaceId: string; roles: string[]; identity: string; expiresAt: string }
export interface PrivacyReceipt { requestId: string; status: 'completed'; local: 'completed'; external: 'not_applicable'; retained: string[] }
export const peopleOperations = [
  ['post', '/guest/sessions/{id}/memory/recovery', recoveryIssueInput, '本人明确生成本工作空间的单次恢复凭证'],
  ['post', '/guest/sessions/{id}/memory/recovery/revoke', recoveryIssueInput, '本人撤销未使用的恢复凭证'],
  ['post', '/guest/sessions/{id}/memory/restore', memoryRestoreInput, '以有效凭证恢复偏好，不建立员工身份'],
  ['post', '/people/self', personEnrollInput, '本人自愿建立资料，登录账号关联只取服务端身份'],
  ...['/people/{id}', '/guest/sessions/{id}/memory'].flatMap(base => [
    ['post', base + '/settings', personSettingsInput, '本人更新资料与免打扰'],
    ['post', base + '/facts', memoryProposeInput, '提交待确认记忆，保留声明或会话来源'],
    ['post', base + '/facts/decide', memoryDecisionInput, '本人确认、纠错、拒绝或撤回'],
    ['post', base + '/notes', memoryNoteInput, '本人复核的摘要或待办'],
    ['post', base + '/notes/control', memoryNoteControlInput, '完成或删除本人待办/摘要'],
    ['post', base + '/erase', memoryEraseInput, '删除本人资料、索引和敏感缓存'],
    ['post', base + '/greet', memoryGreetingInput, '按免打扰、时段与冷却控制的公开称呼']
  ] as const),
  ['post', '/guest/sessions/{id}/memory', personEnrollInput, '访客主动登记本会话偏好，不创建已认证身份']
] as const;
