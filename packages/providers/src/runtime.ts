import { AppError } from '@digitalguide/domain';
import { inspectMedia, syntheticToneWav } from '@digitalguide/media';
import type { KnowledgeCitation, SceneTool, ToolProposal } from '@digitalguide/contracts';
export interface VisionProviderInput { frame: Buffer; width: number; height: number; question: string; source: 'camera' | 'screen'; signal: AbortSignal }
export interface VisionProviderResult { text: string; simulated: boolean }
export interface VisionProvider { id: string; environment: 'mock' | 'sandbox' | 'live'; inspect(input: VisionProviderInput): Promise<VisionProviderResult> }
export interface AsrProvider { id: string; environment: 'mock'; transcribe(input: { audio: Buffer; fixture: 'reception' | 'handoff'; signal: AbortSignal }): Promise<{ text: string; simulated: true }> }
export interface TtsProvider { id: string; environment: 'mock'; synthesize(input: { text: string; signal: AbortSignal }): Promise<{ audio: Buffer; simulated: true; kind: 'synthetic_tones' }> }
export interface RuntimeAdapters { vision?: VisionProvider; asr?: AsrProvider; tts?: TtsProvider }
export function selectAsrProvider(id: string, environment: string, appEnv: string, adapters: RuntimeAdapters = {}): AsrProvider {
  if (id === 'disabled') throw new AppError('CAPABILITY_UNAVAILABLE', '此应用未选择 ASR，请先配置模拟链路或真实接入。', 409);
  if (environment !== 'mock' || appEnv === 'production' || !['mock-asr', 'mock-asr-brief'].includes(id)) throw new AppError('PROVIDER_NOT_CONFIGURED', '选定的 ASR 尚未接通，不会切换到模拟字幕。', 409);
  if (adapters.asr?.id === id) return adapters.asr;
  return { id, environment: 'mock', async transcribe(input) {
    if (input.signal.aborted) throw new AppError('REQUEST_CANCELLED', '模拟 ASR 检查已取消。', 409);
    const media = inspectMedia(input.audio); if (media.mediaType !== 'audio/wav') throw new AppError('INVALID_MEDIA', 'ASR 模拟检查要求合成 PCM WAV。');
    return { simulated: true, text: input.fixture === 'handoff' ? (id === 'mock-asr' ? '请转人工接待' : '需要人工') : id === 'mock-asr' ? '您好，我想了解来访接待流程' : '您好' };
  } };
}
export function selectTtsProvider(id: string, environment: string, appEnv: string, adapters: RuntimeAdapters = {}): TtsProvider {
  if (id === 'disabled') throw new AppError('CAPABILITY_UNAVAILABLE', '此应用未选择 TTS，请先配置模拟链路或真实接入。', 409);
  if (environment !== 'mock' || appEnv === 'production' || !['mock-tone', 'mock-soft-tone'].includes(id)) throw new AppError('PROVIDER_NOT_CONFIGURED', '选定的 TTS 尚未接通，不会以模拟提示音代替真实语音。', 409);
  if (adapters.tts?.id === id) return adapters.tts;
  return { id, environment: 'mock', async synthesize(input) {
    if (input.signal.aborted) throw new AppError('REQUEST_CANCELLED', '模拟 TTS 检查已取消。', 409);
    return { simulated: true, kind: 'synthetic_tones', audio: syntheticToneWav(Math.min(2400, Math.max(400, input.text.length * 12)), id === 'mock-tone' ? 440 : 330, id === 'mock-soft-tone') };
  } };
}
export interface LocalModelInput { question: string; citations: KnowledgeCitation[]; tools: SceneTool[]; hostNames: string[] }
export function selectLanguageProvider(id: string, environment: string, appEnv: string) {
  if (environment !== 'mock' || appEnv === 'production' || !['mock-grounded', 'mock-brief'].includes(id)) throw new AppError('PROVIDER_NOT_CONFIGURED', '选定的真实模型尚未接通，不会静默切换为模拟回答。', 409);
  return { id, environment: 'mock' as const, respond(input: LocalModelInput): { text: string; toolProposals: ToolProposal[] } {
    const handoff = /(?:请|需要|想|我要|帮我).{0,8}人工/.test(input.question) && input.tools.includes('reception.handoff');
    const toolProposals: ToolProposal[] = handoff ? [{ name: 'reception.handoff', label: '请求工作人员接待' }] : [];
    let content = input.citations.length ? input.citations.map(c => '〈' + c.title + '〉第 ' + c.version + ' 版：' + c.snippet).join('\n') : '未找到当前受众和场景可用的已发布资料，请换个问题或联系工作人员。';
    if (input.hostNames.length) content = '当前场所公开的接待人：' + input.hostNames.join('、') + '。可在来访登记中选择并核对，尚未通知任何人。';
    if (handoff) content = '可以为您请求工作人员接待。请在下方核对并确认，确认前仍保持当前接待状态。';
    return { text: '【模拟知识回答】' + (id === 'mock-brief' ? content.slice(0, 180) : content), toolProposals };
  } };
}
export function selectVisionProvider(providerId: string, environment: string, appEnv: string, adapters: RuntimeAdapters = {}): VisionProvider {
  if (providerId === 'mock-vision' && environment === 'mock' && appEnv !== 'production') {
    if (adapters.vision?.id === providerId && adapters.vision.environment === environment) return adapters.vision;
    return { id: providerId, environment: 'mock', async inspect(input) {
      if (input.signal.aborted) throw new AppError('REQUEST_CANCELLED', '画面分析已取消。', 409);
      return { simulated: true, text: '【模拟画面检查】已接收您本次主动分享的' + (input.source === 'camera' ? '相机' : '屏幕') + '画面（' + input.width + ' × ' + input.height + '）。当前未连接视觉理解服务，无法判断画面中的人物、文字或物品。您的问题可继续通过文字或人工接待处理。' };
    } };
  }
  if (providerId === 'external-vision' && environment !== 'mock' && adapters.vision?.id === providerId && adapters.vision.environment === environment) return adapters.vision;
  throw new AppError('PROVIDER_NOT_CONFIGURED', providerId === 'disabled' ? '此应用未启用画面问答，请继续使用文字。' : '选定的视觉服务尚未接通，不会静默切换为模拟识别。', 409);
}
