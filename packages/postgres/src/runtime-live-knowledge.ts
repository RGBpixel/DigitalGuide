import {canonical,type Principal,AppError} from '../../domain/src/index.js';
import {selectLanguageProvider} from '../../providers/src/index.js';
import {citationSchema,type KnowledgeCitation} from '../../contracts/src/index.js';
import {NativeKnowledge,nativeKnowledgeTextHash} from './runtime-knowledge.js';
import {NativeScenes} from './runtime-scenes.js';
import {nativeLiveDigest as digest,type NativeLiveEventRow,type NativeLiveSessionRow, nativeLiveSnapshot} from './runtime-live-shapes.js';
import type {NativeCoreRepository} from './runtime-repository.js';

export class NativeLiveKnowledge {
 readonly scenes:NativeScenes;readonly knowledge:NativeKnowledge;
 constructor(public readonly core:NativeCoreRepository){this.scenes=new NativeScenes(core);this.knowledge=this.scenes.knowledge;}
 get db(){return this.core.db;}
 async current(q:Pick<NativeLiveEventRow,'id'|'answer_kind'>){if(!['knowledge','local_model'].includes(q.answer_kind??''))return;const fn=q.answer_kind==='local_model'?'dg_native_live_model_answer_valid':'dg_native_live_knowledge_answer_valid';if(!(await this.db.query<{valid:boolean}>('SELECT '+fn+'($1) AS valid',[q.id])).rows[0].valid)throw new AppError(q.answer_kind==='local_model'?'LIVE_ANSWER_ORIGIN':'LIVE_KNOWLEDGE_SOURCE_CHANGED',q.answer_kind==='local_model'?'模型答复的公开来源、主持确认或用途已变化，请重新核对。':'原公开知识版本、场景或范围已变化，旧回复不再采用，请重新提交提问。',409);}
 async used(r:NativeLiveSessionRow){const rows=(await this.db.query<{id:string;answer_kind:NativeLiveEventRow['answer_kind']}>("SELECT q.id,q.answer_kind FROM live_audience_events q WHERE q.session_id=$1 AND q.answer_kind IN('knowledge','local_model') AND(q.id=$2 OR EXISTS(SELECT 1 FROM live_segments s WHERE s.session_id=q.session_id AND s.segment::jsonb->>'answerId'=q.id))",[r.id,JSON.parse(r.state).answerId])).rows;for(const row of rows)await this.current(row);}
 citations(q:NativeLiveEventRow):Omit<KnowledgeCitation,'score'>[]{return q.answer_kind==='local_model'?citationSchema.omit({score:true}).array().max(8).parse(JSON.parse(q.citations)):citationSchema.array().max(5).parse(JSON.parse(q.citations));}
 async prepare(p:Principal,r:NativeLiveSessionRow,q:NativeLiveEventRow,epoch:number){const snapshot=nativeLiveSnapshot.parse(JSON.parse(r.snapshot)),scene=snapshot.scene;if(!scene)throw new AppError('LIVE_KNOWLEDGE_REQUIRED','请先为节目绑定本空间公开直播场景，再准备知识回复。',409);await this.scenes.publicLive(p,r.workspace_id,scene.app.id,scene,r.id);const found=await this.knowledge.search(p,{workspaceId:r.workspace_id,collectionIds:scene.app.collectionIds,scene:'live',query:q.text,publicOnly:true}),response=selectLanguageProvider(scene.app.llmProvider,'mock',this.db.config.appEnv).respond({question:q.text,citations:found.citations,tools:scene.app.tools,hostNames:[]}),answer=response.text.slice(0,1500),citations=canonical(found.citations),guard=canonical({schemaVersion:1,pipeline:'native-live-knowledge-answer-v1',sessionId:r.id,sceneId:scene.app.id,sceneVersion:scene.app.version,preparedEpoch:epoch,sources:found.guards});
  await this.db.query('INSERT INTO _dg_native_live_knowledge_answers VALUES($1,$2,$3,$4,$5,$6,$7,dg_utc_now())',[q.id,r.id,nativeKnowledgeTextHash(answer),citations,nativeKnowledgeTextHash(citations),guard,digest(JSON.parse(guard))]);return{answer,citations};
 }
}
