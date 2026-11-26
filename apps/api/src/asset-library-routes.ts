import {z} from 'zod';
import path from 'node:path';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError,type Principal} from '@digitalguide/domain';
import {libraryFolderCreate,libraryFolderSave,libraryFolderArchive,libraryFamilySave,libraryRevisionAdd,libraryRecycleInput,libraryRecycleApply,libraryListInput} from '@digitalguide/contracts';
import {authenticatedSession} from './auth-check.js';
import type {Config} from './config.js';
import {executeIdempotent} from './idempotency.js';
import {AssetLibrary} from './asset-library.js';
import {fileDigest,ownedFile} from '../../../packages/media/src/files.js';
import {privateFile} from './private-file.js';

export function registerAssetLibraryRoutes(app:FastifyInstance,repo:Repository,config:Config){
  const library=new AssetLibrary(repo),base='/api/v1/asset-library',key=(req:FastifyRequest)=>z.uuid().parse((req.params as {id:string}).id),fresh=(req:FastifyRequest)=>authenticatedSession(repo,req,config).principal,send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.send({data,requestId:req.id});
  function write(req:FastifyRequest,reply:FastifyReply,guard:(p:Principal)=>void,work:(p:Principal)=>string,view:(p:Principal,id:string)=>unknown){const p=fresh(req);repo.transaction(()=>guard(fresh(req)));const result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>{const current=fresh(req);guard(current);return{id:work(current)};});return send(req,reply,repo.transaction(()=>{const current=fresh(req);guard(current);return view(current,result.data.id);}));}
  const folderView=(p:Principal,id:string)=>library.folderView(p,library.folder(p,id,false)),familyView=(p:Principal,id:string)=>library.view(p,library.family(p,id),true);
  app.get(base+'/folders',(req,reply)=>{const q=z.strictObject({workspaceId:z.uuid()}).parse(req.query),p=fresh(req);return send(req,reply,library.folders(p,q.workspaceId));});
  app.post(base+'/folders',(req,reply)=>{const input=libraryFolderCreate.parse(req.body);return write(req,reply,p=>library.guard(p,input.workspaceId,true),p=>{const id=library.createFolder(p,input);repo.audit(p,input.workspaceId,'asset_library.folder_created',id,req.id);return id;},folderView);});
  app.post(base+'/folders/:id/save',(req,reply)=>{const input=libraryFolderSave.parse(req.body),id=key(req);return write(req,reply,p=>library.guard(p,library.folder(p,id).workspace_id,true),p=>{const r=library.folder(p,id);library.saveFolder(p,r,input);repo.audit(p,r.workspace_id,'asset_library.folder_updated',id,req.id);return id;},folderView);});
  app.post(base+'/folders/:id/archive',(req,reply)=>{const input=libraryFolderArchive.parse(req.body),id=key(req);return write(req,reply,p=>library.guard(p,library.folder(p,id,false).workspace_id,true),p=>{const r=library.folder(p,id,false);library.archiveFolder(p,r,input.version,input.archived);repo.audit(p,r.workspace_id,input.archived?'asset_library.folder_archived':'asset_library.folder_restored',id,req.id);return id;},folderView);});
  app.get(base+'/families',(req,reply)=>send(req,reply,library.list(fresh(req),libraryListInput.parse(req.query))));
  app.get(base+'/families/:id',(req,reply)=>{const p=fresh(req);return send(req,reply,familyView(p,key(req)));});
  app.get(base+'/families/:id/files/:assetId',async(req,reply)=>{const id=key(req),assetId=z.uuid().parse((req.params as {assetId:string}).assetId);function current(){const p=fresh(req),r=library.family(p,id),revision=library.revisions(r).find(v=>v.asset_id===assetId);if(!revision)throw new AppError('NOT_FOUND','此文件不在所选版本组中。',404);const file=library.file(p,revision);if(!file.available)throw new AppError('LIBRARY_FILE_UNAVAILABLE',file.unavailableReason!,409);const upload=repo.get<{storage_key:string}>('SELECT storage_key FROM uploads WHERE id=?',revision.upload_id)!;return{file,key:upload.storage_key};}const before=current(),filePath=ownedFile(path.join(config.dataDir,'objects'),before.key),digest=await fileDigest(filePath).catch(()=>{throw new AppError('LIBRARY_FILE_MISSING','原文件缺失，请联系管理员检查保存位置。',409);}),after=current();if(before.key!==after.key||digest.sha256!==after.file.sha256||digest.size!==after.file.size||after.file.sha256!==before.file.sha256)throw new AppError('LIBRARY_FILE_CHANGED','原文件实际字节校验不一致，请检查或重新上传，不可作为原版本下载。',409);return privateFile(req,reply,filePath,after.file.mediaType);});
  app.post(base+'/families/:id/save',(req,reply)=>{const input=libraryFamilySave.parse(req.body),id=key(req);return write(req,reply,p=>library.guard(p,library.family(p,id).workspace_id,true),p=>{const r=library.family(p,id);library.save(p,r,input);repo.audit(p,r.workspace_id,'asset_library.organized',id,req.id);return id;},familyView);});
  app.post(base+'/families/:id/versions',(req,reply)=>{const input=libraryRevisionAdd.parse(req.body),id=key(req);return write(req,reply,p=>library.guard(p,library.family(p,id).workspace_id,true),p=>{const r=library.family(p,id);library.addRevision(p,r,input);repo.audit(p,r.workspace_id,'asset_library.revision_added',id,req.id);return id;},familyView);});
  app.post(base+'/families/:id/recycle-plan',(req,reply)=>{const input=libraryRecycleInput.parse(req.body),p=fresh(req);return send(req,reply,repo.transaction(()=>library.plan(p,library.family(p,key(req)),input)));});
  app.post(base+'/families/:id/recycle',(req,reply)=>{const input=libraryRecycleApply.parse(req.body),id=key(req);return write(req,reply,p=>library.guard(p,library.family(p,id).workspace_id,true),p=>{const r=library.family(p,id);library.apply(p,r,input);repo.audit(p,r.workspace_id,'asset_library.'+input.operation,id,req.id);return id;},familyView);});
  app.get(base+'/families/:id/events',(req,reply)=>{const q=z.strictObject({after:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(30)}).parse(req.query),p=fresh(req);return send(req,reply,library.events(p,library.family(p,key(req)),q.after,q.limit));});
}
