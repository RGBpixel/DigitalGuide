import { z } from 'zod';
import { contentBriefConfig } from './content.js';
const id=z.uuid(),version=z.int().positive(),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const contentSourceReference=z.strictObject({id,version,textSHA256:sha});
export const contentSection=z.strictObject({id,title:z.string().trim().min(1).max(100),text:z.string().max(4000),durationMs:z.int().min(1000).max(600000)});
export const contentBriefSnapshot=z.strictObject({id,version,configuration:contentBriefConfig});
export const contentDraftPayload=z.strictObject({
  name:z.string().trim().min(1).max(100),sourceRefs:z.array(contentSourceReference).max(10),
  brief:contentBriefSnapshot.nullable(),originProject:z.strictObject({id,version}).nullable(),
  inheritedExpiresAt:z.iso.datetime().nullable().default(null),
  sections:z.array(contentSection).min(1).max(40),provider:z.enum(['manual','local-rules','mock-content','local-model']),
  modelOrigin:z.strictObject({jobId:id,variantIndex:z.int().min(0).max(2),inputSHA256:sha,resultSHA256:sha,reviewOutcome:z.enum(['model-supported','needs-human-review']).optional(),reviewConfirmation:z.strictObject({actorId:id,at:z.iso.datetime(),reviewSHA256:sha}).optional()}).optional(),
  topic:z.string().max(200),instruction:z.string().max(1000)
});
export const contentDraftCreateInput=z.strictObject({
  workspaceId:id,name:z.string().trim().min(1).max(100),
  sources:z.array(z.strictObject({id,version})).max(10).default([]),
  briefId:id.nullable().default(null),briefVersion:version.nullable().default(null),
  topic:z.string().trim().max(200).default(''),provider:z.enum(['local-rules','mock-content','external-content']),
  chunkCharacters:z.int().min(200).max(4000).default(1000),confirmed:z.literal(true)
});
export const contentProjectDraftInput=z.strictObject({projectVersion:version,name:z.string().trim().min(1).max(100),segmentIds:z.array(id).min(1).max(20),confirmed:z.literal(true)});
export const contentDraftSaveInput=z.strictObject({version,name:z.string().trim().min(1).max(100),sections:z.array(contentSection).min(1).max(40),adoptCurrentBrief:z.boolean().default(false)});
export const contentDraftForkInput=z.strictObject({version,name:z.string().trim().min(1).max(100),confirmed:z.literal(true)});
export const contentDraftRestoreInput=z.strictObject({version,revision:version,confirmed:z.literal(true)});
export const contentDraftSchema=z.strictObject({
  id,workspaceId:id,rootId:id,parentId:id.nullable(),version,name:z.string(),payload:contentDraftPayload.nullable(),
  sourceAvailable:z.boolean(),sourceReason:z.string().nullable(),briefChanged:z.boolean(),simulated:z.boolean(),updatedAt:z.string()
});
export const contentDraftVersionSchema=z.strictObject({version,createdAt:z.string(),payload:contentDraftPayload.nullable(),sourceReason:z.string().nullable()});
const base={draftVersion:version,name:z.string().trim().min(1).max(100),confirmed:z.literal(true)};
export const contentPlanCreateInput=z.discriminatedUnion('kind',[
  z.strictObject({...base,kind:z.literal('draft_edit'),operation:z.enum(['normalize','shorten','replace','mock_rewrite','instruction','external_rewrite']),
    sectionIds:z.array(id).min(1).max(20),instruction:z.string().trim().max(1000).default(''),
    replacements:z.array(z.strictObject({sectionId:id,text:z.string().max(4000)})).max(20).default([])}),
  z.strictObject({...base,kind:z.literal('new_project'),projectName:z.string().trim().min(1).max(100),layout:z.enum(['landscape','portrait','square'])}),
  z.strictObject({...base,kind:z.literal('project_patch'),projectId:id,projectVersion:version,
    mappings:z.array(z.strictObject({sectionId:id,segmentId:id})).min(1).max(20)})
]);
export const contentPlanPatch=z.strictObject({sectionId:id,segmentId:id.nullable(),title:z.string(),beforeText:z.string().nullable(),afterText:z.string().max(4000),durationMs:z.int().positive()});
export const contentPlanSaveInput=z.strictObject({version,patches:z.array(z.strictObject({sectionId:id,afterText:z.string().max(4000)})).min(1).max(40)});
export const contentPlanApplyInput=z.strictObject({version,planHash:sha,acknowledgeMutedMedia:z.literal(true),confirmed:z.literal(true)});
export const contentPlanCancelInput=z.strictObject({version,confirmed:z.literal(true)});
export const contentPlanSchema=z.strictObject({
  id,draftId:id,draftVersion:version,kind:z.enum(['draft_edit','new_project','project_patch']),name:z.string(),version,
  status:z.enum(['review','applied','cancelled']),planHash:sha,patches:z.array(contentPlanPatch).nullable(),
  warnings:z.array(z.string()),sourceAvailable:z.boolean(),sourceReason:z.string().nullable(),staleReason:z.string().nullable(),
  simulated:z.boolean(),appliedResourceId:id.nullable(),appliedResourceVersion:version.nullable(),projectId:id.nullable(),updatedAt:z.string()
});
export const contentPlanVersionSchema=z.strictObject({version,createdAt:z.string(),planHash:sha,patches:z.array(contentPlanPatch).nullable(),sourceReason:z.string().nullable()});
export type ContentSection=z.infer<typeof contentSection>;
export type ContentSourceReference=z.infer<typeof contentSourceReference>;
export type ContentDraftPayload=z.infer<typeof contentDraftPayload>;
export type ContentDraft=z.infer<typeof contentDraftSchema>;
export type ContentPlan=z.infer<typeof contentPlanSchema>;
export type ContentPlanPatch=z.infer<typeof contentPlanPatch>;
