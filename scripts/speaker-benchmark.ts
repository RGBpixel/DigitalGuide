import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { benchmarkPlanHash, evaluateSpeakerBenchmark } from '../packages/domain/src/speaker-benchmark.js';
const [command, planPath, samplesPath, hash, outputPath] = process.argv.slice(2);
if (command === 'hash' && planPath) console.log(benchmarkPlanHash(JSON.parse(readFileSync(planPath, 'utf8'))));
else if (command === 'report' && planPath && samplesPath && hash && outputPath) {
  const report = evaluateSpeakerBenchmark(JSON.parse(readFileSync(planPath, 'utf8')), JSON.parse(readFileSync(samplesPath, 'utf8')), hash), output = resolve(outputPath);
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  const percent = (n: number | null) => n === null ? '无样本' : (n * 100).toFixed(2) + '%';
  writeFileSync(output + '.md', `# 专注对话基准报告\n\n计划 ${report.planId}｜${report.simulated ? '合成数据，仅验证统计' : '现场数据，待独立证据审查'}｜${report.sampleCount} 条\n\n| 场景 | SNR | 重叠 | 目标保留 | 旁人触发 | CER | 观测阈值 |\n| --- | --- | --- | --- | --- | --- | --- |\n` + report.scenarios.map(s => `| ${s.id} | ${s.snrDb} dB | ${percent(s.overlapRatio)} | ${percent(s.metrics.targetRetention.rate)}（${s.metrics.targetRetention.total}） | ${percent(s.metrics.otherTrigger.rate)}（${s.metrics.otherTrigger.total}） | ${percent(s.metrics.targetCer.rate)} | ${s.observedThresholdsMet ? '满足；仍需核验原始证据' : s.reasons.join(', ')} |`).join('\n') + '\n\n' + report.notes.join('\n\n') + '\n');
  console.log(JSON.stringify({ output, sampleCount: report.sampleCount, simulated: report.simulated, g2Acceptance: report.g2Acceptance }));
} else throw new Error('用法：speaker-benchmark.ts hash <plan.json>；report <plan.json> <samples.json> <预登记hash> <report.json>');
