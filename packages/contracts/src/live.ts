import {programmeRecordingSource} from './live-guest-programme.js';
import {z} from 'zod';
import {liveRecordingAnswerSource} from './live-answers.js';
import {liveRecordingSpeechSource} from './live-speech.js';
import {livePuppetBinding} from './live-puppet.js';
const id=z.uuid(),version=z.int().positive(),hash=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().trim(),date=z.iso.datetime();
const cueBase={id,title:text.min(1).max(100),durationMs:z.int().min(1000).max(600000)};
export const liveCue=z.discriminatedUnion('kind',[
 z.strictObject({...cueBase,kind:z.literal('video'),exportId:id,artifactId:id,sourceInMs:z.int().min(0).max(600000)}),
 z.strictObject({...cueBase,kind:z.literal('realtime'),text:text.min(1).max(1000)}),
 z.strictObject({...cueBase,kind:z.literal('standby'),text:text.min(1).max(1000)})
]);
export const liveDestinationDefinition=z.strictObject({id,name:text.min(1).max(60),platform:z.enum(['custom','douyin','kuaishou','channels','bilibili','youtube']),behavior:z.enum(['healthy','fail_once','unknown_once']).default('healthy')});
export const liveProduct=z.strictObject({id,name:text.min(1).max(80),description:text.min(1).max(1000),priceLabel:text.max(80).default(''),sourceLabel:text.min(1).max(150),sourceUrl:z.string().url().max(500).refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}).nullable().default(null),expiresAt:date});
export type LiveProduct=z.infer<typeof liveProduct>;
export const liveDefinition=z.strictObject({
 schemaVersion:z.literal(1),mode:z.enum(['prerecorded','realtime','hybrid']),sceneAppId:id.nullable().default(null),cues:z.array(liveCue).min(1).max(30),loop:z.boolean().default(false),
 backup:z.strictObject({title:text.min(1).max(80),text:text.min(1).max(1000),color:z.string().regex(/^#[a-f0-9]{6}$/i).default('#193b38')}),
 destinations:z.array(liveDestinationDefinition).min(1).max(4),products:z.array(liveProduct).max(20).default([]),questionsEnabled:z.boolean().default(true),recordingEnabled:z.boolean().default(true),maxDurationMs:z.int().min(1000).max(1800000).default(1800000)
});
export type LiveDefinition=z.infer<typeof liveDefinition>;
export type LiveCue=z.infer<typeof liveCue>;
export const liveProgramCreate=z.strictObject({workspaceId:id,name:text.min(1).max(100),definition:liveDefinition,rightsConfirmed:z.literal(true)});
export const liveProgramSave=liveProgramCreate.omit({workspaceId:true}).extend({version});
export const liveProgramSchema=z.strictObject({id,workspaceId:id,name:z.string(),version,definition:liveDefinition,updatedAt:date,canManage:z.boolean()});
export type LiveProgram=z.infer<typeof liveProgramSchema>;
export const livePlanInput=z.strictObject({version});
export const livePlanSchema=z.strictObject({hash,canStart:z.boolean(),problems:z.array(z.string()),warnings:z.array(z.string()),mode:z.enum(['prerecorded','realtime','hybrid']),simulated:z.literal(true),mediaFiles:z.int().nonnegative(),programDurationMs:z.int().nonnegative(),maxDurationMs:z.int().positive(),realRemotePlaybackVerified:z.literal(false)});
export type LivePlan=z.infer<typeof livePlanSchema>;
export const liveSessionCreate=z.strictObject({programId:id,programVersion:version,planHash:hash,kind:z.enum(['preview','broadcast_simulation']),scheduledAt:date.nullable().default(null),confirmed:z.literal(true),rightsConfirmed:z.literal(true)});
export const liveControl=z.discriminatedUnion('action',[
 z.strictObject({version,epoch:version,action:z.enum(['pause','resume','mute','unmute','takeover','release','backup','program','pause_questions','resume_questions','stop']),confirmed:z.literal(true)}),
 z.strictObject({version,epoch:version,action:z.literal('jump'),cueId:id,confirmed:z.literal(true)}),
 z.strictObject({version,epoch:version,action:z.literal('manual_text'),text:text.min(1).max(1000),confirmed:z.literal(true)})
]);
export const liveStart=z.strictObject({version,planHash:hash,confirmed:z.literal(true)});
export const liveTargetControl=z.strictObject({version,action:z.enum(['disconnect','retry','query','stop']),confirmed:z.literal(true)});
export const liveAudienceInput=z.strictObject({destinationId:id,eventId:text.min(8).max(100),participantRef:text.min(8).max(100),nickname:text.min(1).max(40),kind:z.enum(['comment','question','join_request']),text:text.min(1).max(1000),mediaOptIn:z.enum(['none','audio','video']).default('none'),synthetic:z.literal(true)});
export const liveModerate=z.strictObject({version,decision:z.enum(['queue','reject','allow_join']),priority:z.int().min(0).max(2).default(0),confirmed:z.literal(true)});
export const liveAnswerInput=z.strictObject({version,kind:z.enum(['knowledge','product','manual']),productId:id.optional(),text:text.max(1000).default(''),confirmed:z.literal(true)});
export const liveAnswerPlay=z.strictObject({version,sessionVersion:version,epoch:version,durationMs:z.int().min(1000).max(60000),confirmed:z.literal(true)});
export const liveObservation=z.strictObject({epoch:version,cueId:id.nullable(),surface:z.enum(['program','backup','manual','answer']),positionMs:z.int().nonnegative().max(1800000),status:z.enum(['playing','paused','blocked'])});
export const liveRecordingControl=z.strictObject({version,action:z.enum(['retry','cancel','withdraw']),confirmed:z.literal(true)});
export const liveClipInput=z.strictObject({version,name:text.min(1).max(100),startMs:z.int().min(0),durationMs:z.int().min(1000).max(600000),confirmed:z.literal(true)});
export const liveQuestionSchema=z.strictObject({id,sessionId:id,destinationId:id,eventId:z.string(),nickname:z.string(),kind:z.enum(['comment','question','join_request']),text:z.string(),mediaOptIn:z.enum(['none','audio','video']),status:z.enum(['received','queued','rejected','authorized_simulation','ready','playing','answered','cancelled']),priority:z.int(),version,answer:z.string().nullable(),answerKind:z.enum(['knowledge','product','manual','local_model']).nullable(),answerUnavailableReason:z.string().nullable(),citations:z.array(z.strictObject({documentId:id,versionId:id,title:z.string(),sourceLabel:z.string(),snippet:z.string()})),preparedEpoch:version.nullable(),createdAt:date});
export type LiveQuestion=z.infer<typeof liveQuestionSchema>;
export const liveTargetSchema=z.strictObject({id,definitionId:id,name:z.string(),platform:z.string(),status:z.enum(['idle','connecting','connected','disconnected','failed','unknown','stopped']),version,attempts:z.int().nonnegative(),operationId:id.nullable(),remoteId:z.string().nullable(),heartbeatAt:date.nullable(),errorMessage:z.string().nullable(),simulated:z.literal(true),realRemotePlaybackVerified:z.literal(false)});
export type LiveTarget=z.infer<typeof liveTargetSchema>;
export const liveRecordingSchema=z.strictObject({id,sessionId:id,status:z.enum(['queued','rendering','ready','failed','cancelled','withdrawn']),version,attempts:z.int().nonnegative(),durationMs:z.int().nonnegative(),errorMessage:z.string().nullable(),assetId:id.nullable(),sha256:hash.nullable(),url:z.string().nullable(),available:z.boolean(),unavailableReason:z.string().nullable(),simulated:z.literal(true),captureKind:z.enum(['local_timeline_reconstruction','local_continuous_output']),createdAt:date});
export type LiveRecording=z.infer<typeof liveRecordingSchema>;
export const liveSessionSchema=z.strictObject({
 id,workspaceId:id,programId:id,programVersion:version,name:z.string(),mode:z.enum(['prerecorded','realtime','hybrid']),kind:z.enum(['preview','broadcast_simulation']),status:z.enum(['ready','scheduled','preview','live','ended','failed']),version,epoch:version,snapshotHash:hash,scheduledAt:date.nullable(),startedAt:date.nullable(),endedAt:date.nullable(),
 playhead:z.strictObject({cueId:id,cueIndex:z.int().nonnegative(),offsetMs:z.int().nonnegative(),elapsedMs:z.int().nonnegative(),surface:z.enum(['program','backup','manual','answer']),text:z.string(),paused:z.boolean(),muted:z.boolean(),manual:z.boolean(),interactionsPaused:z.boolean(),answerId:id.nullable(),serverTime:date}),
 cues:z.array(liveCue),backup:liveDefinition.shape.backup,products:z.array(liveProduct),profileName:z.string().nullable(),destinations:z.array(liveTargetSchema),questions:z.array(liveQuestionSchema),recording:liveRecordingSchema.nullable(),
 commands:z.array(z.strictObject({id,action:z.string(),epoch:version,requestedAt:date,simulatorAppliedAt:date.nullable(),mediaAppliedAt:date.nullable(),mediaFrame:z.int().nonnegative().nullable(),status:z.enum(['pending','applied','superseded'])})),observations:z.array(z.strictObject({actorId:id,epoch:version,status:z.string(),observedAt:date})),
 terminalReason:z.string().nullable().optional(),available:z.boolean(),unavailableReason:z.string().nullable(),canManage:z.boolean(),canStart:z.boolean(),canModerate:z.boolean(),simulated:z.literal(true),realRemotePlaybackVerified:z.literal(false),createdAt:date
});
export type LiveSession=z.infer<typeof liveSessionSchema>;
export const liveSessionSummarySchema=liveSessionSchema.pick({id:true,workspaceId:true,programId:true,programVersion:true,name:true,mode:true,kind:true,status:true,version:true,scheduledAt:true,startedAt:true,endedAt:true,createdAt:true,simulated:true,realRemotePlaybackVerified:true});
export type LiveSessionSummary=z.infer<typeof liveSessionSummarySchema>;
export const liveStudioResources=z.strictObject({profiles:z.array(z.strictObject({id,version})),clones:z.array(z.strictObject({id,version})),media:z.array(z.strictObject({id,sha256:hash}))});
export type LiveStudioResources=z.infer<typeof liveStudioResources>;
export const liveRecordingGuard=z.strictObject({schemaVersion:z.literal(1),sessionId:id,expiresAt:date,sourceAssets:z.array(z.strictObject({id,version,sha256:hash})),exports:z.array(z.strictObject({id,projectId:id,projectVersion:version,documentHash:hash,resources:liveStudioResources,planHash:hash,reviewId:id,reviewHash:hash,artifactId:id,artifactSHA256:hash,artifactSize:z.int().positive()})),citations:z.array(z.strictObject({collectionId:id,documentId:id,versionId:id})),speech:z.array(liveRecordingSpeechSource).max(300).optional(),answers:z.array(liveRecordingAnswerSource).max(100).optional(),puppet:livePuppetBinding.optional(),guestProgramme:z.array(programmeRecordingSource).max(100).optional()});
export type LiveRecordingGuard=z.infer<typeof liveRecordingGuard>;
