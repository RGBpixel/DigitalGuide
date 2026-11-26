import {z} from 'zod';
import {contentRights} from './content.js';
import {semanticClipSettings,semanticSourceSnapshot,semanticEngineSchema,semanticClipAnalysis,semanticClipBasis} from './semantic-clips.js';
import {restorationSettings,restorationEngineSchema} from './restoration.js';
import {gazeSettings,gazeEngineSchema,gazeTraceFrame} from './gaze.js';
import {denoisingEngineSchema} from './denoising.js';
const id=z.uuid(),version=z.int().positive(),sha=z.string().regex(/^[a-f0-9]{64}$/),ms=z.int().min(0).max(600000);
const range={startMs:ms.default(0),durationMs:z.int().min(100).max(600000).nullable().default(null)};
const provider={provider:z.enum(['local-media','mock-media','external-media'])};
export const mediaClipRange=z.strictObject({name:z.string().trim().min(1).max(80),startMs:ms,durationMs:z.int().min(100).max(600000)});
export const subjectTrackingSettings=z.strictObject({aspect:z.enum(['landscape','portrait','square']),longestSide:z.union([z.literal(720),z.literal(1080),z.literal(1920),z.literal(3840)]),seed:z.strictObject({x:z.number().min(0).max(1),y:z.number().min(0).max(1)}),responseMs:z.int().min(0).max(2000),maxLostMs:z.int().min(0).max(2000),padding:z.number().min(0).max(.25)});
export type SubjectTrackingSettings=z.infer<typeof subjectTrackingSettings>;
export const mediaInspectionFrameQuery=z.strictObject({frame:z.coerce.number().int().min(0).max(36000),sourceVersion:z.coerce.number().int().positive(),sourceSHA256:sha});
export const mediaProcessingConfiguration=z.discriminatedUnion('operation',[
  z.strictObject({...provider,...range,operation:z.literal('denoise'),noiseReduction:z.number().min(1).max(30),noiseFloor:z.number().min(-80).max(-20),trackNoise:z.boolean()}),
  z.strictObject({...provider,...range,operation:z.literal('neural_denoise'),attenuationDb:z.number().min(1).max(100),postFilter:z.boolean()}),
  z.strictObject({...provider,...range,operation:z.literal('key'),color:z.string().regex(/^#[a-fA-F0-9]{6}$/),similarity:z.number().min(.01).max(1),blend:z.number().min(0).max(1)}),
  z.strictObject({...provider,...range,operation:z.literal('reframe'),aspect:z.enum(['source','landscape','portrait','square']),longestSide:z.union([z.literal(720),z.literal(1080),z.literal(1920),z.literal(3840)]),fit:z.enum(['contain','cover']),crop:z.strictObject({x:z.number().min(0).max(.98),y:z.number().min(0).max(.98),width:z.number().min(.02).max(1),height:z.number().min(.02).max(1)}).refine(v=>v.x+v.width<=1.000001&&v.y+v.height<=1.000001)}),
  z.strictObject({...provider,operation:z.literal('split'),ranges:z.array(mediaClipRange).min(1).max(20)}),
  z.strictObject({...provider,operation:z.literal('scene_suggest'),threshold:z.number().min(.01).max(.9),minClipMs:z.int().min(500).max(600000),maxClipMs:z.int().min(1000).max(600000)}),
  z.strictObject({...provider,...range,operation:z.literal('enhance'),scale:z.enum(['source','double','uhd']),sharpen:z.number().min(0).max(2),denoise:z.number().min(0).max(4),contrast:z.number().min(.5).max(2),brightness:z.number().min(-.3).max(.3),saturation:z.number().min(0).max(2),deinterlace:z.boolean()}),
  z.strictObject({...provider,...range,operation:z.literal('subject_tracking'),strength:z.number().min(0).max(1),instruction:z.string().trim().max(500),tracking:subjectTrackingSettings.optional()}),
  z.strictObject({...provider,...range,operation:z.literal('semantic_split'),strength:z.number().min(0).max(1),instruction:z.string().trim().max(500),semantic:semanticClipSettings.optional()}),
  z.strictObject({...provider,...range,operation:z.literal('restore'),strength:z.number().min(0).max(1),instruction:z.string().trim().max(500),restoration:restorationSettings.optional()}),
  z.strictObject({...provider,...range,operation:z.literal('gaze'),strength:z.number().min(0).max(1),instruction:z.string().trim().max(500),gaze:gazeSettings.optional()}),
  z.strictObject({...provider,...range,operation:z.literal('segmentation'),strength:z.number().min(0).max(1),instruction:z.string().trim().max(500)})
]);
export const mediaSourceSnapshot=z.strictObject({id,version,sha256:sha,size:z.int().positive(),mediaType:z.enum(['image/png','audio/wav','video/mp4','video/quicktime']),name:z.string(),specs:z.record(z.string(),z.number()),expiresAt:z.iso.datetime().nullable(),synthetic:z.boolean()});
export const segmentationEngineSchema=z.strictObject({modelId:z.literal('u2netp-rembg-v0'),modelSha256:sha,runtime:z.literal('onnxruntime-web-wasm'),runtimeVersion:z.literal('1.31.1'),runtimeSha256:sha,preprocessing:z.literal('u2netp-rgba-bilinear-maxnorm-v1')});
export type SegmentationEngine=z.infer<typeof segmentationEngineSchema>;
export const trackingEngineSchema=segmentationEngineSchema.extend({trackingPolicy:z.literal('u2netp-components-motion-crop-v1')});
export type TrackingEngine=z.infer<typeof trackingEngineSchema>;
export const foregroundEngineSchema=z.union([segmentationEngineSchema,trackingEngineSchema]);
export type ForegroundEngine=z.infer<typeof foregroundEngineSchema>;
export const mediaEngineSchema=z.union([foregroundEngineSchema,semanticEngineSchema,restorationEngineSchema,gazeEngineSchema,denoisingEngineSchema]);
export type MediaEngine=z.infer<typeof mediaEngineSchema>;
export const mediaProcessingCapabilitiesSchema=z.strictObject({localOperations:z.array(z.string()),modelOperations:z.array(z.string()),segmentation:z.strictObject({available:z.boolean(),engine:segmentationEngineSchema.nullable(),reason:z.string().nullable(),execution:z.string(),modelInputWidth:z.literal(320),modelInputHeight:z.literal(320),foregroundClasses:z.string()}),subjectTracking:z.strictObject({available:z.boolean(),engine:trackingEngineSchema.nullable(),reason:z.string().nullable(),notice:z.string()}).optional(),semanticClips:z.strictObject({available:z.boolean(),engine:semanticEngineSchema.nullable(),reason:z.string().nullable(),notice:z.string()}).optional(),restoration:z.strictObject({available:z.boolean(),engine:restorationEngineSchema.nullable(),reason:z.string().nullable(),notice:z.string()}).optional(),gaze:z.strictObject({available:z.boolean(),engine:gazeEngineSchema.nullable(),reason:z.string().nullable(),notice:z.string(),geometryOnly:z.literal(true)}).optional(),denoising:z.strictObject({available:z.boolean(),engine:denoisingEngineSchema.nullable(),reason:z.string().nullable(),notice:z.string()}).optional(),externalModelConfigured:z.literal(false),mockReports:z.boolean(),transparentFormat:z.string(),maxDurationMs:z.literal(600000),notice:z.string()});
export type MediaProcessingCapabilities=z.infer<typeof mediaProcessingCapabilitiesSchema>;
export const mediaProcessingPayload=z.strictObject({name:z.string().trim().min(1).max(80),source:mediaSourceSnapshot,configuration:mediaProcessingConfiguration,rights:contentRights,engine:mediaEngineSchema.optional(),semanticSource:semanticSourceSnapshot.optional(),semanticBasis:semanticClipBasis.optional()});
export const mediaProcessingCreateInput=z.strictObject({workspaceId:id,name:z.string().trim().min(1).max(80),sourceAssetId:id,sourceVersion:version,configuration:mediaProcessingConfiguration,rights:contentRights});
export const mediaProcessingSaveInput=z.strictObject({version,name:z.string().trim().min(1).max(80),sourceVersion:version,configuration:mediaProcessingConfiguration,rights:contentRights});
export const mediaProcessingRunInput=z.strictObject({version,planHash:sha,confirmed:z.literal(true)});
export const mediaProcessingControlInput=z.strictObject({version,action:z.enum(['cancel','retry','accept_mock','reject_mock'])});
export const mediaProcessingWithdrawInput=z.strictObject({version,confirmed:z.literal(true)});
export const mediaProcessingOutputPreview=z.strictObject({name:z.string(),mediaType:z.string(),width:z.int().nullable(),height:z.int().nullable(),startMs:ms,durationMs:z.int().nullable(),alpha:z.boolean()});
export const mediaProcessingPlanSchema=z.strictObject({id,workspaceId:id,name:z.string(),version,planHash:sha,payload:mediaProcessingPayload.nullable(),available:z.boolean(),unavailableReason:z.string().nullable(),withdrawn:z.boolean(),simulated:z.boolean(),outputs:z.array(mediaProcessingOutputPreview),warnings:z.array(z.string()),updatedAt:z.string()});
export const mediaProcessingPlanVersionSchema=z.strictObject({version,planHash:sha,payload:mediaProcessingPayload.nullable(),unavailableReason:z.string().nullable(),createdAt:z.string()});
const trackingBox=z.strictObject({x:z.number().finite(),y:z.number().finite(),width:z.number().positive().finite(),height:z.number().positive().finite()});
export const trackingTraceFrame=z.strictObject({frame:z.int().min(0),timeMs:ms,status:z.enum(['tracking','holding']),confidence:z.number().min(0).max(1),target:trackingBox.nullable(),crop:trackingBox});
export type TrackingTraceFrame=z.infer<typeof trackingTraceFrame>;
export const mediaProcessingReport=z.strictObject({provider:z.string(),simulated:z.boolean(),realAlgorithm:z.boolean(),summary:z.string(),metrics:z.record(z.string(),z.number()),recommendations:z.array(mediaClipRange).max(1200),warnings:z.array(z.string()).max(30),tracking:z.array(trackingTraceFrame).min(1).max(1200).optional(),semantic:semanticClipAnalysis.optional(),gaze:z.array(gazeTraceFrame).min(1).max(1200).optional()});
export const mediaProcessingOutputSchema=z.strictObject({id,assetId:id,name:z.string(),mediaType:z.enum(['image/png','audio/wav','video/mp4','video/quicktime']),size:z.int().positive(),sha256:sha,specs:z.record(z.string(),z.number()),sourceStartMs:ms,sourceDurationMs:z.int().nullable(),alpha:z.boolean(),url:z.string().nullable(),previewUrl:z.string().nullable(),posterUrl:z.string().nullable()});
export const mediaProcessingJobSchema=z.strictObject({id,planId:id,planVersion:version,workspaceId:id,name:z.string(),version,status:z.enum(['queued','processing','succeeded','awaiting_review','accepted_mock','rejected','failed','cancelled','stale']),progress:z.number().min(0).max(1),attempts:z.int().min(0),available:z.boolean(),unavailableReason:z.string().nullable(),simulated:z.boolean(),engine:mediaEngineSchema.optional(),trackingSource:mediaSourceSnapshot.optional(),semanticVideo:mediaSourceSnapshot.optional(),restorationSource:mediaSourceSnapshot.optional(),gazeSource:mediaSourceSnapshot.optional(),report:mediaProcessingReport.nullable(),outputs:z.array(mediaProcessingOutputSchema),errorCode:z.string().nullable(),errorMessage:z.string().nullable(),updatedAt:z.string()});
export const mediaProcessingApplyInput=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('new_project'),version,name:z.string().trim().min(1).max(100),outputIds:z.array(id).min(1).max(20),confirmed:z.literal(true)}),
  z.strictObject({kind:z.literal('append'),version,projectId:id,projectVersion:version,outputIds:z.array(id).min(1).max(20),confirmed:z.literal(true)}),
  z.strictObject({kind:z.literal('replace_clip'),version,projectId:id,projectVersion:version,clipId:id,outputId:id,confirmed:z.literal(true)})
]);
export const mediaProcessingRevertInput=z.strictObject({applicationId:id,projectVersion:version,confirmed:z.literal(true)});
export const mediaProcessingApplicationSchema=z.strictObject({id,jobId:id,projectId:id,kind:z.enum(['new_project','append','replace_clip']),previousVersion:z.int().nullable(),appliedVersion:version,revertedVersion:z.int().nullable(),createdAt:z.string()});
export type MediaProcessingConfiguration=z.infer<typeof mediaProcessingConfiguration>;
export type MediaProcessingPayload=z.infer<typeof mediaProcessingPayload>;
export type MediaProcessingPlan=z.infer<typeof mediaProcessingPlanSchema>;
export type MediaProcessingOutput=z.infer<typeof mediaProcessingOutputSchema>;
export type MediaProcessingReport=z.infer<typeof mediaProcessingReport>;
export type MediaProcessingJob=z.infer<typeof mediaProcessingJobSchema>;
