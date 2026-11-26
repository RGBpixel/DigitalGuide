import {AppError,canonical,requirePermission,type Principal} from '../../domain/src/index.js';
import {liveAnswerEngine,liveAnswerRequest,liveAnswerNativeResult,type LiveAnswerSource,type LiveAnswerNativeResult} from '../../contracts/src/index.js';
import {liveAnswerHash,splitLiveAnswerText} from '../../domain/src/live-answers.js';
import {liveAnswerInput,liveProductText,type LiveAnswerConfigurationRow,type LiveAnswerJobRow} from '../../domain/src/live-answer-origin.js';
import {nativeBusinessInteger as integer} from './runtime-repository.js';
import type {NativeLive} from './runtime-live.js';
import type {NativeLiveSessionRow,NativeLiveEventRow} from './runtime-live-shapes.js';

export interface NativeLiveAnswerConfigurationRow extends LiveAnswerConfigurationRow{invalidated_at:string|null;invalidation_reason:string|null}
export interface NativeLiveAnswerJobRow extends LiveAnswerJobRow{invalidated_at:string|null;invalidation_reason:string|null}
export const nativeLiveAnswerConfigurationRow=(r:NativeLiveAnswerConfigurationRow)=>({...r,version:integer(r.version),generation:integer(r.generation),enabled:integer(r.enabled),auto_draft:integer(r.auto_draft)});
export const nativeLiveAnswerJobRow=(r:NativeLiveAnswerJobRow)=>({...r,version:integer(r.version),control_version:integer(r.control_version),controller_version:integer(r.controller_version),question_version:integer(r.question_version),configuration_generation:integer(r.configuration_generation),attempts:integer(r.attempts),progress:Number(r.progress)});

