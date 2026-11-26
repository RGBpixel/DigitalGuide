import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonical} from '../../domain/src/index.js';
import {characterMotionInput,type CharacterJob,type CharacterOutput} from '../../contracts/src/index.js';
export const nativeCharacterDigest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export const nativeCharacterSource=z.strictObject({id:z.uuid(),version:z.int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.int().positive().max(134217728),mediaType:z.string().min(1),specs:z.record(z.string(),z.number()),storageKey:z.string().regex(/^[a-f0-9-]{36}\.bin$/),synthetic:z.boolean()});
export const nativeCharacterSnapshot=z.strictObject({
 character:z.strictObject({id:z.uuid(),version:z.int().positive(),workspaceId:z.uuid(),sourceAssetId:z.uuid(),sourceVersion:z.int().positive(),consentId:z.uuid()}),
 source:nativeCharacterSource,voice:nativeCharacterSource.nullable(),
 project:z.strictObject({id:z.uuid(),version:z.int().positive(),segmentId:z.uuid(),relativeStartMs:z.int().nonnegative(),startMs:z.int().nonnegative(),durationMs:z.int().min(500).max(10000)}).nullable(),
 motion:z.strictObject({id:z.uuid(),version:z.int().positive(),content:characterMotionInput}).nullable(),
 training:z.strictObject({consentId:z.uuid(),qualityJobId:z.uuid(),qualityHash:z.string().regex(/^[a-f0-9]{64}$/),simulate:z.enum(['success','transient_failure','permanent_failure','unknown'])}).nullable()
});
export type NativeCharacterSource=z.infer<typeof nativeCharacterSource>;
export type NativeCharacterSnapshot=z.infer<typeof nativeCharacterSnapshot>;
export interface NativeCharacterJobRow{id:string;character_id:string;character_version:number;tenant_id:string;workspace_id:string;actor_id:string;operation:CharacterJob['operation'];project_id:string|null;project_version:number|null;input_snapshot:string;input_hash:string;status:CharacterJob['status'];version:number;attempts:number;lease_token:string|null;lease_until:string|null;error_code:string|null;error_message:string|null;outputs:string;result:string|null;applied_project_version:number|null;environment:string;app_env:string;created_at:string;updated_at:string}
export interface NativeCharacterReceipt{inputHash:string;operation:CharacterJob['operation'];attempt:number;qualityHash:string|null;outputs:CharacterOutput[];result:Record<string,unknown>;status:'succeeded'|'awaiting_review'|'unknown'}
