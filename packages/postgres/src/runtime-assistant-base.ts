import {randomUUID} from 'node:crypto';
import type {z} from 'zod';
import {AppError,canonical,requirePermission,type Principal} from '../../domain/src/index.js';
import {studioDocumentInput,type StudioDocument,type AssistantProposal,type AssistantTurn,type assistantSessionCreate,type assistantTurnCreate} from '../../contracts/src/index.js';
import {assistantRanges,validateAssistantProposal} from '../../domain/src/studio-assistant.js';
import {NativeStudio} from './runtime-studio.js';
import {NativePrivateObjects} from './runtime-objects.js';
import {nativeBusinessInteger,type NativeCoreRepository} from './runtime-repository.js';
import {assistantHash,assistantSessionRow,assistantTurnRow,assistantGenerationRow,type NativeAssistantSession,type NativeAssistantTurn,type NativeAssistantGeneration} from './runtime-assistant-state.js';

export class NativeAssistantBase {
 readonly studio:NativeStudio;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd()){this.studio=new NativeStudio(core);}
 get db(){return this.core.db;}
 async scope(p:Principal,workspace:string,write=false){requirePermission(p,write?'studio.write':'asset.read');await this.core.workspaceLock(p,workspace,write);}
 async session(p:Principal,id:string,write=false){
  const initial=(await this.db.query<NativeAssistantSession>("SELECT * FROM studio_assistant_sessions WHERE id=$1 AND tenant_id=$2 AND environment='mock' AND app_env=$3",[id,p.tenantId,this.db.config.appEnv])).rows[0];
  if(!initial)throw new AppError('NOT_FOUND','编辑对话不存在或不在当前环境。',404);
  await this.scope(p,initial.workspace_id,write);await this.db.query('SELECT user_id FROM dg_native_locked_membership($1)',[initial.actor_id]);
  const row=(await this.db.query<NativeAssistantSession>('SELECT * FROM studio_assistant_sessions WHERE id=$1 FOR '+(write?'UPDATE':'SHARE'),[id])).rows[0];return assistantSessionRow(row);
 }
 async turn(p:Principal,id:string){const row=(await this.db.query<NativeAssistantTurn>('SELECT * FROM studio_assistant_turns WHERE id=$1',[id])).rows[0];if(!row)throw new AppError('NOT_FOUND','编辑候选不存在。',404);await this.session(p,row.session_id);return assistantTurnRow(row);}
 async generation(p:Principal,id:string,write=false){const row=(await this.db.query<NativeAssistantGeneration>('SELECT * FROM studio_assistant_generations WHERE id=$1',[id])).rows[0];if(!row)throw new AppError('NOT_FOUND','局部生成不存在。',404);await this.session(p,row.session_id,write);return assistantGenerationRow((await this.db.query<NativeAssistantGeneration>('SELECT * FROM studio_assistant_generations WHERE id=$1 FOR '+(write?'UPDATE':'SHARE'),[id])).rows[0]);}
 version(row:{version:number},expected:number){this.studio.version(row,expected);}
 base(row:NativeAssistantSession){const doc=studioDocumentInput.parse(JSON.parse(row.base_document));if(assistantHash(doc)!==row.base_document_hash)throw new AppError('ASSISTANT_SOURCE_CHANGED','固定原稿校验不符，请从当前工程另开对话。',409);return doc;}
 selected(row:NativeAssistantSession){const ids=JSON.parse(row.selected_ids) as string[];assistantRanges(this.base(row),ids);return ids;}
 proposal(row:NativeAssistantSession,turn:NativeAssistantTurn){if(turn.session_id!==row.id)throw new AppError('NOT_FOUND','候选不属于此对话。',404);const proposal=validateAssistantProposal(this.base(row),this.selected(row),JSON.parse(turn.proposal));if(assistantHash({parentTurnId:turn.parent_turn_id,provider:turn.provider,instruction:turn.instruction,proposal})!==turn.proposal_hash)throw new AppError('ASSISTANT_PROPOSAL_CHANGED','候选及来源校验不符。',409);return proposal;}
 async sourceReason(p:Principal,row:NativeAssistantSession):Promise<string|null>{
  try{
   const ledger=(await this.db.query<{snapshot:string;invalidated_at:string|null}>('SELECT snapshot,invalidated_at FROM _dg_native_assistant_sources WHERE session_id=$1',[row.id])).rows[0];
   if(!ledger||ledger.invalidated_at)throw new AppError('ASSISTANT_SOURCE_CHANGED','原对话来源或创建人权限已经失效，请从当前工程重新确认。',409);
   const originalActor=await this.core.principal(row.actor_id);if(originalActor.tenantId!==row.tenant_id)throw new AppError('ASSISTANT_ACTOR_CHANGED','原对话创建人的组织已变化。',409);await this.scope(originalActor,row.workspace_id,true);
   const project=await this.studio.project(p,row.project_id);if(project.workspace_id!==row.workspace_id)throw new AppError('ASSISTANT_SOURCE_CHANGED','原工程工作空间已变化。',409);
   const source=await this.studio.sources.inspect(p,row.workspace_id,project.purpose,this.base(row));
   if(source.hash!==row.source_hash||assistantHash(JSON.parse(ledger.snapshot))!==source.hash)throw new AppError('ASSISTANT_SOURCE_CHANGED','原素材、授权、内容来源或参考版本已变化，请重新确认。',409);
   return null;
  }catch(error){if(!(error instanceof AppError))throw error;return error.message;}
 }
 async staleReason(p:Principal,row:NativeAssistantSession){const reason=await this.sourceReason(p,row);if(reason)return reason;const project=await this.studio.project(p,row.project_id);if(project.archived)return'原工程已归档，请先恢复并从当前版本另开对话。';if(project.version!==(row.applied_project_version??row.project_version)||assistantHash(JSON.parse(project.document))!==(row.applied_document_hash??row.base_document_hash))return'原工程版本已变化；对话保留原稿，请从最新工程另开对话，旧候选不会覆盖它。';return null;}
 async current(p:Principal,row:NativeAssistantSession){await this.scope(p,row.workspace_id,true);if(row.status!=='open')throw new AppError('ASSISTANT_SESSION_CLOSED','此对话已写回或关闭，请从最新工程另开对话。',409);const reason=await this.staleReason(p,row);if(reason)throw new AppError('ASSISTANT_STALE',reason,409);return this.studio.project(p,row.project_id,true);}
 async actor(row:NativeAssistantSession,actorId:string){const p=await this.core.principal(actorId);if(p.tenantId!==row.tenant_id)throw new AppError('ASSISTANT_ACTOR_CHANGED','原操作人的组织已变化。',409);await this.scope(p,row.workspace_id,true);return p;}
 async busy(row:NativeAssistantSession){const r=(await this.db.query<NativeAssistantGeneration>("SELECT * FROM studio_assistant_generations WHERE session_id=$1 AND status IN('queued','speech','video') ORDER BY created_at,id LIMIT 1",[row.id])).rows[0];return r?assistantGenerationRow(r):null;}
 async createSession(p:Principal,input:z.infer<typeof assistantSessionCreate>){
  await this.studio.scope(p,input.projectId,true);const project=await this.studio.project(p,input.projectId,true);this.studio.version(project,input.projectVersion);this.studio.editable(project);
  const doc=studioDocumentInput.parse(JSON.parse(project.document)),ranges=assistantRanges(doc,input.segmentIds),source=await this.studio.sources.inspect(p,project.workspace_id,project.purpose,doc);
  if((await this.db.query<{n:number}>('SELECT count(*)::int AS n FROM studio_assistant_sessions WHERE project_id=$1',[project.id])).rows[0].n>=100)throw new AppError('ASSISTANT_SESSION_LIMIT','每个工程最多一百份编辑对话，请使用新工程继续。',429);
  const id=randomUUID();await this.db.query('INSERT INTO studio_assistant_sessions(id,tenant_id,workspace_id,actor_id,project_id,project_version,name,base_document,base_document_hash,source_hash,selected_ids,environment,app_env,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,\'mock\',$12,dg_utc_now(),dg_utc_now())',[id,p.tenantId,project.workspace_id,p.userId,project.id,project.version,input.name,JSON.stringify(doc),assistantHash(doc),source.hash,JSON.stringify(ranges.map(r=>r.segmentId)),this.db.config.appEnv]);
  await this.db.query('INSERT INTO _dg_native_assistant_sources(session_id,snapshot,created_at) VALUES($1,$2,dg_utc_now())',[id,JSON.stringify(source.snapshot)]);return id;
 }
 async assertNotInterpreting(row:NativeAssistantSession,ignore=''){if((await this.db.query("SELECT id FROM studio_assistant_interpretations WHERE session_id=$1 AND status IN('queued','processing') AND id<>$2",[row.id,ignore])).rowCount)throw new AppError('ASSISTANT_INTERPRETATION_ACTIVE','本机语义候选正在生成，请等待或取消原任务。',409);}
 async turnContext(p:Principal,row:NativeAssistantSession,input:z.infer<typeof assistantTurnCreate>,ignore?:string){
  await this.assertNotInterpreting(row,ignore);await this.current(p,row);this.version(row,input.version);if(row.current_turn_id!==input.parentTurnId)throw new AppError('ASSISTANT_PARENT_CHANGED','当前候选已变化，请保留输入并载入最新对话。',409);
  if(await this.busy(row))throw new AppError('ASSISTANT_GENERATION_ACTIVE','此候选正在生成，请等待或取消原任务。',409);
  if((await this.db.query<{n:number}>('SELECT count(*)::int AS n FROM studio_assistant_turns WHERE session_id=$1',[row.id])).rows[0].n>=30)throw new AppError('ASSISTANT_TURN_LIMIT','本对话最多三十轮候选，请从最新工程另开对话。',429);
  return{original:this.base(row),parent:input.parentTurnId?this.proposal(row,await this.turn(p,input.parentTurnId)):null,selectedIds:this.selected(row),provider:input.provider,instruction:input.instruction,replacements:input.replacements,allowMock:true};
 }
 async createTurn(p:Principal,row:NativeAssistantSession,input:z.infer<typeof assistantTurnCreate>,candidate:AssistantProposal,contextHash:string){
  const context=await this.turnContext(p,row,input);if(assistantHash(context)!==contextHash)throw new AppError('ASSISTANT_CONTEXT_CHANGED','原工程、候选或权限发生变化，请重新核对。',409);
  if(input.provider==='local_llm'||candidate.modelEvidence)throw new AppError('ASSISTANT_INTERPRETATION_JOB_REQUIRED','本机模型证据只能由原语义任务提交，不能通过候选接口伪造。',422);
  const proposal=validateAssistantProposal(context.original,context.selectedIds,candidate);if(proposal.simulated!==(input.provider==='mock_editor'||!!context.parent?.simulated))throw new AppError('ASSISTANT_PROVIDER_MISMATCH','候选提供方式及模拟继承标记不一致。',409);
  const id=randomUUID(),number=(await this.db.query<{n:number}>('SELECT coalesce(max(number),0)::int+1 AS n FROM studio_assistant_turns WHERE session_id=$1',[row.id])).rows[0].n,hash=assistantHash({parentTurnId:input.parentTurnId,provider:input.provider,instruction:input.instruction,proposal});
  await this.db.query('INSERT INTO studio_assistant_turns VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,dg_utc_now())',[id,row.id,number,input.parentTurnId,p.userId,input.provider,input.instruction,JSON.stringify(proposal),hash]);await this.db.query('UPDATE studio_assistant_sessions SET current_turn_id=$1,current_generation_id=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=$2',[id,row.id]);return row.id;
 }
 turnView(row:NativeAssistantSession,turn:NativeAssistantTurn,available:boolean):AssistantTurn{return{id:turn.id,sessionId:row.id,number:turn.number,parentTurnId:turn.parent_turn_id,provider:turn.provider,instruction:available?turn.instruction:null,proposal:available?this.proposal(row,turn):null,hash:turn.proposal_hash,isCurrent:row.current_turn_id===turn.id,createdAt:turn.created_at};}
 unchanged(base:StudioDocument,candidate:StudioDocument,ids:string[]){for(const s of base.segments.filter(s=>!ids.includes(s.id)))if(canonical(candidate.segments.find(t=>t.id===s.id))!==canonical(s))throw new AppError('ASSISTANT_UNRELATED_CHANGE','候选影响未选分镜，不能写回。',409);}
 async checkedSources(p:Principal,row:NativeAssistantSession){const reason=await this.sourceReason(p,row);if(reason)throw new AppError('ASSISTANT_SOURCE_CHANGED',reason,409);const project=await this.studio.project(p,row.project_id),source=await this.studio.sources.inspect(p,row.workspace_id,project.purpose,this.base(row));const objects=new NativePrivateObjects(this.db.config);for(const file of source.files.values())await objects.verify(file,nativeBusinessInteger(file.size));return source.hash;}
}
