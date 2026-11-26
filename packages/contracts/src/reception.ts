import type { SpeakerFocusView } from './speaker.js';
import { toolRequestSchema } from './runtime.js';
import { z } from 'zod';
import { visualReferenceSchema } from './vision.js';
import { citationSchema } from './knowledge.js';
const uuid = z.uuid();
export const terminalInput = z.strictObject({ venueId: uuid, name: z.string().trim().min(1).max(60) });
export const presenceInput = z.strictObject({ type: z.enum(['entered', 'left']), trackId: z.string().trim().min(1).max(80), source: z.literal('mock_presence'), sessionId: uuid.optional() });
export const sessionInput = z.strictObject({ terminalId: uuid, profileId: uuid.optional(), sceneAppId: uuid.optional() });
export const messageInput = z.strictObject({ text: z.string().trim().min(1).max(1000), version: z.int().positive(), focusVersion: z.int().nonnegative(), source: z.literal('typed') });
export const sessionControlInput = z.strictObject({ action: z.enum(['stop', 'handoff', 'resume', 'end']), version: z.int().positive(), focusVersion: z.int().nonnegative() });
export const sessionEventInput = z.discriminatedUnion('type', [
  z.strictObject({ type: z.enum(['reply.started', 'reply.completed']), replyId: uuid, replyEpoch: z.int().nonnegative(), focusVersion: z.int().nonnegative() }),
  z.strictObject({ type: z.literal('audio.segment'), segmentId: uuid, text: z.string().max(2000), attribution: z.enum(['target', 'other', 'uncertain']), final: z.boolean(), focusVersion: z.int().nonnegative(), source: z.literal('mock_audio') })
]);
export const receptionMessageSchema = z.object({ id: uuid, role: z.enum(['visitor', 'assistant', 'system']), text: z.string(), status: z.enum(['received', 'ready', 'playing', 'completed', 'cancelled']), replyEpoch: z.int().nonnegative(), focusVersion: z.int().nonnegative(), createdAt: z.iso.datetime(), restaurantContext: z.object({restaurantId:uuid,menuVersion:z.int().positive(),partyId:uuid.nullable(),partyVersion:z.int().positive().nullable(),preferenceId:uuid.nullable()}).nullable().optional(), citations: z.array(citationSchema).default([]), visualContext: visualReferenceSchema.nullable().default(null), toolRequests: z.array(toolRequestSchema).default([]), inputSource: z.enum(['typed', 'system', 'verified_mock_audio']).default('typed'), speakerDecisionId: uuid.nullable().default(null) });
export const receptionSessionSchema = z.object({ id: uuid, terminalId: uuid, scene: z.enum(['reception','restaurant']).optional(), status: z.enum(['active', 'human', 'ended', 'expired']), version: z.int().positive(), replyEpoch: z.int().nonnegative(), focusVersion: z.int().nonnegative(), source: z.enum(['manual', 'mock_presence']), environment: z.enum(['mock', 'sandbox', 'live']), identity: z.literal('anonymous'), expiresAt: z.iso.datetime(), activityAt: z.iso.datetime(), messages: z.array(receptionMessageSchema), profileName: z.string().nullable(), sceneAppId: uuid.nullable().default(null), sceneAppName: z.string().nullable().default(null) });
export interface ReceptionFeatures {speakerFocus:boolean;visitRegistration:boolean;personalMemory:boolean;visionQuestions:boolean;dining:boolean;hostManagement?:boolean;speakerHandoffIntent?:boolean;speakerFocusPreview?:boolean;proactiveGreetings?:boolean}
export type ReceptionSession = z.infer<typeof receptionSessionSchema> & {features?:ReceptionFeatures};
export type ReceptionMessage = z.infer<typeof receptionMessageSchema>;
export interface ReceptionTerminal { id: string; workspaceId: string; venueId: string; name: string; environment: string; version: number; currentSessionId: string | null; queued: number }
export interface PresenceResult { disposition: 'started' | 'active' | 'queued' | 'cooldown' | 'left'; sessionId: string | null; greeted: boolean; queuePosition: number | null }
export interface GuestSessionView { session: ReceptionSession; csrfToken: string; capabilities: ['session.read', 'text.send', 'manual.stop', 'human.request', 'session.end']; audio: { state: 'not_configured' | 'mock_focus'; focus: SpeakerFocusView['state'] | 'unlocked' }; environment: string; features?: ReceptionFeatures }
export const receptionOperations = [
  ['post', '/terminals', terminalInput, '创建接待终端'], ['post', '/terminals/{id}/presence', presenceInput, '显式模拟接近/离开事件'],
  ['post', '/terminals/{id}/next', z.strictObject({}), '从仍在场的队列接待下一位'],
  ['post', '/sessions', sessionInput, '工作人员创建匿名会话'], ['post', '/sessions/{id}/access', z.strictObject({}), '签发当前会话受限访问 Cookie'],
  ['post', '/sessions/{id}/control', sessionControlInput, '工作人员停止/接管/恢复/结束'],
  ['post', '/guest/sessions/{id}/messages', messageInput, '访客文字输入'], ['post', '/guest/sessions/{id}/events', sessionEventInput, '播放确认或拦截模拟音频'],
  ['post', '/guest/sessions/{id}/control', sessionControlInput, '访客停止/请求人工/结束，不能恢复自动模式']
] as const;
