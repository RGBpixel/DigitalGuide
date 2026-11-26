import { z } from 'zod';
const id = z.uuid(),version = z.int().positive();
export const timelinePlanInput = z.strictObject({ version,startMs: z.int().min(0).max(10800000),durationMs: z.int().min(100).max(30000) });
export const timelinePreviewInput = timelinePlanInput.extend({ planHash: z.string().regex(/^[a-f0-9]{64}$/),confirmed: z.literal(true) });
export const timelineCancelInput = z.strictObject({ version });
export interface TimelinePlan { projectId: string;version: number;hash: string;startMs: number;durationMs: number;width: number;height: number;fps: 15;clipCount: number;warnings: string[];canRender: boolean;estimatedMinor: null;mode: 'local_reference_preview' }
export const timelineRenderSchema = z.strictObject({ id,projectId: id,version,status: z.enum(['queued','rendering','succeeded','failed','cancelled']),startMs: z.int(),durationMs: z.int(),progress: z.number(),errorMessage: z.string().nullable(),videoUrl: z.string().nullable(),audioUrl: z.string().nullable(),width: z.int().nullable(),height: z.int().nullable(),fps: z.int().nullable(),sha256: z.string().nullable(),size: z.int().nullable(),warnings: z.array(z.string()),updatedAt: z.string(),simulatedAvatar: z.literal(true) });
export type TimelineRenderJob = z.infer<typeof timelineRenderSchema>;
export const timelineSuggestionsInput = z.strictObject({ version });
export const timelineOperations = [['post','/studio/projects/{id}/timeline-plan',timelinePlanInput,'审阅当前保存版本的本地时间线预览'],['post','/studio/projects/{id}/timeline-previews',timelinePreviewInput,'确认后生成实际本地 MP4 与 WAV 预览'],['post','/studio/timeline-previews/{id}/cancel',timelineCancelInput,'取消本地时间线预览任务'],['post','/studio/projects/{id}/timeline-suggestions',timelineSuggestionsInput,'分析当前文案并返回待审阅的本地规则建议']] as const;
