import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError,type Principal} from '@digitalguide/domain';
import {liveAnswerConfigure,liveAnswerCreate,liveAnswerControl,liveAnswerAdopt} from '@digitalguide/contracts';
import {LiveAnswers} from './live-answers-service.js';
import {authenticatedSession} from './auth-check.js';
import {executeIdempotent} from './idempotency.js';
import type {Config} from './config.js';
export function registerLiveAnswerRoutes(app:FastifyInstance,repo:Repository,config:Config){const service=new LiveAnswers(repo,config),id=z.uuid(),key=(req:FastifyRequest)=>id.parse((req.params as {id:string}).id),fresh=(req:FastifyRequest,write=false)=>{const s=authenticatedSession(repo,req,config);if(write&&s.csrfToken!==req.headers['x-csrf-token'])throw new AppError('FORBIDDEN','安全凭证已变化，请重新登录。',403);return s.principal;},send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.header('Cache-Control','private, no-store').send({data,requestId:req.id});
 function write(req:FastifyRequest,reply:FastifyReply,guard:(p:Principal)=>unknown,work:(p:Principal)=>{id:string;workspaceId:string},view:(p:Principal,id:string)=>unknown){guard(fresh(req,true));const p=fresh(req,true),result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>{const current=fresh(req,true);guard(current);const r=work(current);repo.audit(current,r.workspaceId,'live.model_answer.'+req.routeOptions.url,r.id,req.id);return{id:r.id};});return send(req,reply,repo.transaction(()=>{const current=fresh(req,true);guard(current);return view(current,result.data.id);}));}
 const jobView=(p:Principal,id:string)=>service.view(p,service.row(p,id)),sessionGuard=(req:FastifyRequest)=>(p:Principal)=>service.scope(p,key(req),true);
 app.get('/api/v1/live-answers/capabilities',async(req,reply)=>{const q=z.strictObject({workspaceId:id}).parse(req.query);service.live.scope(fresh(req),q.workspaceId);const cap=await service.capabilities();service.live.scope(fresh(req),q.workspaceId);return send(req,reply,cap);});
 app.get('/api/v1/live-sessions/:id/model-answers',(req,reply)=>send(req,reply,repo.transaction(()=>service.sessionView(fresh(req),key(req)))));
 app.post('/api/v1/live-sessions/:id/model-answers/configuration',async(req,reply)=>{const input=liveAnswerConfigure.parse(req.body),p=fresh(req,true),session=service.scope(p,key(req),true),engine=await service.prepareConfiguration(p,session,input);return write(req,reply,sessionGuard(req),p=>{const session=service.scope(p,key(req),true);return{id:service.configure(p,session,input,engine),workspaceId:session.workspace_id};},(p,id)=>service.sessionView(p,id));});
 app.post('/api/v1/audience-questions/:id/model-answers',(req,reply)=>{const input=liveAnswerCreate.parse(req.body);return write(req,reply,p=>{const q=service.live.question(p,key(req));service.scope(p,q.session_id,true);},p=>{const q=service.live.question(p,key(req)),session=service.scope(p,q.session_id,true);return{id:service.enqueue(p,q,input),workspaceId:session.workspace_id};},jobView);});
 app.get('/api/v1/live-answer-jobs/:id',(req,reply)=>send(req,reply,repo.transaction(()=>jobView(fresh(req),key(req)))));
 app.post('/api/v1/live-answer-jobs/:id/control',(req,reply)=>{const input=liveAnswerControl.parse(req.body);return write(req,reply,p=>service.row(p,key(req),true),p=>{const row=service.row(p,key(req),true);return{id:service.control(p,row,input),workspaceId:row.workspace_id};},jobView);});
 app.post('/api/v1/live-answer-jobs/:id/adopt',(req,reply)=>{const input=liveAnswerAdopt.parse(req.body);return write(req,reply,p=>{const row=service.row(p,key(req),true);service.readContext(p,row,true);},p=>{const row=service.row(p,key(req),true);return{id:service.adopt(p,row,input),workspaceId:row.workspace_id};},jobView);});
}
