import {randomUUID} from 'node:crypto';
import type {z} from 'zod';
import type {Repository} from '@digitalguide/database';
import {AppError,canonical,requirePermission,requireWorkspace,type Principal} from '@digitalguide/domain';
import {studioDocumentInput,type StudioDocument,type AssistantProposal,type AssistantTurn,type assistantSessionCreate,type assistantTurnCreate} from '@digitalguide/contracts';
import {assistantRanges,validateAssistantProposal} from '../../../packages/domain/src/studio-assistant.js';
import type {Config} from './config.js';
import {StudioService} from './studio-service.js';
import {studioSourceSnapshot} from './studio-source-snapshot.js';
import {assistantHash,assistantNow,type AssistantSessionRow,type AssistantTurnRow,type AssistantGenerationRow} from './studio-assistant-state.js';

export class StudioAssistantBase{
 studio:StudioService;
 constructor(public repo:Repository,public config:Config){this.studio=new StudioService(repo,config.providerMode,config.appEnv,config.dataDir);}
 scope(p:Principal,workspaceId:string,write=false){requireWorkspace(p,workspaceId);requirePermission(p,'asset.read');if(write)requirePermission(p,'studio.write');}
 session(p:Principal,id:string,write=false){const row=this.repo.get<AssistantSessionRow>('SELECT * FROM studio_assistant_sessions WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.config.providerMode,this.config.appEnv);if(!row)throw new AppError('NOT_FOUND','编辑对话不存在或不在当前环境。',404);this.scope(p,row.workspace_id,write);return row;}
 turn(p:Principal,id:string,write=false){const row=this.repo.get<AssistantTurnRow>('SELECT * FROM studio_assistant_turns WHERE id=?',id);if(!row)throw new AppError('NOT_FOUND','候选修改不存在。',404);this.session(p,row.session_id,write);return row;}
 generation(p:Principal,id:string,write=false){const row=this.repo.get<AssistantGenerationRow>('SELECT * FROM studio_assistant_generations WHERE id=?',id);if(!row)throw new AppError('NOT_FOUND','局部生成任务不存在。',404);this.session(p,row.session_id,write);return row;}
 version(row:{version:number},version:number){if(row.version!==version)throw new AppError('VERSION_CONFLICT','对话、工程或候选状态已变化，已保留当前输入，请载入最新状态后重新核对。',409);}
 base(row:AssistantSessionRow){const doc=studioDocumentInput.parse(JSON.parse(row.base_document));if(assistantHash(doc)!==row.base_document_hash)throw new AppError('ASSISTANT_SOURCE_CHANGED','原工程快照校验不符，不能继续生成。',409);return doc;}
 selected(row:AssistantSessionRow){const ids=JSON.parse(row.selected_ids) as string[];assistantRanges(this.base(row),ids);return ids;}
 proposal(session:AssistantSessionRow,turn:AssistantTurnRow):AssistantProposal{if(turn.session_id!==session.id)throw new AppError('ASSISTANT_TURN_SCOPE','候选修改不属于此对话。',404);const proposal=validateAssistantProposal(this.base(session),this.selected(session),JSON.parse(turn.proposal));if(assistantHash({parentTurnId:turn.parent_turn_id,provider:turn.provider,instruction:turn.instruction,proposal})!==turn.proposal_hash)throw new AppError('ASSISTANT_PROPOSAL_CHANGED','固定候选修改校验不符。',409);return proposal;}
 sourceReason(p:Principal,row:AssistantSessionRow):string|null{
  try{this.scope(p,row.workspace_id);const project=this.studio.project(p,row.project_id),base=this.base(row);if(project.workspace_id!==row.workspace_id)throw new AppError('ASSISTANT_PROJECT_SCOPE','原工程不在当前工作空间。',409);const source=studioSourceSnapshot(this.studio,p,row.workspace_id,project.purpose,base);if(source.hash!==row.source_hash)throw new AppError('ASSISTANT_SOURCE_CHANGED','来源素材、配置或授权已变化，请按当前工程重新开始对话。',409);return null;}catch(error){if(!(error instanceof AppError))throw error;return error.message;}
 }
 staleReason(p:Principal,row:AssistantSessionRow):string|null{
  const source=this.sourceReason(p,row);if(source)return source;
  const project=this.studio.project(p,row.project_id),expected=row.applied_project_version||row.project_version,hash=row.applied_document_hash||row.base_document_hash;
  if(project.archived)return'原工程已归档，请先恢复并核对当前版本。';
  if(project.version!==expected||assistantHash(JSON.parse(project.document))!==hash)return'原工程已有其他修改；本对话和预览保留，请从最新工程另开对话，不能覆盖保存。';
  return null;
 }
 current(p:Principal,row:AssistantSessionRow){this.scope(p,row.workspace_id,true);if(row.status!=='open')throw new AppError('ASSISTANT_SESSION_CLOSED','对话已写回或关闭，请按当前工程新建编辑对话。',409);const reason=this.staleReason(p,row);if(reason)throw new AppError('ASSISTANT_STALE',reason,409);return this.studio.project(p,row.project_id);}
 actor(row:AssistantSessionRow,actorId:string){const p={...this.repo.principal(actorId),environment:this.config.providerMode,appEnv:this.config.appEnv};if(p.tenantId!==row.tenant_id)throw new AppError('ASSISTANT_ACTOR_CHANGED','原生成成员已离开当前组织。',409);this.scope(p,row.workspace_id,true);return p;}
 busy(row:AssistantSessionRow){return this.repo.get<AssistantGenerationRow>("SELECT * FROM studio_assistant_generations WHERE session_id=? AND status IN ('queued','speech','video')",row.id);}
 createSession(p:Principal,input:z.infer<typeof assistantSessionCreate>){
  const project=this.studio.project(p,input.projectId);this.scope(p,project.workspace_id,true);this.studio.version(project,input.projectVersion);this.studio.editable(project);const doc=studioDocumentInput.parse(JSON.parse(project.document)),ranges=assistantRanges(doc,input.segmentIds),source=studioSourceSnapshot(this.studio,p,project.workspace_id,project.purpose,doc);if(this.repo.get<{n:number}>('SELECT count(*) n FROM studio_assistant_sessions WHERE project_id=?',project.id)!.n>=100)throw new AppError('ASSISTANT_SESSION_LIMIT','此工程最多一百份编辑对话，请另存工程后继续。',429);const id=randomUUID(),now=assistantNow();
  this.repo.run('INSERT INTO studio_assistant_sessions(id,tenant_id,workspace_id,actor_id,project_id,project_version,name,base_document,base_document_hash,source_hash,selected_ids,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,p.tenantId,project.workspace_id,p.userId,project.id,project.version,input.name,JSON.stringify(doc),assistantHash(doc),source.hash,JSON.stringify(ranges.map(r=>r.segmentId)),this.config.providerMode,this.config.appEnv,now,now);return id;
 }
 assertNotInterpreting(row:AssistantSessionRow,ignoreId=''){if(this.repo.get("SELECT id FROM studio_assistant_interpretations WHERE session_id=? AND status IN ('queued','processing') AND id<>?",row.id,ignoreId))throw new AppError('ASSISTANT_INTERPRETATION_ACTIVE','本机语义候选正在生成，请等待或取消原任务后继续编辑。',409);}
 turnContext(p:Principal,row:AssistantSessionRow,input:z.infer<typeof assistantTurnCreate>,ignoreInterpretationId?:string){
  this.assertNotInterpreting(row,ignoreInterpretationId);
  this.current(p,row);this.version(row,input.version);if(row.current_turn_id!==input.parentTurnId)throw new AppError('ASSISTANT_PARENT_CHANGED','当前候选已经变化，请保留输入并载入最新对话。',409);if(this.busy(row))throw new AppError('ASSISTANT_GENERATION_ACTIVE','所选候选正在生成，请先等待或取消原任务再继续编辑。',409);const original=this.base(row),parent=input.parentTurnId?this.proposal(row,this.turn(p,input.parentTurnId)):null;
  if((this.repo.get<{n:number}>('SELECT count(*) n FROM studio_assistant_turns WHERE session_id=?',row.id)?.n||0)>=30)throw new AppError('ASSISTANT_TURN_LIMIT','本对话最多三十轮候选，请从最新工程另开对话。',429);
  return{original,parent,selectedIds:this.selected(row),provider:input.provider,instruction:input.instruction,replacements:input.replacements,allowMock:this.config.providerMode==='mock'&&this.config.appEnv!=='production'};
 }
 createTurn(p:Principal,row:AssistantSessionRow,input:z.infer<typeof assistantTurnCreate>,candidate:AssistantProposal,contextHash:string,interpretationId?:string){
  const context=this.turnContext(p,row,input,interpretationId);if(assistantHash(context)!==contextHash)throw new AppError('ASSISTANT_CONTEXT_CHANGED','生成建议期间原工程、候选或权限发生变化，请重新核对。',409);const proposal=validateAssistantProposal(context.original,context.selectedIds,candidate);if(proposal.simulated&&!context.allowMock)throw new AppError('ASSISTANT_MOCK_DISABLED','当前环境不能保存模拟候选。',409);if(proposal.simulated!==(input.provider==='mock_editor'||!!context.parent?.simulated))throw new AppError('ASSISTANT_PROVIDER_MISMATCH','候选结果的提供方式或模拟继承标记与当前请求不一致。',409);
  const id=randomUUID(),number=(this.repo.get<{n:number}>('SELECT MAX(number) n FROM studio_assistant_turns WHERE session_id=?',row.id)?.n||0)+1,now=assistantNow(),hash=assistantHash({parentTurnId:input.parentTurnId,provider:input.provider,instruction:input.instruction,proposal});this.repo.run('INSERT INTO studio_assistant_turns VALUES (?,?,?,?,?,?,?,?,?,?)',id,row.id,number,input.parentTurnId,p.userId,input.provider,input.instruction,JSON.stringify(proposal),hash,now);this.repo.run('UPDATE studio_assistant_sessions SET current_turn_id=?,current_generation_id=NULL,version=version+1,updated_at=? WHERE id=?',id,now,row.id);return row.id;
 }
 turnView(row:AssistantSessionRow,turn:AssistantTurnRow,sourceAvailable:boolean):AssistantTurn{return{id:turn.id,sessionId:row.id,number:turn.number,parentTurnId:turn.parent_turn_id,provider:turn.provider,instruction:sourceAvailable?turn.instruction:null,proposal:sourceAvailable?this.proposal(row,turn):null,hash:turn.proposal_hash,isCurrent:row.current_turn_id===turn.id,createdAt:turn.created_at};}
 unchanged(base:StudioDocument,candidate:StudioDocument,ids:string[]){for(const segment of base.segments.filter(s=>!ids.includes(s.id)))if(canonical(candidate.segments.find(s=>s.id===segment.id))!==canonical(segment))throw new AppError('ASSISTANT_UNRELATED_CHANGE','候选修改影响到未选分镜，不能写回。',409);}
}
