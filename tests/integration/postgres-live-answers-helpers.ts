import {randomUUID} from 'node:crypto';
import {expect} from 'vitest';
import type {z} from 'zod';
import type {LiveSession,LiveQuestion,liveAnswerCapabilities,LiveAnswerJob,LiveAnswerSession,LiveAnswerNativeResult,LiveDefinition} from '@digitalguide/contracts';
import type {LiveAnswerRunInput} from '../../packages/providers/src/live-answer-native.js';
import {liveAnswerHash} from '../../packages/domain/src/live-answers.js';
import {NativeLiveAnswerWorker} from '../../packages/postgres/src/runtime-live-answer-worker.js';
import {nativeLiveSpeechHelpers} from './postgres-live-speech-helpers.js';
import type {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
type LiveAnswerCapabilities=z.infer<typeof liveAnswerCapabilities>;

// Explicit synthetic result executor: validates state/ACL contracts, never evidence of actual Qwen inference.
export async function nativeLiveAnswerContract(input:LiveAnswerRunInput,signal:AbortSignal,onProgress:(n:number)=>void):Promise<LiveAnswerNativeResult>{
 signal.throwIfAborted();const s=input.request.sources[0];onProgress(1);return{result:{supported:true,answer:s.text,citations:[{sourceId:s.id,kind:s.kind,title:s.title,sourceLabel:s.sourceLabel,sourceUrl:s.sourceUrl,quote:s.text}]},evidence:{engine:input.engine,inputSHA256:liveAnswerHash(input.request),promptSHA256:'1'.repeat(64),rawOutputSHA256:'2'.repeat(64),promptTokens:10,effectiveQuestion:input.request.question,queryPromptSHA256:'3'.repeat(64),queryRawOutputSHA256:'4'.repeat(64),queryPromptTokens:10,elapsedMs:1,retrievedSourceIds:[s.id],retrievalInferences:1,compiledWorkerEntry:false,offlineCpu:true}};
}
export function nativeLiveAnswerHelpers(x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,person:()=>NativeTestPerson){
 const sp=nativeLiveSpeechHelpers(x,person),{a,k}=sp,models=(id:string,p=person())=>a.get<LiveAnswerSession>('/live-sessions/'+id+'/model-answers',p),job=(id:string,p=person())=>a.get<LiveAnswerJob>('/live-answer-jobs/'+id,p),worker=(engine=nativeLiveAnswerContract)=>new NativeLiveAnswerWorker(x.repo,x.config.root,engine);
 const capabilities=()=>a.get<LiveAnswerCapabilities>('/live-answers/capabilities?workspaceId='+person().workspace);
 async function ready(extra:Partial<LiveDefinition>={},text='原创公开接待说明：访客服务在周一至周五09:00—17:00开放，参观须提前预约。周三不提供现场导览。'){
  const collection=await k.collection(),doc=await k.document(collection.id,true,{title:'原创模型接待手册',content:text,sourceUrl:null}),scene=await k.scene([collection.id]),definition={...sp.definition(),products:[],destinations:[sp.definition().destinations[0]],sceneAppId:scene.app.id,...extra},r=await a.ready(definition);return{...r,collection,doc,scene,definition};
 }
 async function configure(s:LiveSession,enabled=true,autoDraft=false,who=person(),key=randomUUID()){
  const current=await a.session(s.id),cfg=(await models(s.id,who)).configuration,cap=enabled?await capabilities():null,input={version:cfg.version,sessionVersion:current.version,enabled,autoDraft,language:'zh-CN',...(cap?.engineHash?{engineHash:cap.engineHash}:{}),confirmed:true};if(enabled)expect(cap?.available,cap?.reason??'').toBe(true);return{input,key,view:await a.good<LiveAnswerSession>('/live-sessions/'+s.id+'/model-answers/configuration',input,who,key)};
 }
 async function question(s:LiveSession,text='访客服务什么时候开放？',moderate=true){const current=await a.session(s.id);let q=await a.good<LiveQuestion>('/live-sessions/'+s.id+'/audience-events',{destinationId:current.destinations[0].id,eventId:randomUUID(),participantRef:randomUUID(),nickname:'虚构模型观众',kind:'question',text,mediaOptIn:'none',synthetic:true});if(moderate)q=await a.good('/audience-questions/'+q.id+'/moderate',{version:q.version,decision:'queue',confirmed:true});return q;}
 async function enqueue(s:LiveSession,q:LiveQuestion,who=person(),key=randomUUID()){const current=await a.session(s.id),input={questionVersion:q.version,sessionVersion:current.version,confirmed:true};return{input,key,job:await a.good<LiveAnswerJob>('/audience-questions/'+q.id+'/model-answers',input,who,key)};}
 async function generate(s:LiveSession,q:LiveQuestion,engine=nativeLiveAnswerContract,who=person()){const queued=await enqueue(s,q,who);expect(await worker(engine).runOne()).toBe(true);return job(queued.job.id,who);}
 async function adopt(s:LiveSession,j:LiveAnswerJob,who=person(),key=randomUUID()){const current=await a.session(s.id),q=current.questions.find(q=>q.id===j.questionId)!,input={version:j.version,questionVersion:q.version,sessionVersion:current.version,epoch:current.epoch,confirmed:true};return{input,key,job:await a.good<LiveAnswerJob>('/live-answer-jobs/'+j.id+'/adopt',input,who,key)};}
 async function live(extra:Partial<LiveDefinition>={},text?:string){const r=await ready(extra,text);await configure(r.session);await a.start(r.session);await a.tick();return{...r,session:await a.session(r.session.id)};}
 async function cleanup(){await sp.cleanup();const leases=await x.owner(async c=>(await c.query<{job_id:string;token:string}>("SELECT job_id,token FROM native_model_leases WHERE job_kind='live-answer'")).rows);await x.owner(async c=>{await c.query("UPDATE live_answer_jobs SET status='cancelled',version=version+1,lease_token=NULL,lease_until=NULL,updated_at=dg_utc_now() WHERE tenant_id=$1 AND status IN('queued','processing')",[person().tenant]);await c.query("UPDATE live_answer_configurations SET invalidated_at=dg_utc_now(),invalidation_reason='声明的契约夹具已关闭',version=version+1,updated_at=dg_utc_now() WHERE tenant_id=$1 AND invalidated_at IS NULL",[person().tenant]);});for(const lease of leases)await x.workerDb.transaction(()=>x.workerDb.query('SELECT dg_native_live_answer_release($1,$2)',[lease.job_id,lease.token]));}
 return{sp,a,k,models,job,worker,capabilities,ready,configure,question,enqueue,generate,adopt,live,cleanup};
}
