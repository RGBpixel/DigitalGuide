import {blankStudioDocument,type AssistantProposal,type AssistantVoiceIntent} from '@digitalguide/contracts';
import {AppError} from '@digitalguide/domain';
import {interpretAssistant} from '../../domain/src/studio-assistant.js';
export interface StudioEditorRequest{
 instruction:string;segments:{id:string;title:string;durationMs:number;originalText:string;candidateText:string}[];replacements:{segmentId:string;text:string}[];
 hasParent:boolean;voiceIntent:AssistantVoiceIntent;inheritedSimulated:boolean;warnings:string[];
}
export interface StudioEditorProvider{id:'local_commands'|'manual'|'mock_editor'|'external_editor'|'local_llm';interpret(input:StudioEditorRequest,signal?:AbortSignal):Promise<AssistantProposal>}
export function studioEditorProvider(id:StudioEditorProvider['id'],allowMock:boolean):StudioEditorProvider{
 if(id==='external_editor')throw new AppError('ASSISTANT_PROVIDER_UNCONFIGURED','真实语义编辑模型尚未配置，不会退回规则或模拟成功。',503);
 if(id==='local_llm')throw new AppError('ASSISTANT_INTERPRETATION_JOB_REQUIRED','本机语义编辑需要通过持久任务执行，请使用本机语义生成入口。',422);
 if(id==='mock_editor'&&!allowMock)throw new AppError('ASSISTANT_MOCK_DISABLED','当前环境不能使用模拟编辑模型。',409);
 return{id,async interpret(input,signal){if(signal?.aborted)throw new AppError('CANCELLED','编辑建议已取消。',409);const original=blankStudioDocument(),example=original.segments[0];original.speakers=[];original.segments=input.segments.map(s=>({...structuredClone(example),id:s.id,title:s.title,durationMs:s.durationMs,text:s.originalText,elements:[],speakerId:null}));const parent:AssistantProposal|null=input.hasParent?{schemaVersion:1,patches:input.segments.map(s=>({segmentId:s.id,beforeText:s.originalText,afterText:s.candidateText})),voiceIntent:input.voiceIntent,warnings:input.warnings,message:'继续当前候选',simulated:input.inheritedSimulated}:null;return interpretAssistant({provider:id,instruction:input.instruction,replacements:input.replacements,selectedIds:input.segments.map(s=>s.id),original,parent,allowMock});}};
}
