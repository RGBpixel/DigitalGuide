import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError,requirePermission} from '@digitalguide/domain';
import {shelfListInput,shelfSourcesInput,shelfCreateInput,shelfUpdateInput,shelfControlInput,shelfSelectInput} from '../../../packages/contracts/src/resource-shelf.js';
import {authenticatedSession} from './auth-check.js';
import {executeIdempotent} from './idempotency.js';
import {ResourceShelf} from './resource-shelf-service.js';
import type {Config} from './config.js';
export function registerResourceShelfRoutes(app:FastifyInstance,repo:Repository,config:Config,send:(req:FastifyRequest,reply:FastifyReply,data:unknown)=>unknown){
 const service=new ResourceShelf(repo,config),id=(req:FastifyRequest)=>z.uuid().parse((req.params as {id:string}).id),principal=(req:FastifyRequest)=>authenticatedSession(repo,req,config).principal;
 app.get('/api/v1/resource-shelf',(req,reply)=>send(req,reply,repo.transaction(()=>service.list(principal(req),shelfListInput.parse(req.query)))));
 app.get('/api/v1/resource-shelf/sources',(req,reply)=>send(req,reply,repo.transaction(()=>service.candidates(principal(req),shelfSourcesInput.parse(req.query)))));
 app.get('/api/v1/resource-shelf/selections/:id',(req,reply)=>send(req,reply,repo.transaction(()=>service.selection(principal(req),id(req)))));
 app.get('/api/v1/resource-shelf/:id',(req,reply)=>send(req,reply,repo.transaction(()=>{const p=principal(req);return service.view(p,service.row(p,id(req)));})));
 app.get('/api/v1/resource-shelf/:id/events',(req,reply)=>send(req,reply,repo.transaction(()=>service.history(principal(req),id(req)))));
 for(const action of ['create','update','control','select'] as const)app.post('/api/v1/resource-shelf'+(action==='create'?'':'/:id/'+action),(req,reply)=>{
  const session=authenticatedSession(repo,req,config),p=session.principal;if(req.headers['x-csrf-token']!==session.csrfToken)throw new AppError('FORBIDDEN','安全凭证已失效，请刷新后重试。',403);
  requirePermission(p,action==='select'?'studio.write':'operations.manage');const input=action==='create'?shelfCreateInput.parse(req.body):action==='update'?shelfUpdateInput.parse(req.body):action==='control'?shelfControlInput.parse(req.body):shelfSelectInput.parse(req.body);
  if(action==='create')service.scope(p,shelfCreateInput.parse(input).workspaceId,true);else service.row(p,id(req),action!=='select');
  const result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>action==='create'?service.create(p,shelfCreateInput.parse(input),req.id):action==='update'?service.update(p,id(req),shelfUpdateInput.parse(input),req.id):action==='control'?service.control(p,id(req),shelfControlInput.parse(input),req.id):service.select(p,id(req),shelfSelectInput.parse(input).version,req.id));
  return send(req,reply,repo.transaction(()=>action==='select'?service.selection(principal(req),result.data):service.view(principal(req),service.row(principal(req),result.data))));
 });
}
