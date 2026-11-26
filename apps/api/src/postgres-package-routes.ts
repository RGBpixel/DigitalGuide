import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {requirePermission} from '@digitalguide/domain';
import {transferCreateInput,transferChunkInput,transferControlInput,listInput} from '@digitalguide/contracts';
import {NativePackageTransfers} from '../../../packages/postgres/src/runtime-package-transfers.js';
import type {RouteContext} from './postgres-asset-routes.js';

export function registerNativePackageRoutes({app,repo,authenticated,send}:RouteContext){
 const transfers=new NativePackageTransfers(repo),id=(req:FastifyRequest)=>z.uuid().parse((req.params as {id:string}).id);
 app.get('/api/v1/studio/transfers',async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>{const q=listInput.extend({workspaceId:z.uuid()}).parse(req.query);return transfers.list(p,q);})));
 app.get('/api/v1/studio/transfers/:id',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>transfers.view(p,id(req)))));
 app.post('/api/v1/studio/transfers',async(req,reply)=>{const input=transferCreateInput.parse(req.body);return send(req,reply,await authenticated(req,async({principal:p})=>{requirePermission(p,'asset.write');if(input.kind==='package')requirePermission(p,'studio.write');const value=await repo.idempotentResource(p,{action:'POST /studio/transfers',key:z.string().min(8).max(128).parse(req.headers['idempotency-key']),body:input,code:200},()=>transfers.create(p,input,req.id));return transfers.view(p,value);}));});
 for(const action of ['parts','finalize','cancel'] as const)app.post('/api/v1/studio/transfers/:id/'+action,async(req,reply)=>{const input=action==='parts'?transferChunkInput.parse(req.body):transferControlInput.parse(req.body),target=id(req);return send(req,reply,await authenticated(req,async({principal:p})=>{await transfers.scope(p,target);const value=await repo.idempotentResource(p,{action:'POST /studio/transfers/'+target+'/'+action,key:z.string().min(8).max(128).parse(req.headers['idempotency-key']),body:input,code:200},()=>action==='parts'?transfers.part(p,target,transferChunkInput.parse(input)):action==='finalize'?transfers.finalize(p,target,transferControlInput.parse(input).version):transfers.cancel(p,target,transferControlInput.parse(input).version));return transfers.view(p,value);}));});
}
