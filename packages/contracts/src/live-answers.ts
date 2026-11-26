import {z} from 'zod';
import {localEditorEngine} from './local-editor.js';
import {semanticEngineSchema} from './semantic-clips.js';
const id=z.uuid(),version=z.int().positive(),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const liveAnswerEngine=z.strictObject({model:localEditorEngine.omit({policy:true}),retrieval:semanticEngineSchema.omit({candidatePolicy:true}),policy:z.literal('live-public-grounded-v1'),queryPolicy:z.literal('literal-query-span-v1'),maximumQueryOutputTokens:z.literal(512),maximumSources:z.literal(8),sourceCharacters:z.literal(600)});
export type LiveAnswerEngine=z.infer<typeof liveAnswerEngine>;
const sourceBase={id:z.string().regex(/^s\d+c\d+$/),title:z.string().min(1).max(100),sourceLabel:z.string().min(1).max(150),sourceUrl:z.string().url().nullable(),text:z.string().min(1).max(600),part:z.int().nonnegative()};
export const liveAnswerSource=z.discriminatedUnion('kind',[
 z.strictObject({...sourceBase,kind:z.literal('knowledge'),collectionId:id,documentId:id,versionId:id,version,contentHash:sha}),
 z.strictObject({...sourceBase,kind:z.literal('product'),productId:id,expiresAt:z.iso.datetime(),productHash:sha})
]);
export type LiveAnswerSource=z.infer<typeof liveAnswerSource>;
export const liveAnswerRequest=z.strictObject({question:z.string().trim().min(1).max(1000),sources:z.array(liveAnswerSource).min(1).max(512),language:z.enum(['zh-CN','en-US'])}).refine(r=>r.sources.reduce((n,s)=>n+s.text.length,0)<=180000,{message:'本场公开资料超过十八万字符，请拆分知识库或场次；不会截掉正文。'});
export type LiveAnswerRequest=z.infer<typeof liveAnswerRequest>;
export const liveAnswerCitation=z.strictObject({sourceId:z.string(),kind:z.enum(['knowledge','product']),title:z.string(),sourceLabel:z.string(),sourceUrl:z.string().nullable(),quote:z.string().min(1).max(600)});
export const liveAnswerResult=z.strictObject({supported:z.boolean(),answer:z.string().trim().min(1).max(1200),citations:z.array(liveAnswerCitation).max(8)});
export type LiveAnswerResult=z.infer<typeof liveAnswerResult>;
export const liveAnswerEvidence=z.strictObject({engine:liveAnswerEngine,inputSHA256:sha,promptSHA256:sha,rawOutputSHA256:sha,promptTokens:z.int().nonnegative(),effectiveQuestion:z.string().min(1).max(1000),queryPromptSHA256:sha,queryRawOutputSHA256:sha,queryPromptTokens:z.int().nonnegative(),elapsedMs:z.number().nonnegative(),retrievedSourceIds:z.array(z.string()).min(1).max(8),retrievalInferences:z.int().positive(),compiledWorkerEntry:z.boolean(),offlineCpu:z.literal(true)});
export const liveAnswerNativeResult=z.strictObject({result:liveAnswerResult,evidence:liveAnswerEvidence});
export type LiveAnswerNativeResult=z.infer<typeof liveAnswerNativeResult>;
export const liveAnswerCapabilities=z.strictObject({available:z.boolean(),engine:liveAnswerEngine.nullable(),engineHash:sha.nullable(),reason:z.string().nullable(),notice:z.string()});
export const liveAnswerConfigure=z.strictObject({version:z.int().nonnegative(),sessionVersion:version,enabled:z.boolean(),autoDraft:z.boolean(),language:z.enum(['zh-CN','en-US']),engineHash:sha.optional(),confirmed:z.literal(true)}).refine(v=>!v.enabled||!!v.engineHash,{message:'启用前需核对实际本机模型摘要。'});
export const liveAnswerCreate=z.strictObject({questionVersion:version,sessionVersion:version,confirmed:z.literal(true)});
export const liveAnswerControl=z.strictObject({version,action:z.enum(['cancel','retry','withdraw']),confirmed:z.literal(true)});
export const liveAnswerAdopt=z.strictObject({version,questionVersion:version,sessionVersion:version,epoch:version,confirmed:z.literal(true)});
export const liveAnswerConfigurationSchema=z.strictObject({sessionId:id,version:z.int().nonnegative(),generation:z.int().nonnegative(),enabled:z.boolean(),autoDraft:z.boolean(),language:z.enum(['zh-CN','en-US']),engine:liveAnswerEngine.nullable(),available:z.boolean(),unavailableReason:z.string().nullable(),canControl:z.boolean()});
export type LiveAnswerConfiguration=z.infer<typeof liveAnswerConfigurationSchema>;
export const liveAnswerJobSchema=z.strictObject({id,sessionId:id,questionId:id,version,status:z.enum(['queued','processing','succeeded','failed','cancelled','stale']),attempts:z.int().nonnegative(),progress:z.number().min(0).max(1),available:z.boolean(),unavailableReason:z.string().nullable(),question:z.string().nullable(),result:liveAnswerResult.nullable(),references:z.array(liveAnswerSource).max(8),evidence:liveAnswerEvidence.nullable(),adopted:z.boolean(),canControl:z.boolean(),canRetry:z.boolean(),canAdopt:z.boolean(),errorCode:z.string().nullable(),errorMessage:z.string().nullable(),createdAt:z.string(),updatedAt:z.string()});
export type LiveAnswerJob=z.infer<typeof liveAnswerJobSchema>;
export const liveAnswerSessionSchema=z.strictObject({configuration:liveAnswerConfigurationSchema,jobs:z.array(liveAnswerJobSchema)});
export type LiveAnswerSession=z.infer<typeof liveAnswerSessionSchema>;
export const liveRecordingAnswerSource=z.strictObject({jobId:id,inputHash:sha,resultHash:sha,questionId:id});
export type LiveRecordingAnswerSource=z.infer<typeof liveRecordingAnswerSource>;
