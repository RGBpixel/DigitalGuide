import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError,type Principal} from '@digitalguide/domain';
import {liveOutputPlanInput,liveOutputCreate,liveOutputPresentationInput,liveOutputControl,liveOutputObservation,liveOutputSchema,liveOutputContextSchema} from '@digitalguide/contracts';
import {fileDigest} from '../../../packages/media/src/files.js';
import {LiveService} from './live-service.js';
import {LiveOutputs} from './live-output-service.js';
import {outputAttachment} from './live-output-state.js';
import {authenticatedSession} from './auth-check.js';
import {executeIdempotent} from './idempotency.js';
import {privateFile} from './private-file.js';
import type {Config} from './config.js';
export function registerLiveOutputRoutes(app:FastifyInstance,repo:Repository,config:Config){
 const live=new LiveService(repo,config),outputs=new LiveOutputs(live),id=z.uuid(),key=(req:FastifyRequest)=>id.parse((req.params as {id:string}).id),fresh=(req:FastifyRequest,write=false)=>{const s=authenticatedSession(repo,req,config);if(write&&s.csrfToken!==req.headers['x-csrf-token'])throw new AppError('FORBIDDEN','安全凭证已更新，请重新登录。',403);return s.principal;},send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.header('Cache-Control','private, no-store').send({data,requestId:req.id}),view=(p:Principal,id:string)=>liveOutputSchema.parse(outputs.view(p,outputs.row(p,id)));
 function write(req:FastifyRequest,reply:FastifyReply,work:(p:Principal)=>string){const p=fresh(req,true);const result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>{const p=fresh(req,true),id=work(p),r=outputs.row(p,id);repo.audit(p,r.workspace_id,'live.output.'+req.routeOptions.url,id,req.id);return{id};});const current=fresh(req,true);live.scope(current,outputs.row(current,result.data.id).workspace_id,'live.start');return send(req,reply,view(current,result.data.id));}
 app.post('/api/v1/live-outputs/preflight',async(req,reply)=>{const input=liveOutputPlanInput.parse(req.body),plan=outputs.plan(fresh(req,true),input);if(plan.canCreate){await outputs.checked(fresh(req,true),input);return send(req,reply,outputs.plan(fresh(req,true),input));}return send(req,reply,plan);});
 app.post('/api/v1/live-outputs',async(req,reply)=>{const input=liveOutputCreate.parse(req.body),p=fresh(req,true);live.scope(p,live.session(p,input.sessionId).workspace_id,'live.start');const old=repo.get('SELECT key FROM idempotency WHERE tenant_id=? AND actor_id=? AND action=? AND key=?',p.tenantId,p.userId,'POST /api/v1/live-outputs',z.string().min(8).max(128).parse(req.headers['idempotency-key']));if(old)return write(req,reply,()=>{throw new AppError('LIVE_OUTPUT_REPLAY','旧媒体创建记录无法恢复，请重新载入。',409);});const checked=await outputs.checked(p,input);return write(req,reply,p=>outputs.create(p,input,checked));});
 app.get('/api/v1/live-sessions/:id/output',(req,reply)=>{const p=fresh(req),s=live.session(p,key(req)),r=outputAttachment(repo,s.id);return send(req,reply,r?view(p,r.id):null);});
 app.get('/api/v1/live-outputs/:id',(req,reply)=>send(req,reply,view(fresh(req),key(req))));
 app.post('/api/v1/live-outputs/:id/presentation',(req,reply)=>{const input=liveOutputPresentationInput.parse(req.body);live.scope(fresh(req,true),outputs.row(fresh(req,true),key(req)).workspace_id,'live.start');return write(req,reply,p=>outputs.present(p,outputs.row(p,key(req)),input));});
 app.post('/api/v1/live-outputs/:id/control',(req,reply)=>{const input=liveOutputControl.parse(req.body);live.scope(fresh(req,true),outputs.row(fresh(req,true),key(req)).workspace_id,'live.start');return write(req,reply,p=>outputs.control(p,outputs.row(p,key(req)),input));});
 app.get('/api/v1/live-outputs/:id/context',(req,reply)=>{const p=fresh(req);return send(req,reply,liveOutputContextSchema.parse(outputs.context(p,outputs.row(p,key(req)))));});
 app.get('/api/v1/live-outputs/:id/parts/:partId',async(req,reply)=>{const resolve=()=>{const p=fresh(req);return outputs.part(p,outputs.row(p,key(req)),id.parse((req.params as {partId:string}).partId));},initial=resolve(),bytes=await fileDigest(initial.file);if(bytes.sha256!==initial.sha256||bytes.size!==initial.size)throw new AppError('LIVE_OUTPUT_PART_BYTES','实际媒体片段与发布摘要不符。',409);const current=resolve();if(current.sha256!==initial.sha256||current.file!==initial.file||current.size!==initial.size)throw new AppError('LIVE_OUTPUT_PART_CHANGED','文件检查期间媒体来源已经变化。',409);return privateFile(req,reply,current.file,current.kind==='init'?'video/mp4':'video/iso.segment');});
 app.post('/api/v1/live-outputs/:id/observations',(req,reply)=>{const input=liveOutputObservation.parse(req.body),p=fresh(req,true);return send(req,reply,repo.transaction(()=>outputs.observe(p,outputs.row(p,key(req)),input)));});
}
