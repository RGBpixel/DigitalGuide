import type { FastifyRequest,FastifyReply } from 'fastify';
import type { Repository } from '@digitalguide/database';
import type { Config } from './config.js';
import { authenticatedSession } from './auth-check.js';
import { executeIdempotent } from './idempotency.js';
import type { SessionRow } from './reception-service.js';
import type { DiningActor } from './dining-service.js';
import { DiningService } from './dining-service.js';
export interface RestaurantActionHelpers {guest(req:FastifyRequest):SessionRow;expire():unknown}
export interface RestaurantActionRef {id:string;restaurantId:string}
export function restaurantActionContext(repo:Repository,config:Config,helpers:RestaurantActionHelpers){
 const dining=new DiningService(repo,config),send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.send({data,requestId:req.id});
 function actor(req:FastifyRequest,guest:boolean,focus?:number,write=false):DiningActor {if(!guest)return {p:authenticatedSession(repo,req,config).principal};const session=helpers.guest(req),a:DiningActor={session,p:{userId:'guest:'+session.id,tenantId:session.tenant_id,workspaceIds:[session.workspace_id],role:'viewer'}};dining.core.guest(session);if(write)dining.focus(a,focus);return a;}
 function read(req:FastifyRequest,reply:FastifyReply,guest:boolean,work:(a:DiningActor)=>unknown){helpers.expire();return send(req,reply,repo.transaction(()=>work(actor(req,guest))));}
 function write(req:FastifyRequest,reply:FastifyReply,guest:boolean,focus:number|undefined,guard:(a:DiningActor)=>unknown,work:(a:DiningActor)=>RestaurantActionRef,project:(a:DiningActor,ref:RestaurantActionRef)=>unknown){helpers.expire();repo.transaction(()=>guard(actor(req,guest,focus,true)));const first=actor(req,guest,focus,true),result=executeIdempotent(repo,req,first.p.tenantId,first.p.userId,()=>{const a=actor(req,guest,focus,true);guard(a);const ref=work(a),r=dining.core.raw(ref.restaurantId);repo.audit(a.p,r.workspace_id,'restaurant.'+req.routeOptions.url,ref.id,req.id);return ref;});return send(req,reply,repo.transaction(()=>{const a=actor(req,guest,focus,true);guard(a);return project(a,result.data);}));}
 return {actor,read,write,send};
}
