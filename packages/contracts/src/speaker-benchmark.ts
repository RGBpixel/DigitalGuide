import { z } from 'zod';
export const speakerBenchmarkPlan = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1).max(100), frozenAt: z.iso.datetime(), mode: z.enum(['simulated', 'field']),
  hardware: z.strictObject({ microphone: z.string().min(1), loudspeaker: z.string().min(1), channels: z.int().positive(), sampleRateHz: z.int().positive(), distanceM: z.number().positive(), angleDeg: z.number().min(-180).max(180), rt60Ms: z.number().nonnegative(), preprocessing: z.string().min(1), sdkVersion: z.string().min(1), asrVersion: z.string().min(1) }),
  consentEvidenceIds: z.array(z.string().min(1)),
  scenarios: z.array(z.strictObject({ id: z.string().min(1), noise: z.string().min(1), snrDb: z.number(), overlapRatio: z.number().min(0).max(1) })).min(1).max(100),
  thresholds: z.strictObject({ targetRetentionMin: z.number().min(0.95).max(1), otherTriggerMax: z.number().min(0).max(0.01), wrongSwitchMax: z.number().min(0).max(0.01), bargeInSuccessMin: z.number().min(0.95).max(1), p95ReplyMsMax: z.number().positive().max(2500), p95StopMsMax: z.number().positive().max(500), minTarget: z.int().min(100), minOther: z.int().min(300), minBargeIn: z.int().min(50), businessMisoperationsMax: z.literal(0) })
}).superRefine((p, ctx) => {
  if (new Set(p.scenarios.map(s => s.id)).size !== p.scenarios.length) ctx.addIssue({ code: 'custom', message: '场景编号必须唯一。' });
  if (p.mode === 'field' && !p.consentEvidenceIds.length) ctx.addIssue({ code: 'custom', message: '现场计划必须引用授权证据。' });
});
export const speakerBenchmarkSamples = z.array(z.strictObject({
  id: z.string().min(1), pairId: z.string().min(1), condition: z.enum(['focus', 'baseline']), scenarioId: z.string().min(1), capturedAt: z.iso.datetime(), annotation: z.enum(['target', 'other']), accepted: z.boolean(), answered: z.boolean(), interrupted: z.boolean(), toolCalled: z.boolean(), wrongSwitch: z.boolean(), businessMisoperation: z.boolean(),
  bargeInExpected: z.boolean(), bargeInStopped: z.boolean(), replyLatencyMs: z.number().nonnegative().nullable(), stopLatencyMs: z.number().nonnegative().nullable(), referenceText: z.string().max(4000), recognizedText: z.string().max(4000), evidenceId: z.string().min(1)
})).max(100000);
export type SpeakerBenchmarkPlan = z.infer<typeof speakerBenchmarkPlan>;
export type SpeakerBenchmarkSample = z.infer<typeof speakerBenchmarkSamples>[number];
