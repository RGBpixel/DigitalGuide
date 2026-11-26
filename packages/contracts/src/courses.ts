import {z} from 'zod';

const id=z.uuid(),text=z.string().trim().min(1),nodeBase={id,title:text.max(100)},target=id;
export const courseMedia=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('asset'),assetId:id}),
 z.strictObject({kind:z.literal('studio_export'),exportId:id,artifactId:id})
]);
const option=z.strictObject({id,title:text.max(300)});
export const courseNode=z.discriminatedUnion('kind',[
 z.strictObject({...nodeBase,kind:z.literal('lesson'),body:z.string().max(8000),media:courseMedia.nullable(),minimumWatchPercent:z.number().int().min(0).max(100),next:target}),
 z.strictObject({...nodeBase,kind:z.literal('choice'),body:z.string().max(8000),options:z.array(option.extend({next:target})).min(2).max(8)}),
 z.strictObject({...nodeBase,kind:z.literal('quiz'),body:text.max(8000),multiple:z.boolean(),options:z.array(option).min(2).max(8),correctOptionIds:z.array(id).min(1).max(8),points:z.number().int().min(1).max(100),correctFeedback:z.string().max(1000),incorrectFeedback:z.string().max(1000),correctNext:target,incorrectNext:target}),
 z.strictObject({...nodeBase,kind:z.literal('simulation'),body:text.max(8000),screenshot:courseMedia,task:z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('hotspot'),x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().gt(0).max(1),height:z.number().gt(0).max(1)}),
  z.strictObject({kind:z.literal('text'),label:text.max(100),expected:text.max(200),caseSensitive:z.boolean()})
 ]),points:z.number().int().min(1).max(100),correctFeedback:z.string().max(1000),incorrectFeedback:z.string().max(1000),correctNext:target,incorrectNext:target}),
 z.strictObject({...nodeBase,kind:z.literal('end'),body:z.string().max(8000)})
]);
export const courseDefinition=z.strictObject({schemaVersion:z.literal(1),startNodeId:id,passingPercent:z.number().int().min(0).max(100),maxAttempts:z.number().int().min(1).max(10),nodes:z.array(courseNode).min(2).max(100)});
export type CourseDefinition=z.infer<typeof courseDefinition>;
export type CourseNode=z.infer<typeof courseNode>;
export type CourseMedia=z.infer<typeof courseMedia>;
export const courseCreate=z.strictObject({workspaceId:id,name:text.max(100),definition:courseDefinition});
export const courseSave=z.strictObject({version:z.number().int().positive(),name:text.max(100),definition:courseDefinition});
export const coursePublish=z.strictObject({version:z.number().int().positive(),planHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true),rightsConfirmed:z.literal(true)});
export const courseEnroll=z.strictObject({actorId:id,confirmed:z.literal(true)});
export const courseConfirm=z.strictObject({confirmed:z.literal(true)});
export const courseExportInput=z.strictObject({standard:z.enum(['1.2','2004_4']),planHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true),rightsConfirmed:z.literal(true),selfStudyConfirmed:z.literal(true)});
export const learningAction=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('claim')}),
 z.strictObject({kind:z.enum(['play','progress','pause','seek']),epoch:z.number().int().nonnegative(),positionMs:z.number().int().min(0).max(10800000)}),
 z.strictObject({kind:z.literal('continue')}),
 z.strictObject({kind:z.literal('choose'),optionId:id}),
 z.strictObject({kind:z.literal('answer'),optionIds:z.array(id).min(1).max(8)}),
 z.strictObject({kind:z.literal('simulate'),point:z.strictObject({x:z.number().min(0).max(1),y:z.number().min(0).max(1)}).optional(),text:z.string().max(200).optional()}),
 z.strictObject({kind:z.literal('finish')})
]);
export const learningEvent=z.strictObject({version:z.number().int().positive(),observedNodeId:id,action:learningAction});
export type LearningAction=z.infer<typeof learningAction>;
export interface CourseMediaSnapshot {key:string;ref:CourseMedia;sha256:string;size:number;mediaType:'video/mp4'|'image/png';durationMs:number;width:number;height:number;expiresAt:string|null;fingerprint:string}
export interface CourseRelease {id:string;courseId:string;workspaceId:string;name:string;courseVersion:number;releaseHash:string;available:boolean;unavailableReason:string|null;createdAt:string;withdrawnAt:string|null}
export interface Course {id:string;workspaceId:string;name:string;version:number;definition:CourseDefinition|null;unavailableReason:string|null;releases:CourseRelease[];updatedAt:string}
export interface CoursePlan {hash:string;canPublish:boolean;problems:string[];warnings:string[];media:Omit<CourseMediaSnapshot,'ref'|'fingerprint'>[];estimatedBytes:number}
export interface CourseEnrollment {id:string;release:CourseRelease;actorId:string;actorName:string;revokedAt:string|null;revocationReason:string|null;attemptCount:number;latestAttemptId:string|null;canStart:boolean}
export interface LearningResponse {nodeId:string;kind:'quiz'|'simulation';optionIds:string[];correct:boolean;earned:number;possible:number}
export interface LearningState {schemaVersion:1;currentNodeId:string;path:string[];responses:LearningResponse[];watched:{nodeId:string;watchedMs:number}[];completed:boolean;playback:{epoch:number;playing:boolean;lastAtMs:number;positionMs:number;ranges:[number,number][]}}
export interface LearningGrade {earned:number;possible:number;percent:number;passed:boolean|null}
export type LearnerNode=
 | {id:string;kind:'lesson';title:string;body:string;mediaUrl:string|null;durationMs:number;minimumWatchPercent:number;watchedMs:number}
 | {id:string;kind:'choice';title:string;body:string;options:{id:string;title:string}[]}
 | {id:string;kind:'quiz';title:string;body:string;multiple:boolean;options:{id:string;title:string}[];answered:boolean;selectedOptionIds:string[];feedback:string|null;correct:boolean|null;points:number}
 | {id:string;kind:'simulation';title:string;body:string;mediaUrl:string;task:{kind:'hotspot'}|{kind:'text';label:string};answered:boolean;feedback:string|null;correct:boolean|null;points:number}
 | {id:string;kind:'end';title:string;body:string};
