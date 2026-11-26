import {createHash} from 'node:crypto';
import {canonical,AppError} from '../../domain/src/index.js';
import {assistantGenerationPlanSchema,type AssistantGenerationPlan,type AssistantSession,type AssistantGeneration,type AssistantInterpretation} from '../../contracts/src/index.js';
import {nativeBusinessInteger as integer} from './runtime-repository.js';

export const assistantHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export interface NativeAssistantSession {
 id:string;tenant_id:string;workspace_id:string;actor_id:string;project_id:string;project_version:number;name:string;
 base_document:string;base_document_hash:string;source_hash:string;selected_ids:string;version:number;status:AssistantSession['status'];
 current_turn_id:string|null;current_generation_id:string|null;applied_project_version:number|null;applied_document_hash:string|null;
 environment:string;app_env:string;created_at:string;updated_at:string;
}
export interface NativeAssistantTurn {id:string;session_id:string;number:number;parent_turn_id:string|null;actor_id:string;provider:import('../../contracts/src/index.js').AssistantTurn['provider'];instruction:string;proposal:string;proposal_hash:string;created_at:string}
export interface NativeAssistantGeneration {
 id:string;session_id:string;turn_id:string;number:number;actor_id:string;plan:string;plan_hash:string;status:AssistantGeneration['status'];version:number;
 branch_project_id:string|null;branch_version:number|null;branch_document_hash:string|null;speech_job_id:string|null;exports:string;error_code:string|null;error_message:string|null;created_at:string;updated_at:string;
}
export interface NativeAssistantInterpretation {
 id:string;session_id:string;tenant_id:string;workspace_id:string;actor_id:string;environment:string;app_env:string;session_version:number;parent_turn_id:string|null;
 request:string;context_hash:string;engine:string;input_hash:string;status:AssistantInterpretation['status'];version:number;control_version:number;attempts:number;progress:number;
 lease_token:string|null;lease_until:string|null;turn_id:string|null;evidence:string|null;error_code:string|null;error_message:string|null;created_at:string;updated_at:string;
}
export interface AssistantChildExport {segmentId:string;startMs:number;durationMs:number;exportId:string}
export function assistantSessionRow(r:NativeAssistantSession):NativeAssistantSession{return{...r,project_version:integer(r.project_version),version:integer(r.version),applied_project_version:r.applied_project_version===null?null:integer(r.applied_project_version)};}
export function assistantTurnRow(r:NativeAssistantTurn):NativeAssistantTurn{return{...r,number:integer(r.number)};}
export function assistantGenerationRow(r:NativeAssistantGeneration):NativeAssistantGeneration{return{...r,number:integer(r.number),version:integer(r.version),branch_version:r.branch_version===null?null:integer(r.branch_version)};}
export function assistantInterpretationRow(r:NativeAssistantInterpretation):NativeAssistantInterpretation{return{...r,session_version:integer(r.session_version),version:integer(r.version),control_version:integer(r.control_version),attempts:integer(r.attempts)};}
export function assistantStoredPlan(row:NativeAssistantGeneration):AssistantGenerationPlan {
 const plan=assistantGenerationPlanSchema.parse(JSON.parse(row.plan)),{hash,...body}=plan;
 if(hash!==row.plan_hash||assistantHash(body)!==hash)throw new AppError('ASSISTANT_GENERATION_CHANGED','已确认的局部生成计划校验不符，请保留旧任务并重新预检。',409);
 return plan;
}
