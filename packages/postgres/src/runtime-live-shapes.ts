import {createHash} from 'node:crypto';
import {z} from 'zod';
import {nativeLiveScene} from './runtime-scenes-state.js';
import {canonical} from '../../domain/src/index.js';
import {liveDefinition,type LiveSession,type LiveQuestion,type LiveTarget} from '../../contracts/src/index.js';
import type {NativeMediaArtifact} from './runtime-media-files.js';

const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid(),integer=z.int().nonnegative();
export const nativeLiveFile=z.strictObject({storage_key:z.string().regex(/^[a-f0-9-]{36}\.(bin|mp4|mov|wav|png|json|srt|vtt|zip)$/),sha256:hash,size:z.int().nonnegative(),media_type:z.string().min(1).max(100)});
export const nativeLiveSource=z.strictObject({cueId:id,exportId:id,artifactId:id,projectId:id,projectVersion:z.int().positive(),planHash:hash,reviewId:id,reviewHash:hash,sourceHash:hash,sha256:hash,size:z.int().positive(),durationMs:z.int().positive(),width:z.int().positive(),height:z.int().positive(),expiresAt:z.iso.datetime().nullable(),artifact:nativeLiveFile,files:z.array(nativeLiveFile).min(1).max(3000)});
export const nativeLiveSnapshot=z.strictObject({schemaVersion:z.literal(1),pipeline:z.literal('native-live-v1'),definition:liveDefinition,sources:z.array(nativeLiveSource).max(30),scene:nativeLiveScene.nullable()});
export const nativeLiveClock=z.strictObject({clockAt:integer.nullable(),elapsedMs:integer,cueIndex:integer,offsetMs:integer,surface:z.enum(['program','backup','manual','answer']),paused:z.boolean(),muted:z.boolean(),manual:z.boolean(),interactionsPaused:z.boolean(),epoch:z.int().positive(),answerId:id.nullable(),answerRemainingMs:integer,answerText:z.string().max(1500),manualText:z.string().max(1000),segmentStartMs:integer,segmentSourceInMs:integer,stopped:z.boolean()});
export type NativeLiveSnapshot=z.infer<typeof nativeLiveSnapshot>;
export type NativeLiveSource=z.infer<typeof nativeLiveSource>;
export interface NativeLiveProgramRow{id:string;tenant_id:string;workspace_id:string;actor_id:string;name:string;definition:string;definition_hash:string;version:number;updated_at:string}
export interface NativeLiveSessionRow{id:string;tenant_id:string;workspace_id:string;actor_id:string;program_id:string;program_version:number;name:string;kind:LiveSession['kind'];status:LiveSession['status'];snapshot:string;snapshot_hash:string;state:string;state_hash:string;version:number;scheduled_at:string|null;started_at:string|null;ended_at:string|null;error_message:string|null;invalidated_at:string|null;invalidation_reason:string|null;created_at:string;updated_at:string}
export interface NativeLiveTargetRow{id:string;session_id:string;definition_id:string;status:LiveTarget['status'];version:number;attempts:number;operation_id:string|null;remote_id:string|null;heartbeat_at:string|null;error_message:string|null}
export interface NativeLiveEventRow{id:string;session_id:string;destination_id:string;event_id:string;input_hash:string;participant_hash:string;nickname:string;kind:LiveQuestion['kind'];text:string;media_opt_in:LiveQuestion['mediaOptIn'];status:LiveQuestion['status'];priority:number;version:number;answer:string|null;answer_kind:LiveQuestion['answerKind'];citations:string;product_id:string|null;prepared_epoch:number|null;created_at:string}
export const nativeLiveDigest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export function liveFiles(files:NativeMediaArtifact[]){return files.map(f=>nativeLiveFile.parse({storage_key:f.storage_key,sha256:f.sha256,size:Number(f.size),media_type:f.media_type})).sort((a,b)=>a.storage_key.localeCompare(b.storage_key));}
