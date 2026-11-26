import {AppError} from '../../domain/src/index.js';
import type {ProgrammeGrantRow,ProgrammeConnectionRow} from '../../domain/src/live-guest-programme.js';
import {nativeBusinessInteger as integer,type NativeCoreRepository} from './runtime-repository.js';
const numbers=<T extends object>(r:T,keys:(keyof T)[])=>{const v={...r};for(const key of keys)v[key]=integer(r[key]) as T[keyof T];return v;};
export const nativeProgrammeGrantValue=(r:ProgrammeGrantRow)=>numbers(r,['version','available_camera','available_microphone','recording_required','recording_allowed','camera','microphone']);
export const nativeProgrammeConnectionValue=(r:ProgrammeConnectionRow)=>numbers(r,['version','audio_muted','video_hidden','guest_sequence','rtp_audio','rtp_video','decoded_frames','decoded_pcm_bytes','video_ready','audio_ready']);
export const nativeProgrammeActive=(c:ProgrammeConnectionRow)=>['queued','connecting','connected'].includes(c.status);
export async function nativeProgrammeGrant(core:NativeCoreRepository,id:string){const r=(await core.db.query<ProgrammeGrantRow>("SELECT * FROM live_guest_programme_grants WHERE id=$1 AND environment='mock' AND app_env=$2",[id,core.db.config.appEnv])).rows[0];if(!r)throw new AppError('NOT_FOUND','本次节目授权不存在或不在当前环境。',404);return nativeProgrammeGrantValue(r);}
export async function nativeProgrammeConnection(core:NativeCoreRepository,grantId:string){const r=(await core.db.query<ProgrammeConnectionRow>("SELECT c.* FROM live_guest_programme_connections c JOIN live_guest_programme_grants g ON g.id=c.grant_id WHERE c.grant_id=$1 AND g.environment='mock' AND g.app_env=$2",[grantId,core.db.config.appEnv])).rows[0];return r?nativeProgrammeConnectionValue(r):undefined;}
