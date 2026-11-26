import { randomUUID } from 'node:crypto';
import { AppError } from '@digitalguide/domain';
import type { SpeakerFixture } from '@digitalguide/contracts';
export interface SpeakerProviderCapabilities { attributionTiming: 'final' | 'early'; targetBargeIn: boolean; targetExtraction: 'simulated'; overlap: 'reject'; processingLocation: 'local_mock'; temporaryReference: true; enrolledReference: true; minReferenceDurationMs: number; supportedPlatforms: ['mock-events']; referenceDeletion: true }
export interface SpeakerReferenceResult { quality: 'adequate' | 'insufficient' | 'overlap' | 'mismatch'; providerReference: string | null; targetToken: string | null }
export interface SpeakerDecision { attribution: 'target' | 'other' | 'uncertain'; final: boolean; speechStarted: boolean; trackingLost: boolean; requiresPtt: boolean; reason: string }
export interface SpeakerFocusProvider { id: string; environment: 'mock'; capabilities: SpeakerProviderCapabilities; acquire(fixture: string, mode: 'temporary' | 'enrolled'): SpeakerReferenceResult; decide(fixture: SpeakerFixture): SpeakerDecision; deleteReference(reference: string): { status: 'completed_mock' } }
export interface RealSpeakerFocusProvider { id: string; environment: 'sandbox' | 'live'; acquire(input: { sessionId: string; focusVersion: number; authorizedReference: string; signal: AbortSignal }): Promise<SpeakerReferenceResult>; decide(input: { sessionId: string; focusVersion: number; segmentId: string; providerEvent: unknown; signal: AbortSignal }): Promise<SpeakerDecision>; deleteReference(reference: string, signal: AbortSignal): Promise<{ status: 'completed' | 'pending' }> }
export interface TargetSpeechProvider { id: string; environment: 'mock'; extract(fixture: SpeakerFixture): { simulated: true; separationVerified: false; usable: boolean; reason: string } }
export function selectSpeakerProvider(id: string, environment: string, appEnv: string): SpeakerFocusProvider {
  if (id === 'disabled') throw new AppError('CAPABILITY_UNAVAILABLE', '场景未启用专注对话，请使用文字或请工作人员配置。', 409);
  if (environment !== 'mock' || appEnv === 'production' || !['mock-focus-final', 'mock-focus-early'].includes(id)) throw new AppError('PROVIDER_NOT_CONFIGURED', '目标声音服务尚未接通，不会把未确认声音作为发问人。', 409);
  const early = id === 'mock-focus-early';
  return { id, environment: 'mock', capabilities: { attributionTiming: early ? 'early' : 'final', targetBargeIn: early, targetExtraction: 'simulated', overlap: 'reject', processingLocation: 'local_mock', temporaryReference: true, enrolledReference: true, minReferenceDurationMs: 2000, supportedPlatforms: ['mock-events'], referenceDeletion: true },
    acquire(fixture, mode) {
      const quality = fixture === 'too_short' || fixture === 'noisy' ? 'insufficient' : fixture === 'overlapping' ? 'overlap' : fixture === 'registered_mismatch' && mode === 'enrolled' ? 'mismatch' : 'adequate';
      return { quality, providerReference: quality === 'adequate' ? 'mock-reference:' + randomUUID() : null, targetToken: quality === 'adequate' ? 'mock-target:' + randomUUID() : null };
    },
    decide(fixture) {
      const speechStarted = fixture.endsWith('speech_started'), final = fixture.endsWith('final') || fixture === 'other_louder';
      const target = fixture.startsWith('target_') || fixture === 'ptt_target_final' || fixture === 'replay_match_final';
      const other = fixture.startsWith('other_') || fixture === 'echo_final' || fixture === 'noise_final';
      const attribution = (!final && !early) || fixture === 'uncertain_final' || fixture === 'overlap_final' || fixture === 'tracking_lost' ? 'uncertain' : target ? 'target' : other ? 'other' : 'uncertain';
      return { attribution, final, speechStarted, trackingLost: fixture === 'tracking_lost', requiresPtt: fixture === 'ptt_target_final', reason: fixture === 'overlap_final' ? 'overlapping_speakers' : fixture === 'echo_final' ? 'self_echo' : fixture === 'noise_final' ? 'background_noise' : 'mock_attribution' };
    }, deleteReference() { return { status: 'completed_mock' }; }
  };
}
export function selectTargetSpeechProvider(id: string, environment: string, appEnv: string): TargetSpeechProvider {
  if (id === 'disabled') throw new AppError('CAPABILITY_UNAVAILABLE', '目标语音提取未启用，请使用文字或受控按键回退。', 409);
  if (environment !== 'mock' || appEnv === 'production' || id !== 'mock-target-speech') throw new AppError('PROVIDER_NOT_CONFIGURED', '目标语音提取未接通，不能宣称已消除环境干扰。', 409);
  return { id, environment: 'mock', extract(fixture) { return { simulated: true, separationVerified: false, usable: !['overlap_final', 'uncertain_final', 'noise_final', 'echo_final'].includes(fixture), reason: fixture === 'overlap_final' ? 'overlap_not_separable' : fixture === 'noise_final' ? 'background_noise' : fixture === 'echo_final' ? 'self_echo' : fixture === 'uncertain_final' ? 'attribution_uncertain' : 'mock_mixture_contract' }; } };
}
