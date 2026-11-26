import {z} from 'zod';
import {systemVoiceSchema} from './voice.js';
const id=z.uuid(),version=z.int().positive(),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const liveSpeechCapabilities=z.strictObject({available:z.boolean(),voices:z.array(systemVoiceSchema),reason:z.string().nullable(),clonedVoice:z.literal(false),notice:z.string()});
export const liveSpeechPlanCreate=z.strictObject({sessionVersion:version,voiceId:z.string().regex(/^sapi-[a-f0-9]{24}$/),confirmed:z.literal(true),rightsConfirmed:z.literal(true)});
export const liveSpeechPlanControl=z.strictObject({version,action:z.enum(['cancel','withdraw']),confirmed:z.literal(true)});
export const liveSpeechSource=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('cue'),cueId:id,text:z.string().min(1).max(1000),durationMs:z.int().positive().max(600000)}),
 z.strictObject({kind:z.literal('answer'),questionId:id,questionVersion:version,epoch:version,text:z.string().min(1).max(1500),citations:z.array(z.unknown()).max(100)}),
 z.strictObject({kind:z.literal('manual'),epoch:version,text:z.string().trim().min(1).max(1000)})
]);
export type LiveSpeechSource=z.infer<typeof liveSpeechSource>;
export const liveSpeechJobCreate=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('answer'),planId:id,sessionVersion:version,epoch:version,questionId:id,questionVersion:version,confirmed:z.literal(true)}),
 z.strictObject({kind:z.literal('manual'),planId:id,sessionVersion:version,epoch:version,text:z.string().trim().min(1).max(1000),confirmed:z.literal(true)})
]);
export const liveSpeechJobControl=z.strictObject({version,action:z.enum(['cancel','retry','withdraw']),confirmed:z.literal(true)});
export const liveSpeechPlay=z.strictObject({sessionVersion:version,epoch:version,jobVersion:version,confirmed:z.literal(true)});
export const liveSpeechWav=z.strictObject({sampleRate:z.literal(22050),channels:z.literal(1),bitsPerSample:z.literal(16),durationMs:z.number().positive(),size:z.int().positive(),sha256:sha,pcmSHA256:sha});
export const liveSpeechPCM=z.strictObject({sampleRate:z.literal(48000),channels:z.literal(2),bitsPerSample:z.literal(16),samples:z.int().positive(),frames:z.int().positive(),size:z.int().positive(),sha256:sha});
export const liveSpeechJobSchema=z.strictObject({id,planId:id,sessionId:id,kind:z.enum(['cue','answer','manual']),cueId:id.nullable(),questionId:id.nullable(),text:z.string().nullable(),status:z.enum(['queued','processing','succeeded','failed','cancelled','stale']),version,attempts:z.int().nonnegative(),progress:z.number().min(0).max(1),available:z.boolean(),unavailableReason:z.string().nullable(),wav:liveSpeechWav.nullable(),pcm:liveSpeechPCM.nullable(),audioUrl:z.string().nullable(),errorCode:z.string().nullable(),errorMessage:z.string().nullable(),canControl:z.boolean(),canRetry:z.boolean(),canPlay:z.boolean(),clonedVoice:z.literal(false),createdAt:z.string(),updatedAt:z.string()});
export type LiveSpeechJob=z.infer<typeof liveSpeechJobSchema>;
export const liveSpeechPlanSchema=z.strictObject({id,sessionId:id,status:z.enum(['building','ready','failed','cancelled','withdrawn']),version,voice:systemVoiceSchema.nullable(),resultHash:sha.nullable(),available:z.boolean(),unavailableReason:z.string().nullable(),canControl:z.boolean(),jobs:z.array(liveSpeechJobSchema),createdAt:z.string()});
export type LiveSpeechPlan=z.infer<typeof liveSpeechPlanSchema>;
export const liveSpeechPlaybackSchema=z.strictObject({jobId:id,kind:z.enum(['answer','manual']),version,epoch:version,positionFrames:z.int().nonnegative(),totalFrames:z.int().positive(),status:z.enum(['active','completed','stopped'])});
export const liveSpeechSessionSchema=z.strictObject({plans:z.array(liveSpeechPlanSchema),playback:liveSpeechPlaybackSchema.nullable()});
export type LiveSpeechSession=z.infer<typeof liveSpeechSessionSchema>;
export const liveRecordingSpeechSource=z.strictObject({planId:id,planHash:sha,jobId:id,inputHash:sha});
export type LiveRecordingSpeechSource=z.infer<typeof liveRecordingSpeechSource>;
