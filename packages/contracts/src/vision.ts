import { z } from 'zod';
const id = z.uuid(), version = z.int().positive(), focusVersion = z.int().nonnegative();
export const visualSource = z.enum(['camera', 'screen']);
export const visualGrantInput = z.strictObject({ version, focusVersion, source: visualSource, consent: z.literal(true), noticeVersion: z.literal('vision-v1') });
export const visualRevokeInput = z.strictObject({ focusVersion, grantId: id, grantVersion: version });
export const visualQuestionInput = z.strictObject({ version, focusVersion, grantId: id, grantVersion: version, capturedAt: z.iso.datetime(), question: z.string().trim().min(1).max(500), frameBase64: z.string().min(44).max(1_400_000) });
export const visualGrantSchema = z.object({ id, source: visualSource, provider: z.string(), focusVersion, version, status: z.enum(['active', 'revoked', 'expired']), expiresAt: z.iso.datetime(), createdAt: z.iso.datetime() });
export const visualReferenceSchema = z.object({ requestId: id, grantId: id, source: visualSource, provider: z.string(), simulated: z.boolean(), width: z.int().positive(), height: z.int().positive(), expiresAt: z.iso.datetime() });
export const visualStateSchema = z.object({ grant: visualGrantSchema.nullable(), policy: z.object({ camera: z.boolean(), screen: z.boolean(), provider: z.string(), configured: z.boolean() }), storage: z.literal('transient_frame_metadata_only'), maxFrameBytes: z.int().positive() });
export type VisualGrant = z.infer<typeof visualGrantSchema>;
export type VisualReference = z.infer<typeof visualReferenceSchema>;
export type VisualState = z.infer<typeof visualStateSchema>;
export const visionOperations = [
  ['post', '/guest/sessions/{id}/vision/grants', visualGrantInput, '明确授权本次选中的画面来源'],
  ['post', '/guest/sessions/{id}/vision/revoke', visualRevokeInput, '撤回画面授权、清除回复并取消在途分析'],
  ['post', '/guest/sessions/{id}/vision/questions', visualQuestionInput, '发送单帧并提问，检查授权与迟到结果']
] as const;
