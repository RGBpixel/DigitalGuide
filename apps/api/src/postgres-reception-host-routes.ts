import type {FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {requirePermission} from '@digitalguide/domain';
import {receptionHostCreateInput,receptionHostUpdateInput,receptionHostListInput} from '@digitalguide/contracts';
import {NativeReceptionHosts} from '../../../packages/postgres/src/runtime-reception-hosts.js';
import type {RouteContext} from './postgres-asset-routes.js';

export function registerNativeReceptionHostRoutes({app,repo,authenticated,send}:RouteContext){
 const s=new NativeReceptionHosts(repo),base='/api/v1/reception-hosts',id=(req:FastifyRequest)=>z.uuid().parse((req.params as{id:string}).id),respond=(req:FastifyRequest,reply:FastifyReply,value:unknown)=>send(req,reply.header('Cache-Control','private, no-store'),value);
 function page<T extends{id:string}>(items:T[],limit:number){return{items:items.slice(0,limit),nextCursor:items.length>limit?items[limit-1].id:null};}
 for(const kind of ['hosts','candidates'] as const)app.get(base+(kind==='hosts'?'':'/candidates'),async(req,reply)=>{const q=receptionHostListInput.parse(req.query);return respond(req,reply,await authenticated(req,async({principal:p})=>kind==='hosts'?page(await s.list(p,q.workspaceId,q.cursor??'',q.limit+1),q.limit):page(await s.candidates(p,q.workspaceId,q.cursor??'',q.limit+1),q.limit)));});
 app.get(base+'/:id',async(req,reply)=>respond(req,reply,await authenticated(req,({principal:p})=>s.view(p,id(req)))));
 for(const action of ['create','update'] as const)app.post(base+(action==='create'?'':'/:id/update'),async(req,reply)=>{
  const input=action==='create'?receptionHostCreateInput.parse(req.body):receptionHostUpdateInput.parse(req.body),target=action==='create'?null:id(req),workspace='workspaceId'in input?input.workspaceId:null;
  return respond(req,reply,await authenticated(req,async({principal:p})=>{
   requirePermission(p,'visit.manage');const w=await s.prepare(p,workspace,target,input.recipientId);
   const resource=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:z.string().min(8).max(128).parse(req.headers['idempotency-key']),body:input,code:200},async()=>{
    const value=await s.apply(p,target,input);await repo.audit(p,w,'reception.host.'+action,value,req.id);await repo.event(p.tenantId,w,value,'reception.host.changed');return value;
   });return s.view(p,resource);
  }));
 });
}
