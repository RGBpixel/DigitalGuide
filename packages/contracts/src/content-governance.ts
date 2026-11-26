import {z} from 'zod';
import {publishingPlatform} from './distribution.js';
import {generationDeclaration,governancePublicReceiptSchema} from './generation-receipts.js';
export {generationDeclaration,governancePublicReceiptSchema} from './generation-receipts.js';
export type {GovernancePublicReceipt} from './generation-receipts.js';
const id=z.uuid(),version=z.int().positive(),hash=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().trim().min(1);
export const governancePolicyDefinition=z.strictObject({
 schemaVersion:z.literal(1),
 labelPosition:z.enum(['top_left','top_right','bottom_left','bottom_right']),
 labelPrefix:z.string().trim().max(12),
 labelVideo:z.literal(true),labelCover:z.boolean(),
 blockedPhrases:z.array(text.max(100)).max(50),reviewPhrases:z.array(text.max(100)).max(50),
 referenceNote:text.max(1000)
});
export const governancePolicyCreate=z.strictObject({workspaceId:id,platform:publishingPlatform,name:text.max(100),definition:governancePolicyDefinition,confirmed:z.literal(true)});
export const governancePolicySave=governancePolicyCreate.omit({workspaceId:true,platform:true}).extend({version,enabled:z.boolean()});
export const governanceDeliveryInput=z.strictObject({variantId:id,variantVersion:version,policyId:id,policyVersion:version,generation:generationDeclaration,sourceStatement:text.max(2000)});
export const governanceDeliveryCreate=governanceDeliveryInput.extend({planHash:hash,confirmed:z.literal(true),rightsConfirmed:z.literal(true)});
export const governanceControl=z.strictObject({version,confirmed:z.literal(true)});
export const governanceReviewCreate=governanceControl.extend({reviewerId:id});
export const governanceDecision=governanceControl.extend({decision:z.enum(['approve','request_changes']),note:z.string().trim().max(2000),acknowledgedIssueIds:z.array(z.string().regex(/^[a-f0-9]{16}$/)).max(200)});
export const governanceIssueSchema=z.strictObject({id:z.string().regex(/^[a-f0-9]{16}$/),severity:z.enum(['blocked','review']),location:z.string(),phrase:z.string(),excerpt:z.string()});
export const governanceFactsSchema=z.strictObject({
 schemaVersion:z.literal(1),engine:z.literal('digitalguide.native_timeline'),environment:z.string(),
 generation:z.enum(['ai_generated','ai_assisted','not_ai','unknown']),declarationVerified:z.literal(false),
 projectId:id,projectVersion:version,exportId:id,sourceHash:hash,sourceVideoSHA256:hash,sourceCoverSHA256:hash,
 assets:z.array(z.strictObject({id,version,sha256:hash,category:z.string(),expiresAt:z.iso.datetime().nullable()})),
 advancedTemplateSources:z.array(z.strictObject({assetId:id,adoptionId:id,mode:z.enum(['local_aerender','contract_test']),manifestSHA256:hash,sourceVideoSHA256:hash,originSHA256:hash})).optional(),
 note:z.string()
});
export const governancePlanSchema=z.strictObject({hash,canCreate:z.boolean(),problems:z.array(z.string()),policyId:id,policyVersion:version,variantId:id,variantVersion:version,label:z.string(),sourceHash:hash.nullable(),facts:governanceFactsSchema.nullable(),issues:z.array(governanceIssueSchema),width:z.int().nullable(),height:z.int().nullable(),durationMs:z.int().nullable(),expiresAt:z.iso.datetime().nullable()});
export const governancePolicySchema=z.strictObject({id,workspaceId:id,platform:publishingPlatform,name:z.string(),definition:governancePolicyDefinition,version,enabled:z.boolean(),canManage:z.boolean(),updatedAt:z.iso.datetime()});
export const governanceReviewSchema=z.strictObject({id,deliveryId:id,reviewerId:id,reviewerName:z.string(),requesterId:id,status:z.enum(['pending','approved','changes_requested']),effectiveStatus:z.enum(['pending','approved','changes_requested','stale']),version,note:z.string(),staleReason:z.string().nullable(),canDecide:z.boolean(),createdAt:z.iso.datetime()});
export const governanceArtifactSchema=z.strictObject({id,kind:z.enum(['video','cover']),name:z.string(),mediaType:z.string(),size:z.int(),sha256:hash,url:z.string().nullable()});
export const governanceDeliverySchema=z.strictObject({
 id,workspaceId:id,variantId:id,variantVersion:version,platform:publishingPlatform,policyId:id,policyVersion:version,planHash:hash,
 generation:generationDeclaration,sourceStatement:z.string(),label:z.string(),facts:governanceFactsSchema,issues:z.array(governanceIssueSchema),
 status:z.enum(['queued','rendering','ready','failed','cancelled','withdrawn']),effectiveStatus:z.enum(['queued','rendering','ready','failed','cancelled','withdrawn','approved','changes_requested','stale']),
 version,attempts:z.int(),progress:z.int(),available:z.boolean(),unavailableReason:z.string().nullable(),errorMessage:z.string().nullable(),
 artifacts:z.array(governanceArtifactSchema),reviews:z.array(governanceReviewSchema),
 reviewers:z.array(z.strictObject({id,name:z.string()})),receipt:governancePublicReceiptSchema.nullable(),
 canRequestReview:z.boolean(),canControl:z.boolean(),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime()
});
export type GovernancePolicyDefinition=z.infer<typeof governancePolicyDefinition>;
export type GovernancePolicy=z.infer<typeof governancePolicySchema>;
export type GovernancePlan=z.infer<typeof governancePlanSchema>;
export type GovernanceDelivery=z.infer<typeof governanceDeliverySchema>;
export type GovernanceReview=z.infer<typeof governanceReviewSchema>;
export type GovernanceArtifact=z.infer<typeof governanceArtifactSchema>;
export type GovernanceFacts=z.infer<typeof governanceFactsSchema>;
export type GovernanceIssue=z.infer<typeof governanceIssueSchema>;
