import {z} from 'zod';
import {requirePermission} from '@digitalguide/domain';
import {shelfListInput,shelfSourcesInput,shelfCreateInput,shelfUpdateInput,shelfControlInput,shelfSelectInput} from '../../../packages/contracts/src/resource-shelf.js';
import {NativeResourceShelf} from '../../../packages/postgres/src/runtime-resource-shelf.js';
import type {RouteContext} from './postgres-asset-routes.js';
export function registerNativeResourceShelfRoutes({app,repo,authenticated,send}:RouteContext){
 const service=new NativeResourceShelf(repo),id=(params:unknown)=>z.uuid().parse((params as {id:string}).id);
 app.get('/api/v1/resource-shelf',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>service.list(p,shelfListInput.parse(req.query)))));
 app.get('/api/v1/resource-shelf/sources',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>service.candidates(p,shelfSourcesInput.parse(req.query)))));
 app.get('/api/v1/resource-shelf/selections/:id',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>service.selection(p,id(req.params)))));
 app.get('/api/v1/resource-shelf/:id',async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>service.view(p,await service.row(p,id(req.params))))));
 app.get('/api/v1/resource-shelf/:id/events',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>service.history(p,id(req.params)))));
 for(const action of ['create','update','control','select'] as const)app.post('/api/v1/resource-shelf'+(action==='create'?'':'/:id/'+action),async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>{
  requirePermission(p,action==='select'?'studio.write':'operations.manage');const input=action==='create'?shelfCreateInput.parse(req.body):action==='update'?shelfUpdateInput.parse(req.body):action==='control'?shelfControlInput.parse(req.body):shelfSelectInput.parse(req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);
  if(action==='create')await service.scope(p,shelfCreateInput.parse(input).workspaceId,true);else await service.row(p,id(req.params),action!=='select',false,true);
  const resource=await repo.idempotentResource(p,{action:'POST '+req.url.split('?')[0],key,body:input,code:200},()=>action==='create'?service.create(p,shelfCreateInput.parse(input),req.id):action==='update'?service.update(p,id(req.params),shelfUpdateInput.parse(input),req.id):action==='control'?service.control(p,id(req.params),shelfControlInput.parse(input),req.id):service.select(p,id(req.params),shelfSelectInput.parse(input).version,req.id));
  return action==='select'?service.selection(p,resource):service.view(p,await service.row(p,resource));
 })));
}
