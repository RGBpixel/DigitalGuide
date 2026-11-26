import { createHash } from 'node:crypto';
import { speakerBenchmarkPlan, speakerBenchmarkSamples, type SpeakerBenchmarkSample } from '@digitalguide/contracts';

export function wilson(success: number, total: number) {
  if (!total) return { count: success, total, rate: null, ci95: null };
  const z = 1.959963984540054, p = success / total, denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator, half = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return { count: success, total, rate: p, ci95: [Math.max(0, center - half), Math.min(1, center + half)] };
}
export function characterErrors(reference: string, recognized: string) {
  const a = Array.from(reference.normalize('NFC')), b = Array.from(recognized.normalize('NFC'));
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) { const next = [i + 1]; for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + +(a[i] !== b[j]))); row = next; }
  return { edits: row[b.length], characters: a.length };
}
function percentile(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null; }
function summarize(samples: SpeakerBenchmarkSample[]) {
  const target = samples.filter(s => s.annotation === 'target'), other = samples.filter(s => s.annotation === 'other'), barge = target.filter(s => s.bargeInExpected), acceptedTarget = target.filter(s => s.accepted);
  const errors = target.reduce((sum, s) => { const e = characterErrors(s.referenceText, s.recognizedText); return { edits: sum.edits + e.edits, characters: sum.characters + e.characters }; }, { edits: 0, characters: 0 });
  return { samples: samples.length, targetRetention: wilson(acceptedTarget.length, target.length), otherTrigger: wilson(other.filter(s => s.answered || s.interrupted || s.toolCalled).length, other.length), otherAnswer: wilson(other.filter(s => s.answered).length, other.length), otherInterrupt: wilson(other.filter(s => s.interrupted).length, other.length), otherTool: wilson(other.filter(s => s.toolCalled).length, other.length), wrongSwitch: wilson(samples.filter(s => s.wrongSwitch).length, samples.length), bargeIn: wilson(barge.filter(s => s.bargeInStopped).length, barge.length), targetCer: { ...errors, rate: errors.characters ? errors.edits / errors.characters : null }, businessMisoperations: samples.filter(s => s.businessMisoperation).length,
    replyTiming: { measured: acceptedTarget.filter(s => s.replyLatencyMs !== null).length, expected: acceptedTarget.length, p95Ms: percentile(acceptedTarget.flatMap(s => s.replyLatencyMs === null ? [] : [s.replyLatencyMs])) }, stopTiming: { measured: barge.filter(s => s.bargeInStopped && s.stopLatencyMs !== null).length, expected: barge.filter(s => s.bargeInStopped).length, p95Ms: percentile(barge.filter(s => s.bargeInStopped).flatMap(s => s.stopLatencyMs === null ? [] : [s.stopLatencyMs])) } };
}
export function benchmarkPlanHash(input: unknown) { return createHash('sha256').update(JSON.stringify(speakerBenchmarkPlan.parse(input))).digest('hex'); }
export function evaluateSpeakerBenchmark(planInput: unknown, sampleInput: unknown, expectedPlanHash: string) {
  const plan = speakerBenchmarkPlan.parse(planInput), samples = speakerBenchmarkSamples.parse(sampleInput), planHash = benchmarkPlanHash(plan);
  if (planHash !== expectedPlanHash) throw new Error('计划哈希不符；阈值和测试矩阵须在采样前固定。');
  if (new Set(samples.map(s => s.id)).size !== samples.length) throw new Error('样本编号重复，不能重复计入分母。');
  for (const s of samples) {
    if (!plan.scenarios.some(p => p.id === s.scenarioId)) throw new Error('样本引用未登记场景。');
    if (Date.parse(s.capturedAt) < Date.parse(plan.frozenAt)) throw new Error('样本采集早于预登记计划。');
    if (s.annotation === 'target' && !s.referenceText.length) throw new Error('目标有效语句必须有人工作为分母的文本标注。');
    if (s.annotation === 'other' && s.bargeInExpected) throw new Error('非目标样本不能标记为目标打断。');
  }
  const pairs = new Map<string, Partial<Record<'focus' | 'baseline', SpeakerBenchmarkSample>>>();
  for (const s of samples) {
    const key = s.scenarioId + ':' + s.pairId, pair = pairs.get(key) || {};
    if (pair[s.condition]) throw new Error('同一配对条件重复，不能增加分母。');
    const other = pair[s.condition === 'focus' ? 'baseline' : 'focus'];
    if (other && (s.annotation !== other.annotation || s.referenceText !== other.referenceText || s.evidenceId !== other.evidenceId || s.bargeInExpected !== other.bargeInExpected)) throw new Error('基线和专注输入的标注、原始证据与插话条件必须配对一致。');
    pair[s.condition] = s; pairs.set(key, pair);
  }
  const t = plan.thresholds;
  const scenarios = plan.scenarios.map(scenario => {
    const selected = samples.filter(s => s.scenarioId === scenario.id), metrics = summarize(selected.filter(s => s.condition === 'focus')), baseline = summarize(selected.filter(s => s.condition === 'baseline')), reasons: string[] = [];
    const paired = [...pairs.values()].filter(p => p.focus?.scenarioId === scenario.id && p.baseline).length;
    if (paired !== metrics.samples || paired !== baseline.samples || !paired) reasons.push('baseline_missing_or_unpaired');
    if (metrics.targetRetention.total < t.minTarget || metrics.otherTrigger.total < t.minOther || metrics.bargeIn.total < t.minBargeIn) reasons.push('insufficient_samples');
    if ((metrics.targetRetention.rate ?? 0) < t.targetRetentionMin) reasons.push('target_retention');
    if ((metrics.otherTrigger.rate ?? 1) > t.otherTriggerMax) reasons.push('other_trigger');
    if ((metrics.wrongSwitch.rate ?? 1) > t.wrongSwitchMax) reasons.push('wrong_switch');
    if ((metrics.bargeIn.rate ?? 0) < t.bargeInSuccessMin) reasons.push('target_barge_in');
    if (metrics.replyTiming.measured !== metrics.replyTiming.expected || metrics.replyTiming.p95Ms === null || metrics.replyTiming.p95Ms > t.p95ReplyMsMax) reasons.push('reply_timing');
    if (metrics.stopTiming.measured !== metrics.stopTiming.expected || metrics.stopTiming.p95Ms === null || metrics.stopTiming.p95Ms > t.p95StopMsMax) reasons.push('stop_timing');
    if (metrics.businessMisoperations > t.businessMisoperationsMax) reasons.push('business_misoperation');
    const delta = (a: number | null, b: number | null) => a === null || b === null ? null : a - b;
    return { ...scenario, metrics, baseline, pairedSamples: paired, changeFromBaseline: { targetRetention: delta(metrics.targetRetention.rate, baseline.targetRetention.rate), targetCer: delta(metrics.targetCer.rate, baseline.targetCer.rate), otherTrigger: delta(metrics.otherTrigger.rate, baseline.otherTrigger.rate), replyP95Ms: delta(metrics.replyTiming.p95Ms, baseline.replyTiming.p95Ms), stopP95Ms: delta(metrics.stopTiming.p95Ms, baseline.stopTiming.p95Ms) }, observedThresholdsMet: reasons.length === 0, reasons, fallback: reasons.length ? ['near_field', 'push_to_talk', 'take_turns', 'human'] : [] };
  });
  return { schemaVersion: 1, planId: plan.id, planHash, mode: plan.mode, generatedAt: new Date().toISOString(), simulated: plan.mode === 'simulated', g2Acceptance: 'not_granted_requires_independent_evidence_review', sampleCount: samples.length, thresholds: plan.thresholds, hardware: plan.hardware, scenarios, overall: summarize(samples.filter(s => s.condition === 'focus')), baselineOverall: summarize(samples.filter(s => s.condition === 'baseline')), notes: ['比例采用预登记分母及 Wilson 95% 区间，零次观测错误不等于真实错误概率为零。', 'CER 按 NFC 后 Unicode 字符计算，包含标点空格；原文不进入报告。', '相同原始音频与标注按 pairId 配对，缺少未启用方案基线不能满足观测阈值。', '模拟结果只验证统计契约，现场数据导入也不自动授予 G2 验收。'] };
}
