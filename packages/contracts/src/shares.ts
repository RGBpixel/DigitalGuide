import {z} from 'zod';
import {governancePublicReceiptSchema} from './generation-receipts.js';

const key=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),hash=z.string().regex(/^[a-f0-9]{64}$/),version=z.int().positive();
const title=z.string().trim().min(1).max(100),ms=z.int().min(0).max(10_800_000);
export const shareNavigation=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('seek'),timeMs:ms}),
 z.strictObject({kind:z.literal('link'),url:z.string().url().max(2000)}),
 z.strictObject({kind:z.literal('none')})
]);
export const shareWidget=z.strictObject({
 id:key,label:title,startMs:ms,endMs:ms,
 rect:z.strictObject({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(.04).max(1),height:z.number().min(.04).max(1)}),
 action:z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('seek'),timeMs:ms}),
  z.strictObject({kind:z.literal('link'),url:z.string().url().max(2000)}),
  z.strictObject({kind:z.literal('choice'),prompt:z.string().trim().min(1).max(300),options:z.array(z.strictObject({id:key,label:title,action:shareNavigation})).min(2).max(6)})
 ])
});
export const shareDefinition=z.strictObject({
 schemaVersion:z.literal(1),
 chapters:z.array(z.strictObject({id:key,title,timeMs:ms})).max(50),
 widgets:z.array(shareWidget).max(40),
 linkOrigins:z.array(z.string().url().max(300)).max(20)
});
export const shareCreate=z.strictObject({workspaceId:z.uuid(),name:title,variantId:z.uuid(),definition:shareDefinition});
export const shareSave=shareCreate.omit({workspaceId:true}).extend({version});
export const sharePublish=z.strictObject({version,planHash:hash,confirmed:z.literal(true),rightsConfirmed:z.literal(true)});
export const shareConfirm=z.strictObject({version,confirmed:z.literal(true)});
export const shareLinkCreate=z.strictObject({
 version,title,access:z.enum(['unlisted','public']),expiresAt:z.iso.datetime(),
 embedOrigins:z.array(z.string().url().max(300)).max(20),
 recordingEnabled:z.boolean(),retentionDays:z.int().min(1).max(90),confirmed:z.literal(true)
});
export const shareJoin=z.strictObject({access:hash.optional()});
export const shareConsent=z.strictObject({version,enabled:z.boolean()});
export const shareForget=z.strictObject({version});
export const shareEvent=z.strictObject({
 version,type:z.enum(['play','pause','seek','ended','progress','interaction']),timeMs:ms,
 widgetId:key.optional(),optionId:key.optional()
});
export const shareMediaSchema=z.strictObject({durationMs:ms,width:z.int().positive(),height:z.int().positive()});
export const sharePlanSchema=z.strictObject({hash,canPublish:z.boolean(),problems:z.array(z.string()),sourceHash:hash.nullable(),media:shareMediaSchema.nullable(),expiresAt:z.iso.datetime().nullable(),title:z.string(),aiDisclosure:z.string()});
export const shareReleaseSchema=z.strictObject({id:z.uuid(),shareId:z.uuid(),shareVersion:version,workspaceId:z.uuid(),name:title,hash,version,available:z.boolean(),unavailableReason:z.string().nullable(),withdrawnAt:z.iso.datetime().nullable(),createdAt:z.iso.datetime()});
export const shareDraftSchema=z.strictObject({id:z.uuid(),workspaceId:z.uuid(),name:title,variantId:z.uuid(),definition:shareDefinition,version,plan:sharePlanSchema,releases:z.array(shareReleaseSchema),canEdit:z.boolean(),canPublish:z.boolean(),updatedAt:z.iso.datetime()});
export const shareLinkSchema=z.strictObject({id:z.uuid(),releaseId:z.uuid(),title,access:z.enum(['unlisted','public']),version,expiresAt:z.iso.datetime(),embedOrigins:z.array(z.string()),recordingEnabled:z.boolean(),retentionDays:z.int(),revokedAt:z.iso.datetime().nullable(),available:z.boolean(),unavailableReason:z.string().nullable(),sessionCount:z.int(),createdAt:z.iso.datetime()});
export const shareIssuedSchema=z.strictObject({link:shareLinkSchema,url:z.string().url(),embedCode:z.string()});
export const shareViewerStateSchema=z.strictObject({version,recordingEnabled:z.boolean(),consent:z.boolean(),positionMs:ms,eventCount:z.int().min(0),expiresAt:z.iso.datetime(),retentionDays:z.int().min(1).max(90),csrfToken:hash});
export const sharePlayerSchema=z.strictObject({
 title:z.string(),description:z.string(),aiDisclosure:z.string(),definition:shareDefinition,media:shareMediaSchema,
 videoUrl:z.string(),captionUrl:z.string(),posterUrl:z.string(),state:shareViewerStateSchema,notice:z.string(),provenance:governancePublicReceiptSchema.optional(),provenanceUrl:z.string().optional()
});
export const shareStatsSchema=z.strictObject({
 notice:z.string(),consentingSessions:z.int().min(0),events:z.int().min(0),plays:z.int().min(0),completions:z.int().min(0),
 interactions:z.array(z.strictObject({widgetId:key,optionId:key.nullable(),count:z.int().min(0)}))
});
export type ShareDefinition=z.infer<typeof shareDefinition>;
export type ShareNavigation=z.infer<typeof shareNavigation>;
export type ShareWidget=z.infer<typeof shareWidget>;
export type ShareDraft=z.infer<typeof shareDraftSchema>;
export type SharePlan=z.infer<typeof sharePlanSchema>;
export type ShareRelease=z.infer<typeof shareReleaseSchema>;
export type ShareLink=z.infer<typeof shareLinkSchema>;
export type ShareIssued=z.infer<typeof shareIssuedSchema>;
export type ShareViewerState=z.infer<typeof shareViewerStateSchema>;
export type SharePlayer=z.infer<typeof sharePlayerSchema>;
export type ShareStats=z.infer<typeof shareStatsSchema>;
