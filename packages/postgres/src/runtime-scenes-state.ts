import {z} from 'zod';
import {sceneAppSchema,profileSchema} from '../../contracts/src/index.js';
export const nativeSceneSnapshot=sceneAppSchema.extend({profile:profileSchema});
export const nativeSceneAsset=z.strictObject({id:z.uuid(),version:z.int().positive(),storage_key:z.string().regex(/^[a-f0-9-]{36}\.(bin|png|wav)$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.int().positive(),media_type:z.enum(['image/png','audio/wav']),expiresAt:z.iso.datetime().nullable()});
export const nativeLiveScene=z.strictObject({app:nativeSceneSnapshot,assets:z.array(nativeSceneAsset).min(1).max(2)});
export type NativeLiveScene=z.infer<typeof nativeLiveScene>;
