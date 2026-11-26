import type {FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {kitchenEventInput} from '@digitalguide/contracts';
import {NativeKitchen} from '../../../packages/postgres/src/runtime-kitchen.js';
import type {RouteContext} from './postgres-asset-routes.js';
import type {Config} from './config.js';

export function registerNativeKitchenRoutes(context:RouteContext,config:Config){
 const{app,repo,authenticated}=context,kitchen=new NativeKitchen(repo,config.sessionSecret),base='/api/v1/kitchen',id=(req:FastifyRequest)=>z.uuid().parse((req.params as{id:string}).id),key=(req:FastifyRequest)=>z.string().min(8).max(128).parse(req.headers['idempotency-key']),send=(req:FastifyRequest,reply:FastifyReply,value:unknown)=>context.send(req,reply.header('Cache-Control','private, no-store'),value);
 app.get(base+'/restaurants',async(req,reply)=>send(req,reply,await authenticated(req,()=>kitchen.directory())));
 app.get(base+'/restaurants/:id/tickets',async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>{await kitchen.prepareKitchen(p,'restaurant',id(req));return kitchen.tickets(id(req));})));
 app.post(base+'/tickets/:id/events',async(req,reply)=>{const body=kitchenEventInput.parse(req.body),mode=body.action==='serve'?'serve':'cook';return send(req,reply,await authenticated(req,async({principal:p})=>{await kitchen.prepareKitchen(p,'ticket',id(req),true,mode);const operation=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:key(req),body,code:200},()=>kitchen.applyKitchen(id(req),body));return kitchen.kitchenResult(operation);}));});
}
