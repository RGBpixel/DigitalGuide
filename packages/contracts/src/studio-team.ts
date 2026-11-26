import { z } from 'zod';
import { deliverySettings,studioExportSchema } from './export.js';
import {templateParameters} from './template-controls.js';
const id = z.uuid(),version = z.int().positive(),sha = z.string().regex(/^[a-f0-9]{64}$/),variables = z.record(z.string(),z.string().max(1000));
export const batchData = z.strictObject({ format: z.enum(['json','csv']),content: z.string().min(2).max(1048576) });
export const batchPlanInput = z.strictObject({ workspaceId: id,name: z.string().trim().min(1).max(80),templateId: id,templateVersion: version,data: batchData,kind: z.enum(['video','audio']),settings: deliverySettings,maxInFlight: z.int().min(1).max(3).default(2),maxAttempts: z.int().min(1).max(3).default(3) });
export const batchCreateInput = batchPlanInput.extend({ planHash: sha,confirmed: z.literal(true),rightsConfirmed: z.literal(true),acceptInvalidRows: z.boolean().default(false) });
export const batchControlInput = z.strictObject({ version,action: z.enum(['pause','resume','cancel']) });
export const batchRetryInput = z.strictObject({ version,name: z.string().trim().min(1).max(100),variables,parameters:templateParameters.optional(),rightsConfirmed: z.literal(true) });
export const batchItemCancelInput = z.strictObject({ version });
const batchItemState = z.enum(['queued','rendering','succeeded','failed','cancelled']);
export const batchPlanSchema = z.strictObject({ hash: sha,canStart: z.boolean(),total: z.int(),validCount: z.int(),invalidCount: z.int(),templateName: z.string(),templateVersion: version,estimatedBytes: z.int().nonnegative(),externalCostMinor: z.literal(0),currency: z.literal('CNY'),warnings: z.array(z.string()),items: z.array(z.strictObject({ position: z.int(),name: z.string(),variables,parameters:templateParameters.optional(),valid: z.boolean(),error: z.string().nullable(),durationMs: z.int().nonnegative() })) });
export const batchSummarySchema = z.strictObject({ id,workspaceId: id,name: z.string(),templateName: z.string(),templateVersion: version,kind: z.enum(['video','audio']),maxInFlight: z.int(),maxAttempts: z.int(),status: z.enum(['running','paused','completed','completed_with_errors','cancelled']),version,counts: z.strictObject({ total: z.int(),queued: z.int(),rendering: z.int(),succeeded: z.int(),failed: z.int(),cancelled: z.int() }),progress: z.number().min(0).max(1),externalCostMinor: z.literal(0),canManage: z.boolean(),updatedAt: z.string() });
export const batchItemSchema = z.strictObject({ id,position: z.int(),name: z.string(),variables,parameters:templateParameters.optional(),status: batchItemState,version,attempts: z.int(),projectId: id.nullable(),exportId: id.nullable(),errorCode: z.string().nullable(),errorMessage: z.string().nullable(),export: studioExportSchema.nullable(),attemptHistory: z.array(z.strictObject({ attempt: z.int(),projectId: id.nullable(),exportId: id.nullable(),status: z.string(),errorMessage: z.string().nullable(),startedAt: z.string(),finishedAt: z.string().nullable() })) });
export const studioBatchSchema = batchSummarySchema.extend({ settings: deliverySettings,items: z.array(batchItemSchema),rightsConfirmedAt: z.string() });
export type StudioBatchPlan = z.infer<typeof batchPlanSchema>;
export type StudioBatchSummary = z.infer<typeof batchSummarySchema>;
export type StudioBatch = z.infer<typeof studioBatchSchema>;
export type StudioBatchItem = z.infer<typeof batchItemSchema>;
export const commentAnchor = z.strictObject({ segmentId: id.nullable().default(null),clipId: id.nullable().default(null),timeMs: z.int().min(0).max(10800000).nullable().default(null) });
export const commentCreateInput = z.strictObject({ version,body: z.string().trim().min(1).max(2000),anchor: commentAnchor,parentId: id.nullable().default(null) });
export const commentResolveInput = z.strictObject({ version,resolved: z.boolean() });
export const reviewCreateInput = z.strictObject({ version,stage: z.enum(['project','delivery']),exportId: id.nullable().default(null),reviewerId: id,confirmed: z.literal(true) }).refine(r => r.stage === 'delivery' ? !!r.exportId : !r.exportId,{ message: '成片审核需要选择本工程的已完成导出；工程审核不绑定成片。' });
export const reviewDecisionInput = z.strictObject({ version,decision: z.enum(['approve','request_changes']),note: z.string().trim().max(2000).default(''),confirmed: z.literal(true) }).refine(r => r.decision !== 'request_changes' || r.note.length > 0,{ message: '退回修改请填写原因。' });
export const reviewWithdrawInput = z.strictObject({ version });
export const studioCommentSchema = z.strictObject({ id,projectVersion: version,authorId: id,authorName: z.string(),parentId: id.nullable(),anchor: commentAnchor,body: z.string(),version,resolvedAt: z.string().nullable(),resolvedBy: id.nullable(),createdAt: z.string(),currentVersion: z.boolean(),canResolve: z.boolean() });
export const studioReviewSchema = z.strictObject({ id,projectId: id,projectName: z.string(),projectVersion: version,stage: z.enum(['project','delivery']),exportId: id.nullable(),requesterId: id,requesterName: z.string(),reviewerId: id,reviewerName: z.string(),status: z.enum(['pending','approved','changes_requested','withdrawn']),effectiveStatus: z.enum(['pending','approved','changes_requested','withdrawn','stale']),staleReason: z.string().nullable(),version,note: z.string(),decisionAt: z.string().nullable(),canDecide: z.boolean(),canWithdraw: z.boolean(),createdAt: z.string() });
export const studioTeamSchema = z.array(z.strictObject({ id,name: z.string(),canApprove: z.boolean(),canComment: z.boolean() }));
export const projectReviewSummarySchema = z.strictObject({ currentUserId: id,canComment: z.boolean(),canRequest: z.boolean(),canApprove: z.boolean(),reviews: z.array(studioReviewSchema),deliveries: z.array(studioExportSchema),reviewers: studioTeamSchema,approvedDeliveryIds: z.array(id) });
export type StudioComment = z.infer<typeof studioCommentSchema>;
export type StudioReview = z.infer<typeof studioReviewSchema>;
export type ProjectReviewSummary = z.infer<typeof projectReviewSummarySchema>;
export const studioTeamOperations = [
 ['post','/studio/batch-plan',batchPlanInput,'审阅固定模板版本、结构化数据与逐项错误'],['post','/studio/batches',batchCreateInput,'确认本地批量生产及素材用途'],['post','/studio/batches/{id}/control',batchControlInput,'暂停、继续或取消批次'],['post','/studio/batches/{id}/items/{itemId}/retry',batchRetryInput,'明确修正失败项并有界重试'],['post','/studio/batches/{id}/items/{itemId}/cancel',batchItemCancelInput,'取消单项且不影响其他任务'],
 ['post','/studio/projects/{id}/comments',commentCreateInput,'保存定位到特定工程版本的评论'],['post','/studio/projects/{id}/comments/{commentId}/resolve',commentResolveInput,'按权限处理评论'],['post','/studio/projects/{id}/reviews',reviewCreateInput,'指定独立审核者并提交当前工程或成片版本'],['post','/studio/reviews/{id}/decision',reviewDecisionInput,'指定审核者审批或退回当前快照'],['post','/studio/reviews/{id}/withdraw',reviewWithdrawInput,'撤回待审请求']
] as const;
