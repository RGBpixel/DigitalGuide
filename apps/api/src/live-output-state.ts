import {createHash} from 'node:crypto';
import type {Repository} from '@digitalguide/database';
import {AppError,assertUsableAsset,canonical,requirePermission,requireWorkspace,type Principal} from '@digitalguide/domain';
import {liveOutputSettings,livePuppetSnapshot,type LiveOutput,type LiveOutputSettings,type LivePuppetSnapshot} from '@digitalguide/contracts';
import {assertLivePuppet} from '../../../packages/domain/src/live-puppet.js';
import {validateLiveSpeechPlan,type LiveSpeechPlanRow} from '../../../packages/domain/src/live-speech.js';

export const outputDigest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export interface OutputAsset{id:string;version:number;sha256:string;size:number;mediaType:string;expiresAt:string|null;specs:Record<string,number>}
export interface OutputSnapshot{schemaVersion:1;sessionHash:string;settings:LiveOutputSettings;assets:OutputAsset[];speech?:{planId:string;resultHash:string};puppet?:LivePuppetSnapshot}
export interface LiveOutputRow{
 id:string;session_id:string;tenant_id:string;workspace_id:string;actor_id:string;snapshot:string;snapshot_hash:string;presentation:string;presentation_hash:string;presentation_version:number;
 status:LiveOutput['status'];version:number;attempts:number;lease_token:string|null;lease_until:string|null;generation_id:string|null;generation:number;accepted_frames:number;encoded_frames:number;published_frames:number;published_duration_ms:number;interruptions:number;error_message:string|null;withdrawn_at:string|null;environment:string;app_env:string;created_at:string;updated_at:string;
}
export interface OutputGeneration{id:string;output_id:string;number:number;lease_token:string;work_key:string;start_frame:number;accepted_frames:number;encoded_frames:number;published_frames:number;duration_ms:number;status:string;started_at:string;ended_at:string|null}
export interface OutputPart{id:string;output_id:string;generation_id:string;kind:'init'|'segment';sequence:number;duration_ms:number;media_start_ms:number;storage_key:string;size:number;sha256:string;published_at:string}
export function outputAttachment(repo:Repository,sessionId:string){return repo.get<LiveOutputRow>('SELECT * FROM live_outputs WHERE session_id=?',sessionId);}
export function outputSource(repo:Repository,p:Principal,r:LiveOutputRow){
 requireWorkspace(p,r.workspace_id);repo.environment(p,r.environment,r.app_env);
 if(p.tenantId!==r.tenant_id||r.withdrawn_at||r.status==='withdrawn')throw new AppError('LIVE_OUTPUT_UNAVAILABLE','连续媒体用途已撤回或不在当前组织。',409);
 const snapshot=JSON.parse(r.snapshot) as OutputSnapshot;liveOutputSettings.parse(snapshot.settings);
 if(snapshot.schemaVersion!==1||outputDigest(snapshot)!==r.snapshot_hash||repo.get<{snapshot_hash:string}>('SELECT snapshot_hash FROM live_sessions WHERE id=? AND tenant_id=?',r.session_id,p.tenantId)?.snapshot_hash!==snapshot.sessionHash)throw new AppError('LIVE_OUTPUT_SNAPSHOT','连续媒体的固定来源摘要不符。',409);
 const creator=repo.principal(r.actor_id);requirePermission(creator,'live.start');requireWorkspace(creator,r.workspace_id);if(creator.tenantId!==r.tenant_id)throw new AppError('LIVE_OUTPUT_ACTOR','原媒体任务成员的组织已变化。',409);
 for(const fixed of snapshot.assets){const a=repo.asset(p,fixed.id);assertUsableAsset(a);if(a.workspaceId!==r.workspace_id||a.version!==fixed.version||a.sha256!==fixed.sha256||a.size!==fixed.size||a.mediaType!==fixed.mediaType||canonical(a.specs)!==canonical(fixed.specs))throw new AppError('LIVE_OUTPUT_ASSET_CHANGED','连续媒体的背景或音乐来源已经变化，请重新准备场次。',409);}
 if(snapshot.settings.speechPlanId){const plan=repo.get<LiveSpeechPlanRow>('SELECT * FROM live_speech_plans WHERE id=?',snapshot.settings.speechPlanId);if(!plan||snapshot.speech?.planId!==plan.id||snapshot.speech.resultHash!==plan.result_hash||plan.session_id!==r.session_id)throw new AppError('LIVE_SPEECH_PLAN_UNAVAILABLE','固定播音方案或结果摘要不符。',409);validateLiveSpeechPlan(repo,p,plan,r.environment,r.app_env,snapshot.sessionHash,true);}else if(snapshot.speech)throw new AppError('LIVE_SPEECH_PLAN_UNAVAILABLE','媒体未明确选择此播音方案。',409);
 if(snapshot.settings.puppet){const puppet=livePuppetSnapshot.parse(snapshot.puppet);if(!snapshot.settings.speechPlanId||snapshot.settings.puppet.characterId!==puppet.binding.characterId||snapshot.settings.puppet.characterVersion!==puppet.binding.characterVersion)throw new AppError('LIVE_PUPPET_BINDING','所选二维角色与固定形象或播音方案不一致。',409);assertLivePuppet(repo,p,puppet.binding,r.workspace_id,r.environment,r.app_env);}else if(snapshot.puppet)throw new AppError('LIVE_PUPPET_BINDING','本场没有明确选择此二维形象。',409);
 return snapshot;
}
export function startOutputAttachment(repo:Repository,p:Principal,sessionId:string){const r=outputAttachment(repo,sessionId);if(!r)return false;outputSource(repo,p,r);if(r.status!=='armed')throw new AppError('LIVE_OUTPUT_NOT_ARMED','连续媒体已取消或启动，请停止本场并重新准备。',409);repo.run("UPDATE live_outputs SET status='queued',version=version+1,updated_at=? WHERE id=?",new Date().toISOString(),r.id);return true;}
