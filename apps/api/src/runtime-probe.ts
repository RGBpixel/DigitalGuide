import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, canonical, type Principal } from '@digitalguide/domain';
import { inspectMedia, syntheticToneWav } from '@digitalguide/media';
import { selectAsrProvider, selectTtsProvider, type RuntimeAdapters } from '@digitalguide/providers';
import { runtimeProbeSchema, type SceneAppSnapshot, type RuntimeProbe } from '@digitalguide/contracts';
import type { SceneService } from './knowledge-service.js';
export async function runRuntimeProbe(scenes: SceneService, snapshot: SceneAppSnapshot, fixture: 'reception' | 'handoff', p: Principal, adapters: RuntimeAdapters, authorize = () => p): Promise<RuntimeProbe> {
  scenes.active(snapshot);
  const asr = selectAsrProvider(snapshot.asrProvider || 'disabled', scenes.environment, scenes.appEnv, adapters), tts = selectTtsProvider(snapshot.ttsProvider || 'disabled', scenes.environment, scenes.appEnv, adapters);
  const controller = new AbortController(), audio = syntheticToneWav(400, 440); let produced: Buffer | undefined;
  let rejectTimeout: (e: Error) => void = () => {};
  const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => { controller.abort(); rejectTimeout(new AppError('RUNTIME_TIMEOUT', '模拟语音链路检查超时，请重试或检查所选适配器。', 504)); }, 8000);
  try {
    const transcript = z.strictObject({ text: z.string().trim().min(1).max(500), simulated: z.literal(true) }).parse(await Promise.race([asr.transcribe({ audio, fixture, signal: controller.signal }), timeout]));
    scenes.active(snapshot); const answer = scenes.answer(snapshot, transcript.text, authorize());
    const synthesis = tts.synthesize({ text: answer.text, signal: controller.signal }).then(r => { if (controller.signal.aborted && Buffer.isBuffer(r.audio)) r.audio.fill(0); return r; });
    const result = await Promise.race([synthesis, timeout]); produced = result.audio;
    if (!Buffer.isBuffer(result.audio) || result.simulated !== true || result.kind !== 'synthetic_tones') throw new AppError('PROVIDER_CONTRACT_INVALID', 'TTS 模拟契约返回无效，未采用结果。', 502);
    const media = inspectMedia(result.audio); if (media.mediaType !== 'audio/wav') throw new AppError('PROVIDER_CONTRACT_INVALID', 'TTS 未返回有效 PCM WAV。', 502);
    scenes.active(snapshot); const current = authorize(); scenes.knowledge.version(scenes.app(current, snapshot.id), snapshot.version);
    if (canonical(scenes.answer(snapshot, transcript.text, current)) !== canonical(answer)) throw new AppError('STATE_CONFLICT', '检查期间知识或工具权限已变化，旧结果未采用，请重试。', 409);
    return runtimeProbeSchema.parse({ simulated: true, microphoneUsed: false, fixture, asr: { provider: asr.id, ...transcript }, model: { provider: answer.provider, text: answer.text, toolProposals: answer.toolProposals, simulated: true }, tts: { provider: tts.id, mediaType: 'audio/wav', kind: 'synthetic_tones', durationMs: media.specs.durationMs, sha256: createHash('sha256').update(result.audio).digest('hex'), contentBase64: result.audio.toString('base64') }, businessActionsExecuted: false });
  } catch (e) { if (e instanceof AppError) throw e; throw new AppError('PROVIDER_CONTRACT_INVALID', '模拟语音链路返回不符合契约，未采用结果；请检查所选适配器。', 502); }
  finally { clearTimeout(timer); controller.abort(); audio.fill(0); if (Buffer.isBuffer(produced)) produced.fill(0); }
}
