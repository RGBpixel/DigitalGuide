import { z } from 'zod';
const id = z.uuid(), version = z.int().positive(), focusVersion = z.int().nonnegative();
export const focusProviderId = z.enum(['disabled', 'mock-focus-final', 'mock-focus-early', 'external-focus']);
export const targetSpeechProviderId = z.enum(['disabled', 'mock-target-speech', 'external-target-speech']);
export const focusState = z.enum(['idle', 'acquiring', 'locked', 'uncertain', 'reacquiring', 'handoff_pending', 'releasing', 'ended']);
export const referenceFixture = z.enum(['clear', 'too_short', 'overlapping', 'noisy', 'registered_mismatch', 'replay_match']);
export const speakerFixture = z.enum(['target_partial', 'target_final', 'target_crowd_final', 'other_partial', 'other_final', 'other_louder', 'uncertain_final', 'overlap_final', 'echo_final', 'noise_final', 'target_speech_started', 'other_speech_started', 'tracking_lost', 'ptt_target_final', 'replay_match_final']);
export type SpeakerFixture = z.infer<typeof speakerFixture>;
const useCode = z.string().regex(/^SF1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
export const speakerStartInput = z.strictObject({ version, focusVersion, mode: z.enum(['temporary', 'enrolled']), sameVisitorConfirmed: z.literal(true), consent: z.literal(true), noticeVersion: z.literal('speaker-v1'), useCode: useCode.optional() }).refine(v => v.mode !== 'enrolled' || !!v.useCode, { message: '登记参考需要本人授权使用码。' });
export const speakerSampleInput = z.strictObject({ version, focusVersion, fixture: referenceFixture });
export const speakerReacquireInput = z.strictObject({ version, focusVersion, sameVisitorConfirmed: z.literal(true) });
export const speakerReleaseInput = z.strictObject({ version, focusVersion, confirmed: z.literal(true) });
export const speakerHandoffInput = z.strictObject({ version, focusVersion, confirmed: z.literal(true), nextVisitorConfirmed: z.literal(true) });
export const speakerFallbackInput = z.strictObject({ version, focusVersion, mode: z.enum(['text', 'near_field', 'ptt']), confirmed: z.literal(true) });
export const speakerPttInput = z.strictObject({ version, focusVersion, confirmed: z.literal(true) });
export const speakerEventInput = z.strictObject({ focusVersion, segmentId: id, sequence: z.int().min(0).max(31), fixture: speakerFixture, text: z.string().max(1000).default(''), source: z.literal('mock_speaker_event') });
export const speakerEnrollInput = z.strictObject({ workspaceId: id, label: z.string().trim().min(1).max(80), purpose: z.literal('speaker_focus'), consent: z.literal(true), noticeVersion: z.literal('speaker-v1'), retentionDays: z.int().min(1).max(30), fixture: referenceFixture, provider: z.enum(['mock-focus-final', 'mock-focus-early']), source: z.literal('synthetic_fixture') });
export const speakerUseInput = z.strictObject({ referenceVersion: version, sessionId: id, focusVersion: focusVersion.optional(), confirmed: z.literal(true) });
export const speakerDeleteInput = z.strictObject({ version, confirmed: z.literal(true) });
export const speakerReferenceSchema = z.object({ id, workspaceId: id, label: z.string(), scope: z.enum(['temporary', 'enrolled']), quality: z.enum(['pending', 'adequate', 'insufficient', 'overlap', 'mismatch']), status: z.enum(['pending', 'active', 'deleted', 'expired']), version, provider: z.string(), expiresAt: z.iso.datetime(), deleteStatus: z.enum(['not_requested', 'completed_mock', 'pending_external']), createdAt: z.iso.datetime() });
export type SpeakerReference = z.infer<typeof speakerReferenceSchema>;
export const speakerFocusSchema = z.object({ state: focusState, enabled: z.boolean(), configured: z.boolean(), simulated: z.boolean(), mode: z.enum(['temporary', 'enrolled']).nullable(), focusVersion, sessionVersion: version, fallback: z.enum(['text', 'near_field', 'ptt']), reason: z.string(), reference: z.object({ scope: z.enum(['temporary', 'enrolled']), status: z.string(), quality: z.string(), expiresAt: z.iso.datetime() }).nullable(), capabilities: z.object({ attributionTiming: z.enum(['final', 'early']), targetBargeIn: z.boolean(), targetExtraction: z.literal('simulated'), overlap: z.literal('reject'), processingLocation: z.literal('local_mock') }).nullable(), pttReady: z.boolean(), counts: z.object({ accepted: z.int().nonnegative(), rejected: z.int().nonnegative(), buffered: z.int().nonnegative() }) });
export type SpeakerFocusView = z.infer<typeof speakerFocusSchema>;
export const speakerOperations = [
  ['post', '/guest/sessions/{id}/speaker-focus', speakerStartInput, '本人确认对象与独立用途后开始专注对话'],
  ['post', '/guest/sessions/{id}/speaker-focus/reference', speakerSampleInput, '使用明确模拟样例完成质量与参考确认'],
  ['post', '/guest/sessions/{id}/speaker-focus/reacquire', speakerReacquireInput, '本人重锁，递增目标版本并使旧确认失效'],
  ['post', '/guest/sessions/{id}/speaker-focus/release', speakerReleaseInput, '释放声音参考与短期字幕缓冲'],
  ['post', '/guest/sessions/{id}/speaker-focus/handoff', speakerHandoffInput, '结束旧访客并开启下一位的独立匿名会话'],
  ['post', '/guest/sessions/{id}/speaker-focus/fallback', speakerFallbackInput, '选择文字、近场说明或受控模拟按键模式'],
  ['post', '/guest/sessions/{id}/speaker-focus/ptt', speakerPttInput, '本人授权一次十秒内的模拟按键发言'],
  ['post', '/sessions/{id}/speaker-events', speakerEventInput, '仅管理员的明确模拟事件，非目标字幕不得进入会话'],
  ['post', '/sessions/{id}/speaker-focus/reference', speakerSampleInput, '管理员确认合成参考质量，不接收真实录音'],
  ['post', '/speaker-references', speakerEnrollInput, '本人独立授权登记合成参考，不使用克隆素材'],
  ['post', '/speaker-references/{id}/authorize-use', speakerUseInput, '本人为指定会话签发一次性参考使用码'],
  ['post', '/speaker-references/{id}/delete', speakerDeleteInput, '本人撤回参考并传播到会话、缓冲和使用码']
] as const;
