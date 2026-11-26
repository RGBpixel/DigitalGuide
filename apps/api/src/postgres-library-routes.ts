import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {libraryFolderCreate,libraryFolderSave,libraryFolderArchive,libraryFamilySave,libraryRevisionAdd,libraryRecycleInput,libraryRecycleApply,libraryListInput,studioCloneInput,studioCloneControlInput} from '@digitalguide/contracts';
import {requirePermission,type Permission,type Principal} from '@digitalguide/domain';
import {NativeAssetLibrary} from '../../../packages/postgres/src/runtime-library.js';
import {NativeStudioClones} from '../../../packages/postgres/src/runtime-clones.js';
import {sendNativeAssetContent,type RouteContext} from './postgres-asset-routes.js';

export function registerNativeLibraryRoutes({app,repo,authenticated,send}:RouteContext){
 const library=new NativeAssetLibrary(repo),clones=new NativeStudioClones(repo),base='/api/v1/asset-library',key=(req:FastifyRequest)=>z.uuid().parse((req.params as {id:string}).id);
 async function write<T extends {workspaceId:string}>(req:FastifyRequest,body:unknown,permission:Permission,work:(p:Principal)=>Promise<string>,view:(p:Principal,id:string)=>Promise<T>){return authenticated(req,async({principal:p})=>{requirePermission(p,permission);const id=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:z.string().min(8).max(128).parse(req.headers['idempotency-key']),body,code:200},async()=>{const id=await work(p);if(permission==='asset.write'){const record=await view(p,id);await repo.audit(p,record.workspaceId,'asset_library.'+req.method.toLowerCase()+'.'+(req.routeOptions.url??'action'),id,req.id);}return id;});return view(p,id);});}
 app.get(base+'/folders',async(req,reply)=>{const q=z.strictObject({workspaceId:z.uuid()}).parse(req.query);return send(req,reply,await authenticated(req,({principal:p})=>library.folders(p,q.workspaceId)));});
 app.post(base+'/folders',async(req,reply)=>{const input=libraryFolderCreate.parse(req.body);return send(req,reply,await write(req,input,'asset.write',async p=>{return library.createFolder(p,input);},(p,id)=>library.folderViewId(p,id)));});
 app.post(base+'/folders/:id/save',async(req,reply)=>{const input=libraryFolderSave.parse(req.body),id=key(req);return send(req,reply,await write(req,input,'asset.write',p=>library.saveFolder(p,id,input),(p,id)=>library.folderViewId(p,id)));});
 app.post(base+'/folders/:id/archive',async(req,reply)=>{const input=libraryFolderArchive.parse(req.body),id=key(req);return send(req,reply,await write(req,input,'asset.write',p=>library.archiveFolder(p,id,input.version,input.archived),(p,id)=>library.folderViewId(p,id)));});
 app.get(base+'/families',async(req,reply)=>{const q=libraryListInput.parse(req.query);return send(req,reply,await authenticated(req,({principal:p})=>library.list(p,q)));});
 app.get(base+'/families/:id',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>library.viewId(p,key(req)))));
 app.get(base+'/families/:id/files/:assetId',async(req,reply)=>{const assetId=z.uuid().parse((req.params as {assetId:string}).assetId);return sendNativeAssetContent(req,reply,await authenticated(req,({principal:p})=>library.content(p,key(req),assetId)));});
 app.post(base+'/families/:id/save',async(req,reply)=>{const input=libraryFamilySave.parse(req.body),id=key(req);return send(req,reply,await write(req,input,'asset.write',p=>library.save(p,id,input),(p,id)=>library.viewId(p,id)));});
 app.post(base+'/families/:id/versions',async(req,reply)=>{const input=libraryRevisionAdd.parse(req.body),id=key(req);return send(req,reply,await write(req,input,'asset.write',p=>library.addRevision(p,id,input),(p,id)=>library.viewId(p,id)));});
 app.post(base+'/families/:id/recycle-plan',async(req,reply)=>{const input=libraryRecycleInput.parse(req.body);return send(req,reply,await authenticated(req,({principal:p})=>library.recyclePlan(p,key(req),input)));});
 app.post(base+'/families/:id/recycle',async(req,reply)=>{const input=libraryRecycleApply.parse(req.body),id=key(req);return send(req,reply,await write(req,input,'asset.write',p=>library.recycle(p,id,input,req.id),(p,id)=>library.viewId(p,id)));});
 app.get(base+'/families/:id/events',async(req,reply)=>{const q=z.strictObject({after:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(30)}).parse(req.query);return send(req,reply,await authenticated(req,({principal:p})=>library.events(p,key(req),q.after,q.limit)));});
 app.get('/api/v1/studio/clones',async(req,reply)=>{const q=z.strictObject({workspaceId:z.uuid(),cursor:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50),archived:z.enum(['true','false']).optional()}).parse(req.query);return send(req,reply,await authenticated(req,({principal:p})=>clones.list(p,q)));});
 app.get('/api/v1/studio/clones/:id',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>clones.get(p,key(req)))));
 app.post('/api/v1/studio/clones',async(req,reply)=>{const input=studioCloneInput.parse(req.body);return send(req,reply,await write(req,input,'studio.write',p=>clones.create(p,input,req.id),(p,id)=>clones.get(p,id)));});
 app.post('/api/v1/studio/clones/:id/control',async(req,reply)=>{const input=studioCloneControlInput.parse(req.body),id=key(req);return send(req,reply,await write(req,input,'studio.write',p=>clones.control(p,id,input.version,input.action,req.id),(p,id)=>clones.get(p,id)));});
}
