import {z} from 'zod';
import {puppetConfiguration} from './character.js';
const id=z.uuid(),version=z.int().positive(),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const livePuppetSettings=z.strictObject({characterId:id,characterVersion:version,placement:z.enum(['left','right'])});
export type LivePuppetSettings=z.infer<typeof livePuppetSettings>;
export const livePuppetBinding=z.strictObject({renderer:z.literal('digitalguide-puppet-rms-v1'),characterId:id,characterVersion:version,name:z.string().min(1).max(80),sourceAssetId:id,sourceVersion:version,sourceSHA256:sha,sourceSize:z.int().positive().max(4096),consentId:id,expiresAt:z.iso.datetime()});
export type LivePuppetBinding=z.infer<typeof livePuppetBinding>;
export const livePuppetSnapshot=z.strictObject({binding:livePuppetBinding,configuration:puppetConfiguration});
export type LivePuppetSnapshot=z.infer<typeof livePuppetSnapshot>;
