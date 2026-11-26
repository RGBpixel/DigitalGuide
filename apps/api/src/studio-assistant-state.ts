import {createHash} from 'node:crypto';
import {AppError,canonical} from '@digitalguide/domain';
import type {AssistantSession,AssistantTurn,AssistantGeneration,AssistantGenerationPlan} from '@digitalguide/contracts';
export const assistantHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export const assistantNow=()=>new Date().toISOString();
export interface AssistantSessionRow{
 id:string;tenant_id:string;workspace_id:string;actor_id:string;project_id:string;project_version:number;name:string;base_document:string;base_document_hash:string;source_hash:string;selected_ids:string;
 version:number;status:AssistantSession['status'];current_turn_id:string|null;current_generation_id:string|null;applied_project_version:number|null;applied_document_hash:string|null;environment:string;app_env:string;created_at:string;updated_at:string;
}
export interface AssistantTurnRow{id:string;session_id:string;number:number;parent_turn_id:string|null;actor_id:string;provider:AssistantTurn['provider'];instruction:string;proposal:string;proposal_hash:string;created_at:string}
export interface AssistantChildExport{segmentId:string;startMs:number;durationMs:number;exportId:string}
export interface AssistantGenerationRow{
 id:string;session_id:string;turn_id:string;number:number;actor_id:string;plan:string;plan_hash:string;status:AssistantGeneration['status'];version:number;branch_project_id:string|null;branch_version:number|null;branch_document_hash:string|null;speech_job_id:string|null;exports:string;error_code:string|null;error_message:string|null;created_at:string;updated_at:string;
}
export function assistantStoredPlan(row:AssistantGenerationRow):AssistantGenerationPlan{const plan=JSON.parse(row.plan) as AssistantGenerationPlan;const{hash,...body}=plan;if(hash!==row.plan_hash||assistantHash(body)!==hash)throw new AppError('ASSISTANT_GENERATION_CHANGED','固定局部生成计划校验不符。',409);return plan;}
