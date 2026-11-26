import {z} from 'zod';
import {contentRights} from './content.js';
import {contentSourceReference} from './content-drafts.js';
import {mediaTransferSchema} from './export.js';
const id=z.uuid(),version=z.int().positive(),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const recordingScript=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('manual'),text:z.string().max(60000)}),
  z.strictObject({kind:z.literal('draft'),id,version,sectionIds:z.array(id).min(1).max(40)}),
  z.strictObject({kind:z.literal('project'),id,version,segmentIds:z.array(id).min(1).max(20)})
]);
export const recordingConfiguration=z.strictObject({
  source:z.enum(['camera','screen','composite']),audio:z.enum(['none','microphone','system','mixed']),
  layout:z.enum(['landscape','portrait','square']),pipCorner:z.enum(['top-left','top-right','bottom-left','bottom-right']),
  script:recordingScript,fontSize:z.int().min(20).max(72),scrollSpeed:z.int().min(10).max(160),mirror:z.boolean()
}).refine(v=>v.source!=='camera'||!['system','mixed'].includes(v.audio),{message:'仅摄像头录制不提供系统声音。'});
export const recordingSnapshot=z.strictObject({configuration:recordingConfiguration,scriptText:z.string().max(60000),sourceRefs:z.array(contentSourceReference).max(10),expiresAt:z.iso.datetime(),scriptNotice:z.string()});
const fields={name:z.string().trim().min(1).max(80),configuration:recordingConfiguration,rights:contentRights};
export const recordingCreateInput=z.strictObject({workspaceId:id,...fields});
export const recordingSaveInput=z.strictObject({version,...fields});
export const recordingUploadInput=z.strictObject({version,fileName:z.string().trim().min(1).max(120),size:z.int().min(32).max(134217728),sha256:sha,partHashes:z.array(sha).min(1).max(32),recordedDurationMs:z.int().min(100).max(600000).nullable().default(null),confirmed:z.literal(true)});
export const recordingWithdrawInput=z.strictObject({version,confirmed:z.literal(true)});
export const recordingApplyInput=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('new_project'),version,name:z.string().trim().min(1).max(100),confirmed:z.literal(true)}),
  z.strictObject({kind:z.literal('append'),version,projectId:id,projectVersion:version,confirmed:z.literal(true)})
]);
export const recordingOutputSchema=z.strictObject({assetId:id,inputSHA256:sha,inputBytes:z.int().positive(),inputContainer:z.enum(['webm','mp4']),outputSHA256:sha,outputBytes:z.int().positive(),sourceSpecs:z.record(z.string(),z.number()),specs:z.record(z.string(),z.number()),rawUrl:z.string().nullable()});
export const recordingSchema=z.strictObject({id,workspaceId:id,name:z.string(),version,snapshot:recordingSnapshot.nullable(),rights:contentRights.omit({confirmed:true}).nullable(),available:z.boolean(),unavailableReason:z.string().nullable(),withdrawn:z.boolean(),transfer:mediaTransferSchema.nullable(),output:recordingOutputSchema.nullable(),updatedAt:z.string()});
export const recordingVersionSchema=z.strictObject({version,createdAt:z.string(),action:z.enum(['created','saved','upload_started','withdrawn']),snapshot:recordingSnapshot.nullable(),unavailableReason:z.string().nullable()});
export type Recording=z.infer<typeof recordingSchema>;
export type RecordingConfiguration=z.infer<typeof recordingConfiguration>;
export type RecordingSnapshot=z.infer<typeof recordingSnapshot>;
