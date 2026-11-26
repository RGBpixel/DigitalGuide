import { z } from 'zod';
import {governancePublicReceiptSchema} from './generation-receipts.js';
const id=z.uuid(),version=z.int().positive();
export const publishingPlatforms=['douyin','kuaishou','weixin_channels','bilibili','xiaohongshu','youtube','linkedin','custom'] as const;
export const publishingPlatform=z.enum(publishingPlatforms);
export const publishingPlatformNames: Record<typeof publishingPlatforms[number],string>={douyin:'抖音',kuaishou:'快手',weixin_channels:'微信视频号',bilibili:'哔哩哔哩',xiaohongshu:'小红书',youtube:'YouTube',linkedin:'LinkedIn',custom:'自定义渠道'};
export const distributionFields=z.strictObject({exportId:id,platform:publishingPlatform,title:z.string().trim().min(1).max(100),description:z.string().max(3000).default(''),tags:z.array(z.string().trim().min(1).max(30)).max(10).default([]),coverAssetId:id,aiDisclosure:z.string().trim().min(1).max(300).default('AI辅助制作，请按渠道要求标注')});
export const distributionCreateInput=distributionFields.extend({workspaceId:id,rightsConfirmed:z.literal(true)});
export const distributionUpdateInput=distributionFields.extend({version,rightsConfirmed:z.literal(true)});
export const distributionProjectInput=z.strictObject({projectId:id,version,name:z.string().trim().min(1).max(100),ratio:z.enum(['landscape','portrait','square']),confirmed:z.literal(true)});
export const channelInput=z.strictObject({workspaceId:id,name:z.string().trim().min(1).max(80),platform:publishingPlatform,mode:z.enum(['manual','mock']),scenario:z.enum(['published','accepted','failed','unknown']).default('published')});
export const channelUpdateInput=z.strictObject({version,name:z.string().trim().min(1).max(80),enabled:z.boolean(),scenario:z.enum(['published','accepted','failed','unknown'])});
export const distributionReviewInput=z.strictObject({version,reviewerId:id,confirmed:z.literal(true)});
export const distributionDecisionInput=z.strictObject({version,decision:z.enum(['approve','request_changes']),note:z.string().trim().max(1000).default(''),confirmed:z.literal(true)}).refine(v=>v.decision==='approve'||v.note.length>0,{message:'退回时请说明修改原因。'});
export const publishingPlanInput=z.strictObject({variantId:id,version,accountId:id,accountVersion:version,scheduledAt:z.iso.datetime().nullable().default(null)});
export const publishingCreateInput=publishingPlanInput.extend({planHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)});
export const distributionVersionInput=z.strictObject({version});
export const publishingMockReceiptInput=z.strictObject({version,status:z.enum(['published','failed']),confirmed:z.literal(true)});
export const publishingReceiptInput=z.strictObject({eventId:id,jobId:id,remoteId:z.string().regex(/^mock-publish:[a-f0-9-]{36}$/),status:z.enum(['published','failed']),occurredAt:z.iso.datetime()});
export const channelSchema=z.strictObject({id,workspaceId:id,name:z.string(),platform:publishingPlatform,mode:z.enum(['manual','mock']),scenario:z.enum(['published','accepted','failed','unknown']),enabled:z.boolean(),version,canManage:z.boolean(),automaticAvailable:z.boolean(),limitations:z.array(z.string())});
export const distributionReviewSchema=z.strictObject({id,variantId:id,variantVersion:version,requesterId:id,reviewerId:id,reviewerName:z.string(),status:z.enum(['pending','approved','changes_requested']),effectiveStatus:z.enum(['pending','approved','changes_requested','stale']),version,note:z.string(),staleReason:z.string().nullable(),canDecide:z.boolean(),createdAt:z.string()});
export const distributionVariantSchema=distributionFields.extend({id,workspaceId:id,projectId:id,projectName:z.string(),projectVersion:version,version,problems:z.array(z.string()),videoUrl:z.string().nullable(),coverUrl:z.string().nullable(),reviews:z.array(distributionReviewSchema),reviewers:z.array(z.strictObject({id,name:z.string()})),approved:z.boolean(),canEdit:z.boolean(),createdAt:z.string()});
export const publishingPlanSchema=z.strictObject({hash:z.string(),canSchedule:z.boolean(),problems:z.array(z.string()),variantId:id,variantVersion:version,accountId:id,accountVersion:version,scheduledAt:z.string().nullable(),platform:publishingPlatform,title:z.string(),coverUrl:z.string().nullable(),videoUrl:z.string().nullable(),simulated:z.literal(true),externalCostMinor:z.literal(0)});
export const publishingContentSnapshotSchema=z.strictObject({format:z.literal('digitalguide-publishing'),schemaVersion:z.literal(1),variantId:id,variantVersion:version,platform:publishingPlatform,title:z.string(),description:z.string(),tags:z.array(z.string()),aiDisclosure:z.string(),projectId:id,projectVersion:version,exportId:id,deliveryReviewId:id,coverVersion:version,governance:governancePublicReceiptSchema.optional(),files:z.array(z.strictObject({name:z.string(),kind:z.string(),size:z.int().nonnegative(),sha256:z.string()})),creativeReviewId:id});
export const publishingJobSchema=z.strictObject({id,workspaceId:id,variantId:id,variantVersion:version,title:z.string(),accountId:id,accountName:z.string(),platform:publishingPlatform,snapshot:publishingContentSnapshotSchema,status:z.enum(['scheduled','submitting','submitted','published','failed','reconciling','cancelled','stale']),version,scheduledAt:z.string(),remoteId:z.string().nullable(),errorMessage:z.string().nullable(),canCancel:z.boolean(),canReconcile:z.boolean(),simulated:z.literal(true),createdAt:z.string(),updatedAt:z.string()});
export const distributionVersionSchema=distributionFields.extend({version,actorName:z.string(),createdAt:z.string()});
export type DistributionVersion=z.infer<typeof distributionVersionSchema>;
export const publishingPackageSchema=z.strictObject({id,variantId:id,variantVersion:version,status:z.enum(['queued','building','ready','failed','stale']),version,size:z.int().nonnegative().nullable(),sha256:z.string().nullable(),url:z.string().nullable(),errorMessage:z.string().nullable(),createdAt:z.string()});
export const publishingMetricsSchema=z.strictObject({jobId:id,simulated:z.literal(true),samples:z.array(z.strictObject({id,eventTime:z.string(),fetchedAt:z.string(),views:z.int().nonnegative(),likes:z.int().nonnegative(),comments:z.int().nonnegative()}))});
export type ChannelAccount=z.infer<typeof channelSchema>;
export type DistributionVariant=z.infer<typeof distributionVariantSchema>;
export type DistributionReview=z.infer<typeof distributionReviewSchema>;
export type PublishingPlan=z.infer<typeof publishingPlanSchema>;
export type PublishingJob=z.infer<typeof publishingJobSchema>;
export type PublishingPackage=z.infer<typeof publishingPackageSchema>;
export type PublishingMetrics=z.infer<typeof publishingMetricsSchema>;
export const distributionProjectResultSchema=z.strictObject({projectId:id,ratio:z.enum(['landscape','portrait','square']),notice:z.string()});
export const publishingCapabilitiesSchema=z.strictObject({platforms:z.array(z.strictObject({id:publishingPlatform,name:z.string(),automatic:z.literal('not_configured'),manualPackage:z.literal(true)})),simulatedAutomatic:z.boolean(),canEdit:z.boolean(),canPublish:z.boolean(),notice:z.string()});
export type PublishingCapabilities=z.infer<typeof publishingCapabilitiesSchema>;
export const distributionOperations=[
 ['post','/distribution/variant-projects',distributionProjectInput,'复制为可编辑横屏、竖屏或方形工程'],
 ['post','/distribution/variants',distributionCreateInput,'建立绑定实际成片和封面的平台变体'],
 ['post','/distribution/variants/{id}/update',distributionUpdateInput,'修改变体并使旧审批失效'],
 ['post','/distribution/variants/{id}/reviews',distributionReviewInput,'提交标题封面及平台的独立审核'],
 ['post','/distribution/reviews/{id}/decision',distributionDecisionInput,'指定审核员确认或退回传播变体'],
 ['post','/distribution/variants/{id}/packages',distributionVersionInput,'为已审核变体生成实际人工发布ZIP'],
 ['post','/distribution/accounts',channelInput,'创建明确模拟或人工渠道'],
 ['post','/distribution/accounts/{id}/update',channelUpdateInput,'更新版本化渠道配置'],
 ['post','/distribution/publish-plan',publishingPlanInput,'审阅具体作品、账号版本和排期'],
 ['post','/distribution/jobs',publishingCreateInput,'确认持久化模拟发布排期'],
 ['post','/distribution/jobs/{id}/cancel',distributionVersionInput,'取消尚未提交的排期'],
 ['post','/distribution/jobs/{id}/reconcile',distributionVersionInput,'按同一远端请求查询未知结果，不重发'],
 ['post','/distribution/jobs/{id}/metrics',distributionVersionInput,'收集标注模拟来源的渠道数据'],
 ['post','/distribution/jobs/{id}/mock-receipt',publishingMockReceiptInput,'明确模拟一次渠道回执']
] as const;
