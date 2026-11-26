import type {FileHandle} from 'node:fs/promises';
import {NativeMediaFiles} from '../../../packages/postgres/src/runtime-media-files.js';
import {nativeVideoFrame} from '../../../packages/postgres/src/runtime-video-frames.js';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {mediaInspectionFrameQuery,type Asset,assetInput,assetUpdateInput,consentInput,id,listInput,profileInput,profileUpdateInput,routeInput,uploadInput} from '@digitalguide/contracts';
import {AppError,requirePermission,type Permission,type Principal} from '@digitalguide/domain';
import type {NativeCoreRepository,NativeSession} from '../../../packages/postgres/src/runtime-repository.js';

export interface RouteContext {
 app:FastifyInstance;repo:NativeCoreRepository;
 authenticated<T>(req:FastifyRequest,work:(s:NativeSession)=>Promise<T>,exclusiveSession?:boolean):Promise<T>;
 send(req:FastifyRequest,reply:FastifyReply,data:unknown,code?:number):FastifyReply;
 scope(p:Principal,raw:unknown):{q:z.infer<typeof listInput>;ids:string[]};
}
export function registerNativeAssetRoutes({app,repo,authenticated,send,scope}:RouteContext,root=process.cwd()){
 const assets=repo.assets,key=(req:FastifyRequest)=>id.parse((req.params as {id:string}).id);
 async function mutation<T>(req:FastifyRequest,permission:Permission,body:unknown,work:(p:Principal)=>Promise<string>,view:(p:Principal,id:string)=>Promise<T>,code=200,guard?:(p:Principal)=>Promise<unknown>){return authenticated(req,async({principal:p})=>{requirePermission(p,permission);await guard?.(p);const resourceId=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:z.string().min(8).max(128).parse(req.headers['idempotency-key']),body,code},()=>work(p));return view(p,resourceId);});}
 app.post('/api/v1/assets/uploads',async(req,reply)=>{const input=uploadInput.parse(req.body);return send(req,reply,await mutation(req,'asset.write',input,p=>assets.upload(p,input,req.id),(p,id)=>assets.uploadView(p,id),201),201);});
 app.post('/api/v1/assets',async(req,reply)=>{const input=assetInput.parse(req.body);return send(req,reply,await mutation(req,'asset.write',input,p=>assets.create(p,input,req.id),(p,id)=>assets.asset(p,id),201),201);});
 app.get('/api/v1/assets',async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>{const{q,ids}=scope(p,req.query),types=q.mediaType==='video'?['video/mp4','video/quicktime']:q.mediaType?[q.mediaType]:[],rows=(await repo.db.query<{id:string}>('SELECT a.id FROM assets a JOIN uploads u ON u.id=a.upload_id WHERE a.tenant_id=$1 AND a.workspace_id=ANY($2::text[]) AND a.archived=$3 AND a.id>$4 AND (cardinality($5::text[])=0 OR u.media_type=ANY($5::text[])) ORDER BY a.id LIMIT $6',[p.tenantId,ids,q.archived==='true'?1:0,q.cursor??'',types,q.limit+1])).rows,items=[];for(const row of rows.slice(0,q.limit))items.push(await assets.metadata(p,row.id));return{items,nextCursor:rows.length>q.limit?rows[q.limit-1].id:null};})));
 app.get('/api/v1/assets/:id',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>assets.asset(p,key(req)))));
 async function content(req:FastifyRequest,reply:FastifyReply,kind:'original'|'poster'|'preview'){
  let handle:FileHandle|undefined;try{const data=await authenticated(req,async({principal:p})=>{const result=await assets.download(p,key(req),kind);handle=result.handle;return result;}),{size,mediaType}=data;reply.type(mediaType).header('Cache-Control','private, no-store').header('Content-Security-Policy',"default-src 'none'; sandbox").header('X-Content-Type-Options','nosniff').header('Accept-Ranges','bytes');let start=0,end=size-1;
   if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range),invalid=()=>reply.code(416).header('Content-Range','bytes */'+size).send();if(!m||!m[1]&&!m[2])return invalid();start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));end=m[1]?m[2]?Math.min(size-1,Number(m[2])):size-1:size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size)return invalid();reply.code(206).header('Content-Range','bytes '+start+'-'+end+'/'+size);}
   reply.header('Content-Length',end-start+1);const stream=new NativeMediaFiles(repo.db.config).stream(handle!,start,end);handle=undefined;return reply.send(stream);
  }finally{await handle?.close();}
 }
 app.get('/api/v1/assets/:id/content',async(req,reply)=>content(req,reply,'original'));
 app.get('/api/v1/assets/:id/poster',async(req,reply)=>content(req,reply,'poster'));
 app.get('/api/v1/assets/:id/browser-preview',async(req,reply)=>content(req,reply,'preview'));
 app.get('/api/v1/assets/:id/frame',async(req,reply)=>{const q=z.strictObject({timeMs:z.coerce.number().min(0).max(600000)}).parse(req.query);return sendNativeAssetContent(req,reply,await authenticated(req,({principal:p})=>nativeVideoFrame(repo,p,key(req),root,q)));});
 app.get('/api/v1/assets/:id/inspection-frame',async(req,reply)=>{const q=mediaInspectionFrameQuery.parse(req.query);return sendNativeAssetContent(req,reply,await authenticated(req,({principal:p})=>nativeVideoFrame(repo,p,key(req),root,q)));});
 app.patch('/api/v1/assets/:id',async(req,reply)=>{const input=assetUpdateInput.parse(req.body),target=key(req);return send(req,reply,await mutation(req,'asset.write',input,p=>assets.update(p,target,input,req.id),(p,id)=>assets.asset(p,id)));});
 app.get('/api/v1/assets/:id/versions',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>assets.versions(p,key(req)))));
 app.get('/api/v1/assets/:id/consents',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>assets.consents(p,key(req)))));
 app.post('/api/v1/assets/:id/consents',async(req,reply)=>{const input=consentInput.parse(req.body),target=key(req);return send(req,reply,await mutation(req,'asset.train',input,p=>assets.grant(p,target,input,req.id),(p,id)=>assets.consentResponse(p,id),201,p=>assets.grantGuard(p,target,input)),201);});
 app.post('/api/v1/consents/:id/revoke',async(req,reply)=>{const target=key(req);return send(req,reply,await mutation(req,'asset.train',req.body??{},p=>assets.revoke(p,target,req.id),async(p,id)=>({revoked:!!(await assets.consent(p,id)).revoked_at})));});
 app.post('/api/v1/profiles',async(req,reply)=>{const input=profileInput.parse(req.body);return send(req,reply,await mutation(req,'profile.write',input,p=>assets.createProfile(p,input,req.id),(p,id)=>assets.profile(p,id),201),201);});
 app.get('/api/v1/profiles',async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>{const{q,ids}=scope(p,req.query),rows=(await repo.db.query<{id:string}>('SELECT id FROM profiles WHERE tenant_id=$1 AND workspace_id=ANY($2::text[]) AND id>$3 ORDER BY id LIMIT $4',[p.tenantId,ids,q.cursor??'',q.limit+1])).rows,items=[];for(const row of rows.slice(0,q.limit))items.push(await assets.profile(p,row.id));return{items,nextCursor:rows.length>q.limit?rows[q.limit-1].id:null};})));
 app.get('/api/v1/profiles/:id',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>assets.profile(p,key(req)))));
 app.put('/api/v1/profiles/:id',async(req,reply)=>{const input=profileUpdateInput.parse(req.body),target=key(req);return send(req,reply,await mutation(req,'profile.write',input,p=>assets.updateProfile(p,target,input,req.id),(p,id)=>assets.profile(p,id)));});
 app.get('/api/v1/profiles/:id/versions',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>assets.profileVersions(p,key(req)))));
 app.post('/api/v1/profiles/:id/resolve',async(req,reply)=>{
  const input=routeInput.parse(req.body),target=key(req),resolve=async(p:Principal,id:string)=>{const profile=await assets.profile(p,id);if(profile.version!==input.version)throw new AppError('VERSION_CONFLICT','角色版本已变化，请刷新后再检查。',409);if(!profile.scenes.includes(input.scene))throw new AppError('CAPABILITY_UNAVAILABLE','角色未启用此场景，请先编辑角色配置。',409);const{avatar,voice}=await assets.profileAssets(p,profile);if((await repo.db.query('SELECT 1 FROM provider_health WHERE tenant_id=$1 AND provider_id=$2 AND open_until>dg_utc_now()',[p.tenantId,'mock-local'])).rowCount)throw new AppError('PROVIDER_CIRCUIT_OPEN','提供商暂时熔断，请稍后检查。',409,true);return{profileId:id,profileVersion:profile.version,scene:input.scene,environment:'mock',providerId:'mock-local',simulated:true,snapshot:profile,assets:{avatar:{id:avatar.id,version:avatar.version},voice:voice?{id:voice.id,version:voice.version}:null},readyForRealService:false,message:'模拟场景绑定检查完成。参考素材及模拟训练结果不是真实数字人模型。'};};
  return send(req,reply,await mutation(req,'profile.write',input,async p=>{const profile=await assets.profile(p,target);await repo.audit(p,profile.workspaceId,'profile.resolve',target,req.id);return target;},resolve,200,p=>resolve(p,target)));
 });
}

export function sendNativeAssetContent(req:FastifyRequest,reply:FastifyReply,{asset,buffer}:{asset:Pick<Asset,'mediaType'>;buffer:Buffer}){
 reply.type(asset.mediaType).header('Cache-Control','private, no-store').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Accept-Ranges','bytes');
  if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range),invalid=()=>reply.code(416).header('Content-Range','bytes */'+buffer.length).send();if(!m||!m[1]&&!m[2])return invalid();const start=m[1]?Number(m[1]):Math.max(0,buffer.length-Number(m[2])),end=m[1]?m[2]?Math.min(buffer.length-1,Number(m[2])):buffer.length-1:buffer.length-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=buffer.length)return invalid();return reply.code(206).header('Content-Range',`bytes ${start}-${end}/${buffer.length}`).header('Content-Length',end-start+1).send(buffer.subarray(start,end+1));}
  return reply.header('Content-Length',buffer.length).send(buffer);
}
