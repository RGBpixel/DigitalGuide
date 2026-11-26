import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {studioImportInput,studioImportCancelInput,studioImportApplyInput} from '@digitalguide/contracts';
import {requirePermission,type Principal} from '@digitalguide/domain';
import {NativeImports} from '../../../packages/postgres/src/runtime-imports.js';
import {NativeStudio} from '../../../packages/postgres/src/runtime-studio.js';
import {sendNativeAssetContent,type RouteContext} from './postgres-asset-routes.js';

export function registerNativeImportRoutes({app,repo,authenticated,send}:RouteContext){
 const service=new NativeImports(repo),studio=new NativeStudio(repo),key=(req:FastifyRequest)=>z.uuid().parse((req.params as {id:string}).id);
 async function write<T>(req:FastifyRequest,body:unknown,work:(p:Principal)=>Promise<string>,view:(p:Principal,id:string)=>Promise<T>){return authenticated(req,async({principal:p})=>{requirePermission(p,'studio.write');const id=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:z.string().min(8).max(128).parse(req.headers['idempotency-key']),body,code:200},()=>work(p));return view(p,id);});}
 app.get('/api/v1/studio/imports',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>service.list(p,z.strictObject({workspaceId:z.uuid(),cursor:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(req.query)))));
 app.get('/api/v1/studio/imports/:id',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>service.view(p,key(req)))));
 app.post('/api/v1/studio/imports',async(req,reply)=>{const input=studioImportInput.parse(req.body);return send(req,reply,await write(req,input,p=>service.create(p,input,req.id),(p,id)=>service.view(p,id)));});
 app.post('/api/v1/studio/imports/:id/cancel',async(req,reply)=>{const input=studioImportCancelInput.parse(req.body),id=key(req);return send(req,reply,await write(req,input,p=>service.cancel(p,id,input.version,req.id),(p,id)=>service.view(p,id)));});
 app.get('/api/v1/studio/import-media/:id',async(req,reply)=>sendNativeAssetContent(req,reply,await authenticated(req,async({principal:p})=>{const result=await service.checkedMedia(p,key(req),true);return{asset:{mediaType:'image/png'},buffer:result.buffer!};})));
 app.get('/api/v1/studio/imports/:id/source',async(req,reply)=>{const result=await authenticated(req,({principal:p})=>service.source(p,key(req)));reply.header('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(result.row.file_name).replace(/'/g,'%27'));return sendNativeAssetContent(req,reply,{asset:{mediaType:'application/octet-stream'},buffer:result.buffer});});
 app.post('/api/v1/studio/imports/:id/apply',async(req,reply)=>{const input=studioImportApplyInput.parse(req.body),id=key(req);return send(req,reply,await write(req,input,async p=>{await service.scope(p,id,true);const prepared=await service.document(p,id,input);return studio.create(p,{workspaceId:prepared.row.workspace_id,name:input.name,purpose:input.purpose,document:prepared.document,variables:{}},req.id);},(p,id)=>studio.get(p,id)));});
}
