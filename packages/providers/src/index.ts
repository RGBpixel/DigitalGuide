export * from './pos.js';
import type { Capability, JobInput } from '@digitalguide/contracts';
import { AppError } from '@digitalguide/domain';
export * from './notifications.js';
export interface ProviderResult { simulated: true; provider: string; remoteId: string; operation: string; message: string }
export interface TaskProvider { capabilities: Capability; execute(jobId: string, payload: JobInput, attempt: number): Promise<ProviderResult>; lookup(jobId: string): Promise<ProviderResult | null> }
export class ProviderError extends Error { constructor(public code: string, message: string, public retryable: boolean, public unknown = false) { super(message); } }
export class MockTaskProvider implements TaskProvider {
  capabilities: Capability = { id: 'mock-local', name: '本地模拟适配器', environment: 'mock', verification: 'contract_verified', features: ['provider.check', 'training.avatar', 'training.voice'], realCapabilities: [], cost: { currency: 'CNY', estimatedMinor: null }, limits: { maxConcurrent: 3, dailyJobs: 100 }, circuit: 'closed', nextStep: '本地流程可用。真实克隆、音频和业务渠道需要供应商账号及授权素材。' };
  async execute(jobId: string, payload: JobInput, attempt: number) {
    await new Promise(resolve => setTimeout(resolve, 250));
    if (payload.simulate === 'unknown') throw new ProviderError('PROVIDER_UNKNOWN', '模拟回执丢失，结果未知；请人工核对，系统不会自动重发。', false, true);
    if (payload.simulate === 'permanent_failure') throw new ProviderError('PROVIDER_REJECTED', '模拟提供商拒绝任务，请检查素材后重新提交。', false);
    if (payload.simulate === 'transient_failure' && attempt === 1) throw new ProviderError('PROVIDER_TIMEOUT', '模拟首次超时，稍后自动重试。', true);
    return { simulated: true as const, provider: 'mock-local', remoteId: 'mock:' + jobId, operation: payload.kind, message: payload.kind === 'provider.check' ? '模拟接口契约检查完成。未调用真实供应商。' : '模拟训练流程完成。未生成真人模型或克隆声音。' };
  }
  async lookup(): Promise<ProviderResult | null> { return null; }
}
export function selectProvider(mode: string): TaskProvider {
  if (mode !== 'mock') throw new AppError('PROVIDER_NOT_CONFIGURED', '当前环境尚未接入真实或沙箱供应商，请配置适配器；不会自动切换为模拟成功。', 409);
  return new MockTaskProvider();
}

export * from './office.js';
export * from './publishing.js';
export interface RealtimeProvider { id: string; environment: string; reply(text: string, context?: { publicFacts: { key: string; value: string }[] }): string }
export function selectRealtimeProvider(mode: string): RealtimeProvider {
  if (mode !== 'mock') throw new AppError('PROVIDER_NOT_CONFIGURED', '实时服务尚未接通，请使用人工接待；不会以模拟结果代替真实服务。', 409);
  return {
    id: 'mock-realtime', environment: 'mock',
    reply(text, context) {
      if (/记忆|偏好|喜好|称呼|喜欢什么/.test(text) && context) {
        const labels: Record<string, string> = { nickname: '称呼', company: '自述单位', like: '喜欢', avoid: '避免', interest: '交流话题' };
        return context.publicFacts.length ? '【模拟记忆回复】您已确认并允许本场所使用的资料：' + context.publicFacts.map(f => (labels[f.key] || '声明') + '：' + f.value).join('；') + '。您可随时纠正或撤回。' : '【模拟记忆回复】当前没有可用于接待的已确认偏好，您可以在下方自愿管理。';
      }
      if (/拜访|找|来访/.test(text)) return '【模拟回复】您可以在下方自愿填写来访登记，核对后再提交模拟通知。当前没有发送真实消息。';
      return '【模拟回复】您好，欢迎来到接待终端。当前可以使用文字交流、手动停止和请求人工服务。';
    }
  };
}

export * from './runtime.js';

export * from './speaker.js';
export * from './exhibit-device.js';
export * from './streaming.js';

export * from './payments.js';
export * from './system-speech.js';

export * from './advertising.js';

export * from './studio-editor.js';
