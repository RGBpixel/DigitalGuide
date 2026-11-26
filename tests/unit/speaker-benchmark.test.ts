import { describe, expect, it } from 'vitest';
import { benchmarkPlanHash, characterErrors, evaluateSpeakerBenchmark, wilson } from '../../packages/domain/src/speaker-benchmark.js';
import type { SpeakerBenchmarkSample } from '@digitalguide/contracts';
const plan = { schemaVersion: 1, id: 'synthetic-unit', frozenAt: '2026-11-19T00:00:00.000Z', mode: 'simulated', hardware: { microphone: 'synthetic', loudspeaker: 'synthetic', channels: 1, sampleRateHz: 16000, distanceM: 1, angleDeg: 0, rt60Ms: 300, preprocessing: 'none simulated', sdkVersion: 'mock-v1', asrVersion: 'fixture-v1' }, consentEvidenceIds: [], scenarios: [{ id: 'lobby-5-25', noise: 'synthetic lobby', snrDb: 5, overlapRatio: 0.25 }], thresholds: { targetRetentionMin: 0.95, otherTriggerMax: 0.01, wrongSwitchMax: 0.01, bargeInSuccessMin: 0.95, p95ReplyMsMax: 2500, p95StopMsMax: 500, minTarget: 100, minOther: 300, minBargeIn: 50, businessMisoperationsMax: 0 } };
function sample(id: string, annotation: 'target' | 'other' = 'target'): SpeakerBenchmarkSample { return { id, pairId: id, condition: 'focus', scenarioId: 'lobby-5-25', capturedAt: '2026-11-19T00:01:00.000Z', annotation, accepted: annotation === 'target', answered: annotation === 'target', interrupted: false, toolCalled: false, wrongSwitch: false, businessMisoperation: false, bargeInExpected: annotation === 'target', bargeInStopped: annotation === 'target', replyLatencyMs: annotation === 'target' ? 1000 : null, stopLatencyMs: annotation === 'target' ? 200 : null, referenceText: annotation === 'target' ? '你好' : '', recognizedText: annotation === 'target' ? '你好' : '', evidenceId: 'synthetic:' + id }; }
function evaluate(samples: SpeakerBenchmarkSample[], p = plan) { return evaluateSpeakerBenchmark(p, samples, benchmarkPlanHash(p)); }
describe('T37 预登记基准、统计和证据边界', () => {
  it('旁人回答、打断与工具的并集按语句计数，不能重复增加分子或分母', () => {
    const s = sample('other', 'other'); s.answered = s.interrupted = s.toolCalled = true; const result = evaluate([s]).overall;
    expect(result.otherTrigger).toMatchObject({ count: 1, total: 1, rate: 1 }); expect(result.otherAnswer.count).toBe(1); expect(result.targetRetention.total).toBe(0);
  });
  it('CER 对被拒目标也计算删除错误，按字符处理 Unicode，原文不进入报告', () => {
    expect(characterErrors('你好😀', '你😀')).toEqual({ edits: 1, characters: 3 }); const s = sample('rejected'); s.accepted = false; s.recognizedText = ''; s.referenceText = '不能泄漏的标注';
    const result = evaluate([s]); expect(result.overall.targetCer.rate).toBe(1); expect(result.overall.targetRetention.rate).toBe(0); expect(JSON.stringify(result)).not.toContain(s.referenceText);
  });
  it('零次观测仍有非零置信上界，没有样本时返回空值', () => {
    expect(wilson(0, 300).ci95![1]).toBeGreaterThan(0.01); expect(wilson(0, 0)).toMatchObject({ rate: null, ci95: null }); expect(wilson(100, 100).ci95![0]).toBeLessThan(1);
  });
  it('每个声明场景分别检查样本量，不用其他场景补齐分母', () => {
    const samples = [...Array.from({ length: 100 }, (_, i) => sample('t' + i)), ...Array.from({ length: 300 }, (_, i) => sample('o' + i, 'other'))].flatMap(s => [s, { ...s, id: s.id + '-baseline', condition: 'baseline' as const }]), p = { ...plan, scenarios: [...plan.scenarios, { ...plan.scenarios[0], id: 'unmeasured' }] };
    const result = evaluate(samples, p); expect(result.scenarios[0].observedThresholdsMet).toBe(true); expect(result.scenarios[1].reasons).toContain('insufficient_samples'); expect(result.scenarios[1].fallback).toContain('push_to_talk');
    expect(result.g2Acceptance).toContain('not_granted'); expect(result.simulated).toBe(true);
  });
  it('延迟使用最近秩 p95 且缺失测量不能算达标，真实误操作必须为零', () => {
    const samples: SpeakerBenchmarkSample[] = Array.from({ length: 100 }, (_, i) => ({ ...sample('t' + i), replyLatencyMs: i < 95 ? 1200 : 9000 }));
    expect(evaluate(samples).overall.replyTiming.p95Ms).toBe(1200); samples[0].replyLatencyMs = null; samples[1].businessMisoperation = true;
    const result = evaluate(samples).scenarios[0]; expect(result.reasons).toContain('reply_timing'); expect(result.reasons).toContain('business_misoperation');
  });
  it('拒绝看到结果后修改计划、重复样本、未知场景及采样早于预登记', () => {
    expect(() => evaluateSpeakerBenchmark({ ...plan, id: 'changed' }, [], benchmarkPlanHash(plan))).toThrow('哈希');
    expect(() => evaluate([sample('same'), sample('same')])).toThrow('重复'); expect(() => evaluate([{ ...sample('x'), scenarioId: 'unknown' }])).toThrow('未登记');
    expect(() => evaluate([{ ...sample('x'), capturedAt: '2026-11-18T00:00:00.000Z' }])).toThrow('早于');
  });
  it('缺少基线或配对不一致不能报告可用范围，配对差值按同一输入计算', () => {
    const s = sample('t'), base = { ...s, id: 'baseline', condition: 'baseline' as const, accepted: false, recognizedText: '' };
    expect(evaluate([s]).scenarios[0].reasons).toContain('baseline_missing_or_unpaired');
    expect(evaluate([s, base]).scenarios[0].changeFromBaseline).toMatchObject({ targetRetention: 1, targetCer: -1 });
    expect(() => evaluate([s, { ...base, evidenceId: 'different-audio' }])).toThrow('配对一致');
    expect(() => evaluate([s, { ...s, id: 'duplicate-condition' }])).toThrow('配对条件重复');
  });
  it('现场计划必须声明授权，导入现场数据不自动授予 G2 验收', () => {
    expect(() => benchmarkPlanHash({ ...plan, mode: 'field' })).toThrow();
    const p = { ...plan, mode: 'field', consentEvidenceIds: ['authorized-trial-reference'] };
    expect(evaluateSpeakerBenchmark(p, [], benchmarkPlanHash(p))).toMatchObject({ simulated: false, g2Acceptance: 'not_granted_requires_independent_evidence_review' });
  });
  it('不能降低基础样本量和初始质量阈值或设置重复场景', () => {
    expect(() => benchmarkPlanHash({ ...plan, thresholds: { ...plan.thresholds, minOther: 10 } })).toThrow();
    expect(() => benchmarkPlanHash({ ...plan, thresholds: { ...plan.thresholds, otherTriggerMax: 0.2 } })).toThrow();
    expect(() => benchmarkPlanHash({ ...plan, scenarios: [...plan.scenarios, ...plan.scenarios] })).toThrow();
  });
});