export interface LearningAttempt {id:string;enrollmentId:string;releaseId:string;releaseHash:string;workspaceId:string;actorId:string;name:string;version:number;node:LearnerNode|null;currentNodeId:string;path:{id:string;title:string;kind:CourseNode['kind']}[];grade:LearningGrade;completed:boolean;progressPercent:number;positionMs:number;playbackEpoch:number;playing:boolean;available:boolean;unavailableReason:string|null;updatedAt:string}
export interface CourseExport {id:string;releaseId:string;workspaceId:string;standard:'1.2'|'2004_4';status:'queued'|'packaging'|'succeeded'|'failed'|'cancelled';progress:number;attempts:number;errorMessage:string|null;url:string|null;size:number|null;sha256:string|null;updatedAt:string;warnings:string[]}
const nullableText=z.string().nullable(),timestamp=z.string(),grade=z.strictObject({earned:z.number().nonnegative(),possible:z.number().nonnegative(),percent:z.number().min(0).max(100),passed:z.boolean().nullable()}),learnerBase={id,title:z.string(),body:z.string()},feedback={answered:z.boolean(),feedback:nullableText,correct:z.boolean().nullable(),points:z.int().positive()};
export const courseReleaseSchema=z.strictObject({id,courseId:id,workspaceId:id,name:z.string(),courseVersion:z.int().positive(),releaseHash:z.string(),available:z.boolean(),unavailableReason:nullableText,createdAt:timestamp,withdrawnAt:nullableText});
export const courseSchema=z.strictObject({id,workspaceId:id,name:z.string(),version:z.int().positive(),definition:courseDefinition.nullable(),unavailableReason:nullableText,releases:z.array(courseReleaseSchema),updatedAt:timestamp});
export const coursePlanSchema=z.strictObject({hash:z.string(),canPublish:z.boolean(),problems:z.array(z.string()),warnings:z.array(z.string()),media:z.array(z.strictObject({key:id,sha256:z.string(),size:z.number(),mediaType:z.enum(['video/mp4','image/png']),durationMs:z.number(),width:z.number(),height:z.number(),expiresAt:nullableText})),estimatedBytes:z.number()});
export const courseEnrollmentSchema=z.strictObject({id,release:courseReleaseSchema,actorId:id,actorName:z.string(),revokedAt:nullableText,revocationReason:nullableText,attemptCount:z.int().nonnegative(),latestAttemptId:id.nullable(),canStart:z.boolean()});
export const learnerNodeSchema=z.discriminatedUnion('kind',[
 z.strictObject({...learnerBase,kind:z.literal('lesson'),mediaUrl:nullableText,durationMs:z.number(),minimumWatchPercent:z.int(),watchedMs:z.number()}),
 z.strictObject({...learnerBase,kind:z.literal('choice'),options:z.array(option)}),
 z.strictObject({...learnerBase,kind:z.literal('quiz'),multiple:z.boolean(),options:z.array(option),selectedOptionIds:z.array(id),...feedback}),
 z.strictObject({...learnerBase,kind:z.literal('simulation'),mediaUrl:z.string(),task:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('hotspot')}),z.strictObject({kind:z.literal('text'),label:z.string()})]),...feedback}),
 z.strictObject({...learnerBase,kind:z.literal('end')})
]);
export const learningAttemptSchema=z.strictObject({id,enrollmentId:id,releaseId:id,releaseHash:z.string(),workspaceId:id,actorId:id,name:z.string(),version:z.int().positive(),node:learnerNodeSchema.nullable(),currentNodeId:id,path:z.array(z.strictObject({id,title:z.string(),kind:z.enum(['lesson','choice','quiz','simulation','end'])})),grade,completed:z.boolean(),progressPercent:z.number().min(0).max(100),positionMs:z.number().nonnegative(),playbackEpoch:z.int().nonnegative(),playing:z.boolean(),available:z.boolean(),unavailableReason:nullableText,updatedAt:timestamp});
export const courseExportSchema=z.strictObject({id,releaseId:id,workspaceId:id,standard:z.enum(['1.2','2004_4']),status:z.enum(['queued','packaging','succeeded','failed','cancelled']),progress:z.number(),attempts:z.int(),errorMessage:nullableText,url:nullableText,size:z.number().nullable(),sha256:nullableText,updatedAt:timestamp,warnings:z.array(z.string())});
