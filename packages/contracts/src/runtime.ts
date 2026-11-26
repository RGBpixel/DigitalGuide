import { z } from 'zod';
export const sceneToolName = z.enum(['knowledge.search', 'visit.lookup_host', 'reception.handoff','restaurant.order_draft','restaurant.service_request']);
export type SceneTool = z.infer<typeof sceneToolName>;
export const asrProviderId = z.enum(['disabled', 'mock-asr', 'mock-asr-brief', 'external-asr']);
export const ttsProviderId = z.enum(['disabled', 'mock-tone', 'mock-soft-tone', 'external-tts']);
export const runtimeProbeInput = z.strictObject({ version: z.int().positive(), fixture: z.enum(['reception', 'handoff']) });
export const toolConfirmInput = z.strictObject({ requestId: z.uuid(), version: z.int().positive(), focusVersion: z.int().nonnegative(), confirmed: z.literal(true) });
export const toolRequestSchema = z.object({ id: z.uuid(), name: z.enum(['reception.handoff','restaurant.order_draft','restaurant.service_request']), label: z.string(), preview:z.string().max(2000).optional(), status: z.enum(['proposed', 'confirmed', 'cancelled', 'expired']), expiresAt: z.iso.datetime() });
export type ToolRequest = z.infer<typeof toolRequestSchema>;
export interface ToolProposal { name: 'reception.handoff'; label: string }
export const runtimeProbeSchema = z.object({ simulated: z.literal(true), microphoneUsed: z.literal(false), fixture: z.enum(['reception', 'handoff']), asr: z.object({ provider: z.string(), text: z.string().max(500), simulated: z.literal(true) }), model: z.object({ provider: z.string(), text: z.string().max(5000), simulated: z.literal(true), toolProposals: z.array(z.object({ name: z.literal('reception.handoff'), label: z.string() })).max(1) }), tts: z.object({ provider: z.string(), mediaType: z.literal('audio/wav'), kind: z.literal('synthetic_tones'), durationMs: z.number().positive().max(5000), sha256: z.string().regex(/^[0-9a-f]{64}$/), contentBase64: z.string().max(300000) }), businessActionsExecuted: z.literal(false) });
export type RuntimeProbe = z.infer<typeof runtimeProbeSchema>;
export const runtimeOperations = [
  ['post', '/scene-apps/{id}/pipeline/check', runtimeProbeInput, '仅模拟语音链路契约检查，不采集麦克风或执行业务工具'],
  ['post', '/guest/sessions/{id}/tools/confirm', toolConfirmInput, '当前访客明确确认受白名单限制的工具请求']
] as const;
