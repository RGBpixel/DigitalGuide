import type {z} from 'zod';
import {AppError,hasPermission,type Principal} from '@digitalguide/domain';
import type {AssistantSession,AssistantSessionSummary,StudioDocument,SpeechOutput,assistantApply} from '@digitalguide/contracts';
import {assistantRanges,prepareAssistantMedia} from '../../../packages/domain/src/studio-assistant.js';
import {StudioAssistantGenerations} from './studio-assistant-generations.js';
import {assistantHash,assistantNow,assistantStoredPlan,type AssistantSessionRow,type AssistantTurnRow,type AssistantGenerationRow} from './studio-assistant-state.js';

export class StudioAssistantService extends StudioAssistantGenerations{
 transition(row:AssistantGenerationRow,status:AssistantGenerationRow['status'],values:{branchId?:string;branchVersion?:number;branchHash?:string;speechJobId?:string;exports?:string}={}){
  this.repo.run('UPDATE studio_assistant_generations SET status=?,branch_project_id=COALESCE(?,branch_project_id),branch_version=COALESCE(?,branch_version),branch_document_hash=COALESCE(?,branch_document_hash),speech_job_id=COALESCE(?,speech_job_id),exports=COALESCE(?,exports),version=version+1,updated_at=? WHERE id=?',status,values.branchId||null,values.branchVersion||null,values.branchHash||null,values.speechJobId||null,values.exports||null,assistantNow(),row.id);
 }
 advance(generationId:string,checkedSourceHash?:string){
  const row=this.repo.get<AssistantGenerationRow>('SELECT * FROM studio_assistant_generations WHERE id=?',generationId);if(!row||!['queued','speech','video'].includes(row.status))return;
  const session=this.repo.get<AssistantSessionRow>('SELECT * FROM studio_assistant_sessions WHERE id=? AND environment=? AND app_env=?',row.session_id,this.config.providerMode,this.config.appEnv);if(!session)throw new AppError('ASSISTANT_ENVIRONMENT','生成任务不在当前运行环境。',409);const p=this.actor(session,row.actor_id),project=this.current(p,session),plan=assistantStoredPlan(row),turn=this.turn(p,row.turn_id),proposal=this.proposal(session,turn);
  if(session.current_generation_id!==row.id||session.current_turn_id!==turn.id)throw new AppError('ASSISTANT_GENERATION_SUPERSEDED','当前候选或生成已切换，旧结果不能继续提交。',409);
  if(this.configuration(p,session,plan.settings).hash!==plan.configurationHash)throw new AppError('ASSISTANT_CONFIGURATION_CHANGED','配音语气或词典版本已变化，请重新预检。',409);
  if(row.status==='queued'){
   if(checkedSourceHash!==session.source_hash)throw new AppError('ASSISTANT_SOURCE_CHECK_REQUIRED','建立暂存工程前需要实际源文件检查。',409);
   const doc=prepareAssistantMedia(this.base(session),this.selected(session),proposal,!!plan.settings.speech,this.videoAudioIds(p,session),plan.settings.replaceOriginalVideoAudio),branchId=this.studio.create(p,{workspaceId:session.workspace_id,name:(project.name+' · 局部候选 '+turn.number+'-'+row.number).slice(0,100),purpose:project.purpose,document:doc,variables:{}}),branch=this.studio.project(p,branchId);
   if(plan.settings.speech){const speechJobId=this.speech.create(p,branchId,{projectVersion:branch.version,...plan.settings.speech,segments:this.selected(session).map(segmentId=>({segmentId,annotations:[]})),confirmed:true});this.transition(row,'speech',{branchId,branchVersion:branch.version,branchHash:assistantHash(JSON.parse(branch.document)),speechJobId});}
   else this.transition(row,'video',{branchId,branchVersion:branch.version,branchHash:assistantHash(JSON.parse(branch.document))});
   return;
  }
  let branch=this.branch(p,row);
  if(row.status==='speech'){
   const speech=this.speech.row(p,row.speech_job_id!,true);this.speech.current(p,speech);
   if(['failed','cancelled'].includes(speech.status))throw new AppError('ASSISTANT_SPEECH_FAILED',speech.error_message||'所选系统配音未完成，请核对原子任务后重新预检。',409);
   if(speech.status!=='succeeded')return;
   if(speech.applied_project_version)throw new AppError('ASSISTANT_SPEECH_APPLIED_EXTERNALLY','暂存配音已被另一操作应用，请重新生成当前候选。',409);
   this.speech.apply(p,speech,{version:speech.version,projectVersion:branch.version,confirmed:true,rightsConfirmed:true,replaceExistingVoice:true,trimLongAudio:plan.settings.trimLongAudio},{replacementSegmentIds:this.selected(session)});branch=this.studio.project(p,branch.id);
   this.transition(row,plan.settings.renderVideo?'video':'ready',{branchVersion:branch.version,branchHash:assistantHash(JSON.parse(branch.document))});return;
  }
  const children=this.children(row);
  for(const child of children){const output=this.exports.row(p,child.exportId);if(!this.exports.current(p,output))throw new AppError('ASSISTANT_PREVIEW_CHANGED','所选视频预览的固定来源已变化。',409);if(['failed','cancelled'].includes(output.status))throw new AppError('ASSISTANT_PREVIEW_FAILED',output.error_message||'所选视频预览未完成。',409);if(output.status!=='succeeded')return;}
  if(!plan.settings.renderVideo||children.length===plan.ranges.length){this.transition(row,'ready');return;}
  const range=plan.ranges[children.length],input={version:branch.version,kind:'video' as const,settings:plan.settings.videoSettings,startMs:range.startMs,durationMs:range.durationMs},preview=this.exports.plan(p,branch,input);
  if(!preview.canExport)throw new AppError('ASSISTANT_PREVIEW_UNAVAILABLE',preview.warnings.join('；'),409);
  // Capacity is backpressure. The same generation waits instead of creating another branch or losing completed children.
  if(this.repo.get<{n:number}>("SELECT count(*) n FROM studio_exports WHERE tenant_id=? AND environment=? AND app_env=? AND status IN ('queued','rendering')",p.tenantId,this.config.providerMode,this.config.appEnv)!.n>=3)return;
  const exportId=this.exports.create(p,branch,{...input,planHash:preview.hash});children.push({segmentId:range.segmentId,startMs:range.startMs,durationMs:range.durationMs,exportId});this.transition(row,'video',{exports:JSON.stringify(children)});
 }
 apply(p:Principal,row:AssistantSessionRow,input:z.infer<typeof assistantApply>,checkedGenerationHash:string|null){
  this.assertNotInterpreting(row);const project=this.current(p,row);this.version(row,input.version);if(this.busy(row))throw new AppError('ASSISTANT_GENERATION_ACTIVE','局部生成尚未结束，请等待或取消后再确认写回。',409);if(row.current_turn_id!==input.turnId)throw new AppError('ASSISTANT_TURN_CHANGED','只能写回当前轮次的固定候选，请重新核对。',409);const turn=this.turn(p,input.turnId),proposal=this.proposal(row,turn);if(input.turnHash!==turn.proposal_hash)throw new AppError('ASSISTANT_PROPOSAL_CHANGED','候选摘要与已审阅内容不同。',409);
  let generation:AssistantGenerationRow|null=null,regenerateSpeech=false;const assets:string[]=[];
  if(input.generationId){generation=this.generation(p,input.generationId,true);if(row.current_generation_id!==generation.id||generation.turn_id!==turn.id||generation.session_id!==row.id)throw new AppError('ASSISTANT_GENERATION_SUPERSEDED','只能采用当前候选最新生成的结果。',409);this.version(generation,input.generationVersion||0);const reason=this.generationReason(p,row,generation);if(reason||generation.status!=='ready')throw new AppError('ASSISTANT_GENERATION_NOT_READY',reason||'此局部结果尚未完成。',409);const expected=assistantHash({generationId:generation.id,version:generation.version,planHash:generation.plan_hash,branchVersion:generation.branch_version,branchHash:generation.branch_document_hash});if(expected!==checkedGenerationHash)throw new AppError('ASSISTANT_OUTPUT_CHANGED','听审后局部结果、文件或暂存工程已变化，请重新核对。',409);regenerateSpeech=!!assistantStoredPlan(generation).settings.speech;}
  else{if(input.generationVersion!==null)throw new AppError('ASSISTANT_GENERATION_VERSION','未采用生成结果时不能指定其版本。',409);if(Object.keys(proposal.voiceIntent).length)throw new AppError('ASSISTANT_SPEECH_REQUIRED','此候选包含语速等声音控制，必须实际重新配音并采用结果后写回。',409);}
  const base=this.base(row),selected=this.selected(row),candidate=prepareAssistantMedia(base,selected,proposal,regenerateSpeech,this.videoAudioIds(p,row),generation?assistantStoredPlan(generation).settings.replaceOriginalVideoAudio:true);
  if(generation&&regenerateSpeech){const branch=this.branch(p,generation),doc=JSON.parse(branch.document) as StudioDocument,speech=this.speech.row(p,generation.speech_job_id!,true),outputs=JSON.parse(speech.outputs) as SpeechOutput[];this.speech.current(p,speech);if(speech.status!=='succeeded'||outputs.length!==selected.length||outputs.some(o=>!o.assetId||!selected.includes(o.segmentId)))throw new AppError('ASSISTANT_SPEECH_INCOMPLETE','生成的实际系统声音与固定分镜不一致。',409);
   const assetIds=new Set(outputs.map(o=>o.assetId!)),tracks=doc.timeline!.tracks.filter(t=>t.type==='voice'&&t.clips.some(c=>c.source.type==='asset'&&assetIds.has(c.source.assetId)));
   if(tracks.length!==1||tracks[0].clips.length!==selected.length||tracks[0].clips.some(c=>c.source.type!=='asset'||!assetIds.has(c.source.assetId)||!c.segmentId||!selected.includes(c.segmentId)))throw new AppError('ASSISTANT_VOICE_SCOPE','暂存声音轨包含未生成或未选分镜，不能写回。',409);
   for(const output of outputs){this.speech.file(p,speech,output.segmentId);this.repo.asset(p,output.assetId!);assets.push(output.assetId!);}
   candidate.timeline!.tracks.push(structuredClone(tracks[0]));
  }
  this.unchanged(base,candidate,selected);if(assistantHash(candidate)===row.base_document_hash)throw new AppError('ASSISTANT_NO_CHANGES','当前候选没有需要写回的文字或新配音。',409);
  this.studio.save(p,project,project.version,project.name,candidate);const saved=this.studio.project(p,project.id),afterHash=assistantHash(JSON.parse(saved.document)),now=assistantNow();this.repo.run('UPDATE studio_assistant_sessions SET status=\'applied\',applied_project_version=?,applied_document_hash=?,version=version+1,updated_at=? WHERE id=?',saved.version,afterHash,now,row.id);if(generation)this.transition(generation,'applied');
  this.repo.run('INSERT INTO studio_assistant_applications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',row.id,turn.id,generation?.id||null,project.id,project.version,saved.version,row.base_document_hash,afterHash,JSON.stringify(proposal.patches.filter(p=>p.beforeText!==p.afterText).map(p=>p.segmentId)),JSON.stringify(regenerateSpeech?selected:[]),JSON.stringify(assets),p.userId,now);this.repo.event(row.tenant_id,row.workspace_id,row.id,'studio.assistant_applied',this.config.providerMode);return row.id;
 }
 close(p:Principal,row:AssistantSessionRow,version:number){this.scope(p,row.workspace_id,true);this.version(row,version);if(row.status!=='open')throw new AppError('ASSISTANT_SESSION_CLOSED','此对话已经写回或关闭。',409);const busy=this.busy(row);if(busy)this.cancelGeneration(p,busy,busy.version);this.repo.run("UPDATE studio_assistant_interpretations SET status='cancelled',version=version+1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE session_id=? AND status IN ('queued','processing')",assistantNow(),row.id);this.repo.run("UPDATE studio_assistant_sessions SET status='closed',version=version+1,updated_at=? WHERE id=?",assistantNow(),row.id);return row.id;}
 generationPage(p:Principal,row:AssistantSessionRow,input:{cursor?:string;limit:number}){
  let before=Number.MAX_SAFE_INTEGER;if(input.cursor){const prior=this.repo.get<{n:number}>('SELECT rowid n FROM studio_assistant_generations WHERE id=? AND session_id=?',input.cursor,row.id);if(!prior)throw new AppError('NOT_FOUND','局部生成历史游标不属于此对话。',404);before=prior.n;}
  const rows=this.repo.all<AssistantGenerationRow>('SELECT * FROM studio_assistant_generations WHERE session_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?',row.id,before,input.limit+1);return{items:rows.slice(0,input.limit).map(g=>this.generationView(p,row,g)),nextCursor:rows.length>input.limit?rows[input.limit-1].id:null};
 }
 view(p:Principal,row:AssistantSessionRow):AssistantSession{
  const sourceReason=this.sourceReason(p,row),project=this.studio.project(p,row.project_id),base=this.base(row),page=this.generationPage(p,row,{limit:6});return{id:row.id,workspaceId:row.workspace_id,projectId:row.project_id,projectName:project.name,projectVersion:row.project_version,name:row.name,version:row.version,status:row.status,currentTurnId:row.current_turn_id,currentGenerationId:row.current_generation_id,selected:assistantRanges(base,this.selected(row)).map(range=>({...range,originalText:sourceReason?null:base.segments.find(s=>s.id===range.segmentId)!.text})),sourceAvailable:!sourceReason,sourceReason,staleReason:this.staleReason(p,row),canWrite:hasPermission(p,'studio.write'),appliedProjectVersion:row.applied_project_version,turns:this.repo.all<AssistantTurnRow>('SELECT * FROM studio_assistant_turns WHERE session_id=? ORDER BY number',row.id).map(t=>this.turnView(row,t,!sourceReason)),generations:page.items,generationNextCursor:page.nextCursor,createdAt:row.created_at};
 }
 summary(p:Principal,row:AssistantSessionRow):AssistantSessionSummary{const project=this.studio.project(p,row.project_id);return{id:row.id,workspaceId:row.workspace_id,projectId:row.project_id,projectName:project.name,projectVersion:row.project_version,name:row.name,version:row.version,status:row.status,currentTurnId:row.current_turn_id,currentGenerationId:row.current_generation_id,selectedSegments:this.selected(row).length,createdAt:row.created_at,updatedAt:row.updated_at};}
}
