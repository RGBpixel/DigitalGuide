import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {AppError,canonical,type Principal} from '../../domain/src/index.js';
import type {LiveClock} from '../../domain/src/live.js';
import type {NativeLive} from './runtime-live.js';
import type {NativeLiveSessionRow} from './runtime-live-shapes.js';
import {nativeLiveDigest as digest} from './runtime-live-shapes.js';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const nativeTimelineSegment=z.strictObject({seq:z.int().min(0).max(599),startMs:z.int().min(0).max(1800000),durationMs:z.int().min(1).max(1800000),cueId:z.uuid(),kind:z.enum(['video','card']),sourceInMs:z.int().min(0).max(1800000),frozen:z.boolean(),muted:z.boolean(),text:z.string().max(1500),label:z.string().max(180),backgroundColor:z.string().regex(/^#[a-fA-F0-9]{6}$/),answerId:z.uuid().nullable()});
export const nativeTimelineSnapshot=z.strictObject({schemaVersion:z.literal(1),pipeline:z.literal('native-live-timeline-v1'),sessionId:z.uuid(),sessionHash:hash,stateHash:hash,durationMs:z.int().min(0).max(1800000),segments:z.array(nativeTimelineSegment).max(600),usedCueIds:z.array(z.uuid()).max(30)});
export const nativeTimelineGuard=z.strictObject({schemaVersion:z.literal(1),pipeline:z.literal('native-live-timeline-v1'),sessionId:z.uuid(),sessionHash:hash,stateHash:hash,segmentsHash:hash,expiresAt:z.iso.datetime()});
export const nativeTimelineExecution=z.strictObject({kind:z.enum(['source','compiled']),entrySHA256:hash,supervisorSHA256:hash,rendererSHA256:hash.optional(),ffmpegSHA256:hash,ffprobeSHA256:hash});
const object=z.strictObject({storage_key:z.string().regex(/^[a-f0-9-]{36}\.bin$/),sha256:hash,size:z.int().positive()});
export const nativeTimelineReceipt=z.strictObject({schemaVersion:z.literal(1),pipeline:z.literal('native-live-timeline-output-v1'),inputHash:hash,assetId:z.uuid(),uploadId:z.uuid(),object,poster:object,specs:z.record(z.string(),z.number()),expiresAt:z.iso.datetime(),execution:nativeTimelineExecution});
export type NativeTimelineSnapshot=z.infer<typeof nativeTimelineSnapshot>;
export type NativeTimelineReceipt=z.infer<typeof nativeTimelineReceipt>;
export function checkTimelineSegments(s:NativeTimelineSnapshot){let elapsed=0;for(const[seq,segment]of s.segments.entries()){if(segment.seq!==seq||segment.startMs!==elapsed)throw new AppError('LIVE_RECORDING_TIMELINE','原播出时间轴不连续，不能重建归档。',409);elapsed+=segment.durationMs;}if(elapsed!==s.durationMs)throw new AppError('LIVE_RECORDING_TIMELINE','原播出时间轴总时长不符，不能重建归档。',409);}
// Called after the terminal clock has been saved. Invalid/expired sources never prevent stopping.
export async function queueNativeTimelineRecording(live:NativeLive,p:Principal,r:NativeLiveSessionRow,state:LiveClock,requestId:string){
 const current=(await live.db.query<{state_hash:string;started_at:string|null;ended_at:string|null;status:string}>('SELECT state_hash,started_at,ended_at,status FROM live_sessions WHERE id=$1',[r.id])).rows[0],fixed=live.snapshot(r);
 if(current.status!=='ended'||!current.started_at||r.kind==='preview'||!fixed.definition.recordingEnabled||(await live.db.query('SELECT 1 FROM live_outputs WHERE session_id=$1',[r.id])).rowCount||(await live.db.query('SELECT 1 FROM live_recordings WHERE session_id=$1',[r.id])).rowCount)return;
 const rows=(await live.db.query<{segment:string;segment_hash:string}>('SELECT segment,segment_hash FROM live_segments WHERE session_id=$1 ORDER BY seq',[r.id])).rows,segments=rows.map(row=>{const value=nativeTimelineSegment.parse(JSON.parse(row.segment));if(digest(value)!==row.segment_hash)throw new AppError('LIVE_SEGMENT_CHANGED','播出片段摘要不符，停止记录需管理员核对。',409);return value;}),usedCueIds=[...new Set(segments.filter(s=>s.kind==='video').map(s=>s.cueId))].sort(),snapshot=nativeTimelineSnapshot.parse({schemaVersion:1,pipeline:'native-live-timeline-v1',sessionId:r.id,sessionHash:r.snapshot_hash,stateHash:current.state_hash,durationMs:state.elapsedMs,segments,usedCueIds}),expiresAt=[...fixed.sources.map(s=>s.expiresAt),...(fixed.scene?.assets.map(a=>a.expiresAt)??[]),...fixed.definition.products.map(p=>p.expiresAt),new Date(Date.parse(current.ended_at!)+30*86400000).toISOString()].filter((v):v is string=>!!v).sort()[0],guard=nativeTimelineGuard.parse({schemaVersion:1,pipeline:'native-live-timeline-v1',sessionId:r.id,sessionHash:r.snapshot_hash,stateHash:current.state_hash,segmentsHash:digest(segments),expiresAt}),id=randomUUID();
 await live.db.query('SELECT dg_native_queue_live_timeline($1,$2,$3,$4,$5,$6)',[r.id,id,canonical(snapshot),digest(snapshot),canonical(guard),digest(guard)]);await live.core.audit(p,r.workspace_id,'live.timeline_queued',id,requestId);
}