export class NativeLiveAnswerSources{
 constructor(readonly live:NativeLive){}
 get db(){return this.live.db;}
 async configuration(sessionId:string){const row=(await this.db.query<NativeLiveAnswerConfigurationRow>('SELECT * FROM live_answer_configurations WHERE session_id=$1',[sessionId])).rows[0];return row?nativeLiveAnswerConfigurationRow(row):null;}
 async row(p:Principal,id:string,write=false){const row=(await this.db.query<NativeLiveAnswerJobRow>("SELECT * FROM live_answer_jobs WHERE id=$1 AND tenant_id=$2 AND environment='mock' AND app_env=$3",[id,p.tenantId,this.db.config.appEnv])).rows[0];if(!row)throw new AppError('NOT_FOUND','直播模型答复不存在或不在当前环境。',404);await this.live.session(p,row.session_id,write);if(write)requirePermission(p,'live.moderate');return nativeLiveAnswerJobRow(row);}
 async actor(p:Principal,row:{actor_id:string;tenant_id:string;workspace_id:string}){const actor=await this.live.core.principal(row.actor_id);if(actor.tenantId!==p.tenantId||actor.tenantId!==row.tenant_id)throw new AppError('LIVE_ANSWER_ACTOR_CHANGED','原模型准备人的组织已经变化。',409);await this.live.scope(actor,row.workspace_id,false,'live.moderate');return actor;}
 async publicSources(p:Principal,session:NativeLiveSessionRow):Promise<LiveAnswerSource[]>{
  const snapshot=await this.live.current(p,session),sources:LiveAnswerSource[]=[];let index=0,characters=0;
  const add=(parts:LiveAnswerSource[])=>{characters+=parts.reduce((n,s)=>n+s.text.length,0);if(sources.length+parts.length>512||characters>180000)throw new AppError('LIVE_ANSWER_SOURCE_LIMIT','完整公开资料超过512块或十八万字符，请拆分知识库或场次；不会截断正文。',409);sources.push(...parts);};
  for(const collectionId of snapshot.scene?.app.collectionIds??[]){const collection=await this.live.scenes.knowledge.collection(p,collectionId);if(collection.workspace_id!==session.workspace_id||collection.audience!=='public'||!JSON.parse(collection.scenes).includes('live'))throw new AppError('LIVE_ANSWER_PUBLIC_ONLY','本机直播模型只能读取本场绑定的公开直播知识。',409);
   const versions=(await this.db.query<{document_id:string;id:string;ordinal:string;title:string;content:string;content_hash:string;source_label:string;source_url:string|null}>("SELECT d.id AS document_id,v.* FROM knowledge_documents d JOIN knowledge_versions v ON v.id=d.published_version_id AND v.document_id=d.id WHERE d.collection_id=$1 AND d.tenant_id=$2 AND d.workspace_id=$3 AND v.status='published' ORDER BY d.id",[collectionId,p.tenantId,session.workspace_id])).rows;
   for(const v of versions){const n=index++;add(splitLiveAnswerText(v.content).map((text,part)=>({id:'s'+n+'c'+part,kind:'knowledge',title:v.title,sourceLabel:v.source_label,sourceUrl:v.source_url,text,part,collectionId,documentId:v.document_id,versionId:v.id,version:integer(v.ordinal),contentHash:v.content_hash})));}
  }
  for(const product of snapshot.definition.products){if(product.expiresAt<=await this.db.now())continue;const n=index++;add(splitLiveAnswerText(liveProductText(product)).map((text,part)=>({id:'s'+n+'c'+part,kind:'product',title:product.name,sourceLabel:product.sourceLabel,sourceUrl:product.sourceUrl,text,part,productId:product.id,expiresAt:product.expiresAt,productHash:liveAnswerHash(product)})));}
  if(!sources.length)throw new AppError('LIVE_ANSWER_PUBLIC_SOURCES_REQUIRED','本场没有已发布的公开知识或未到期商品资料，请补充后再启用，或直接人工答复。',409);return sources;
 }
 async input(row:NativeLiveAnswerJobRow){
  const ledger=(await this.db.query<{snapshot:string;input_hash:string}>('SELECT snapshot,input_hash FROM _dg_native_live_answer_inputs WHERE job_id=$1',[row.id])).rows[0];
  if(row.invalidated_at||row.withdrawn_at||!ledger||ledger.input_hash!==row.input_hash||liveAnswerHash(JSON.parse(ledger.snapshot))!==row.input_hash||canonical(JSON.parse(ledger.snapshot))!==canonical(liveAnswerInput(row)))throw new AppError('LIVE_ANSWER_UNAVAILABLE',row.invalidation_reason??'模型答复输入、用途或不可覆盖账本已变化。',409);
  return{request:liveAnswerRequest.parse(JSON.parse(row.request)),configuration:{engine:liveAnswerEngine.parse(JSON.parse(row.configuration).engine),language:JSON.parse(row.configuration).language as 'zh-CN'|'en-US'}};
 }
 async current(p:Principal,row:NativeLiveAnswerJobRow,complete=false){const session=await this.live.session(p,row.session_id);await this.live.current(p,session);await this.actor(p,row);const fixed=await this.input(row),valid=(await this.db.query<{valid:boolean}>('SELECT dg_native_live_answer_source_valid($1) AS valid',[row.id])).rows[0].valid;if(!valid)throw new AppError('LIVE_ANSWER_SOURCE_CHANGED','固定问题、公开知识或商品资料已经变化，旧候选不能继续采用。',409);if(complete)await this.completed(row);return{session,...fixed};}
 validate(row:NativeLiveAnswerJobRow,value:unknown):LiveAnswerNativeResult{
  const fixed={request:liveAnswerRequest.parse(JSON.parse(row.request)),engine:liveAnswerEngine.parse(JSON.parse(row.configuration).engine)},native=liveAnswerNativeResult.parse(value);
  if(liveAnswerHash(fixed.request)!==native.evidence.inputSHA256||canonical(fixed.engine)!==canonical(native.evidence.engine)||!fixed.request.question.includes(native.evidence.effectiveQuestion)||native.result.supported!==!!native.result.citations.length)throw new AppError('LIVE_ANSWER_RESULT_CHANGED','实际模型、问题摘录或答复回执不符合固定输入。',409);
  if(new Set(native.evidence.retrievedSourceIds).size!==native.evidence.retrievedSourceIds.length||native.evidence.retrievedSourceIds.some(id=>!fixed.request.sources.some(s=>s.id===id)))throw new AppError('LIVE_ANSWER_CITATION','实际检索结果不属于本场固定资料。',409);
  for(const c of native.result.citations){const source=fixed.request.sources.find(s=>s.id===c.sourceId);if(!source||source.kind!==c.kind||source.title!==c.title||source.sourceLabel!==c.sourceLabel||source.sourceUrl!==c.sourceUrl||!c.quote.trim()||!source.text.includes(c.quote)||!native.evidence.retrievedSourceIds.includes(c.sourceId))throw new AppError('LIVE_ANSWER_CITATION','模型引用未通过固定来源验证。',409);}return native;
 }
 async completed(row:NativeLiveAnswerJobRow){const receipt=(await this.db.query<{result:string;evidence:string;result_hash:string}>('SELECT result,evidence,result_hash FROM _dg_native_live_answer_outputs WHERE job_id=$1',[row.id])).rows[0];if(row.status!=='succeeded'||!receipt||receipt.result!==row.result||receipt.evidence!==row.evidence||receipt.result_hash!==row.result_hash||liveAnswerHash(JSON.parse(receipt.result))!==row.result_hash)throw new AppError('LIVE_ANSWER_RESULT_CHANGED','模型结果与不可覆盖回执不一致。',409);return this.validate(row,{result:JSON.parse(receipt.result),evidence:JSON.parse(receipt.evidence)});}
 async question(q:NativeLiveEventRow){if(q.answer_kind==='local_model'&&!(await this.db.query<{valid:boolean}>('SELECT dg_native_live_model_answer_valid($1) AS valid',[q.id])).rows[0].valid)throw new AppError('LIVE_ANSWER_ORIGIN','模型答复的主持确认、公开来源或用途已变化。',409);}
}
