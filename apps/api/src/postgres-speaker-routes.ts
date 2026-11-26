import {timingSafeEqual} from 'node:crypto';
import type {FastifyReply,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {AppError,requirePermission} from '@digitalguide/domain';
import {speakerStartInput,speakerSampleInput,speakerReacquireInput,speakerReleaseInput,speakerFallbackInput,speakerPttInput,speakerEnrollInput,speakerUseInput,speakerDeleteInput,speakerEventInput,speakerHandoffInput} from '@digitalguide/contracts';
import {NativeReception,nativeReceptionCookieName} from '../../../packages/postgres/src/runtime-reception.js';
import {NativeSpeaker} from '../../../packages/postgres/src/runtime-speaker.js';
import {NativeSpeakerHandoff,nativeHandoffCookieName,nativeHandoffCookiePath} from '../../../packages/postgres/src/runtime-speaker-handoff.js';
import type {RouteContext} from './postgres-asset-routes.js';
import type {Config} from './config.js';

export function registerNativeSpeakerRoutes(context:RouteContext,config:Config){
 const{app,repo,authenticated}=context,reception=new NativeReception(repo),speaker=new NativeSpeaker(repo,config.sessionSecret),base='/api/v1/guest/sessions/:id/speaker-focus',runtime=config.nativePostgres!.runtimeId,cookieName=nativeReceptionCookieName(runtime);
 const id=(req:FastifyRequest)=>z.uuid().parse((req.params as{id:string}).id),key=(req:FastifyRequest)=>z.string().min(8).max(128).parse(req.headers['idempotency-key']),send=(req:FastifyRequest,reply:FastifyReply,value:unknown)=>context.send(req,reply.header('Cache-Control','private, no-store'),value);
 const handoff=new NativeSpeakerHandoff(repo,config.sessionSecret),handoffCookie=nativeHandoffCookieName(runtime);
 function credentials(req:FastifyRequest,write=false){const proof=reception.credentials(config.sessionSecret,runtime,id(req),req.cookies[cookieName]);if(write){const csrf=req.headers['x-csrf-token'];if(typeof csrf!=='string'||Buffer.byteLength(csrf)!==Buffer.byteLength(proof.csrfToken)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(proof.csrfToken)))throw new AppError('FORBIDDEN','访客安全凭证已失效，请刷新当前接待页面。',403);}return proof;}
 async function prepareGuest(req:FastifyRequest,write=false){const proof=credentials(req,write);await repo.db.transaction(()=>reception.guest(id(req),proof.tokenHash,null));await repo.db.transaction(()=>reception.sweep());await repo.db.transaction(()=>speaker.sweep());return proof;}
 app.get(base,async(req,reply)=>{const proof=await prepareGuest(req);return send(req,reply,await repo.db.transaction(async()=>{await reception.guest(id(req),proof.tokenHash,null);return speaker.view(id(req),proof.tokenHash);}));});
 for(const[suffix,schema,operation]of [['',speakerStartInput,'start'],['/reference',speakerSampleInput,'reference'],['/reacquire',speakerReacquireInput,'reacquire'],['/release',speakerReleaseInput,'release'],['/fallback',speakerFallbackInput,'fallback'],['/ptt',speakerPttInput,'ptt']]as const){
  app.post(base+suffix,async(req,reply)=>{
   const input=schema.parse(req.body),proof=await prepareGuest(req,true),operationKey=key(req),useCode='useCode'in input&&typeof input.useCode==='string'?input.useCode:null;
   // Failed guesses count in a separate durable transaction. Retrying the same
   // request does not consume another attempt or renew any consent deadline.
   if(operation==='start'&&'mode'in input&&input.mode==='enrolled')await repo.db.transaction(()=>speaker.useAttempt(id(req),proof.tokenHash,proof.csrfHash,input.focusVersion,operationKey,input));
   const value=await repo.db.transaction(async()=>{
    const hint=await speaker.prelock(id(req),proof.tokenHash,useCode?.split('.')[1]??null),meta=await reception.guest(id(req),proof.tokenHash,proof.csrfHash,true),actor=reception.guestActor(meta);
    const receipt=await repo.idempotentResource(actor,{action:req.method+' '+req.url.split('?')[0],key:operationKey,body:input,code:200},async()=>{const result=await speaker.apply(id(req),proof.tokenHash,proof.csrfHash,operation,input,hint);await repo.audit(actor,meta.workspaceId,'speaker.'+operation+'_mock',result,req.id);return result;});
    // A retry returns the original action only while its resulting focus is
    // still current. It never repeats a mutation or resumes an older target.
    return speaker.receipt(id(req),proof.tokenHash,receipt,input.focusVersion);
   });return send(req,reply,value);
  });
 }
 app.get('/api/v1/sessions/:id/speaker-focus',async(req,reply)=>{
  await authenticated(req,async({principal})=>requirePermission(principal,'session.manage'));await repo.db.transaction(()=>reception.sweep());await repo.db.transaction(()=>speaker.sweep());
  return send(req,reply,await authenticated(req,async({principal})=>{await reception.adminMeta(principal,id(req));return speaker.adminView(id(req));}));
 });
 app.post('/api/v1/sessions/:id/speaker-focus/reference',async(req,reply)=>{
  const input=speakerSampleInput.parse(req.body),operationKey=key(req);await authenticated(req,async({principal})=>requirePermission(principal,'session.manage'));await repo.db.transaction(()=>reception.sweep());await repo.db.transaction(()=>speaker.sweep());
  const value=await authenticated(req,async({principal})=>{const hint=await speaker.prelock(id(req),null),meta=await reception.adminMeta(principal,id(req),true);if(meta.focusVersion!==input.focusVersion)throw new AppError('VERSION_CONFLICT','当前服务对象已变化，请重新核对合成参考。',409);await repo.idempotentResource(principal,{action:req.method+' '+req.url.split('?')[0],key:operationKey,body:input,code:200},async()=>{const result=await speaker.call<string>('dg_native_speaker_staff_sample',[id(req),input,hint]);await repo.audit(principal,meta.workspaceId,'speaker.staff_reference_mock',result,req.id);return result;});return speaker.adminView(id(req));});return send(req,reply,value);
 });
 app.post(base+'/handoff-intent',async(req,reply)=>{
  const input=speakerHandoffInput.parse(req.body),operationKey=key(req),proof=await prepareGuest(req,true);
  const value=await repo.db.transaction(async()=>{const hint=await speaker.prelock(id(req),proof.tokenHash),meta=await reception.guest(id(req),proof.tokenHash,proof.csrfHash,true),actor=reception.guestActor(meta),intent=await repo.idempotentResource(actor,{action:req.method+' '+req.url.split('?')[0],key:operationKey,body:input,code:200},async()=>{const value=await handoff.prepare(id(req),proof,input,hint);await repo.audit(actor,meta.workspaceId,'speaker.handoff_prepared_mock',value,req.id);return value;});
   // A cached preparation needs the same membership hint as its original turn.
   await handoff.prelock(id(req),proof,handoff.credentials(id(req),handoff.code(id(req),intent)));return handoff.descriptor(id(req),proof,intent);
  });reply.setCookie(handoffCookie,handoff.code(id(req),value.id),{path:nativeHandoffCookiePath(id(req)),httpOnly:true,sameSite:'strict',secure:config.webOrigin.startsWith('https:'),maxAge:Math.max(0,Math.floor((Date.parse(value.expiresAt)-Date.now())/1000))});return send(req,reply,{intentId:value.id,state:value.state,expiresAt:value.expiresAt,operationKey:'handoff:'+value.id});
 });
 app.get(base+'/handoff-intent',async(req,reply)=>{
  const proof=credentials(req),intent=handoff.credentials(id(req),req.cookies[handoffCookie]);const value=await repo.db.transaction(async()=>{await handoff.prelock(id(req),proof,intent);return handoff.descriptor(id(req),proof,intent.id);});return send(req,reply,{intentId:value.id,state:value.state,input:value.input,expiresAt:value.expiresAt,operationKey:'handoff:'+value.id,csrfToken:proof.csrfToken});
 });
 app.post(base+'/handoff',async(req,reply)=>{
  const input=speakerHandoffInput.parse(req.body),proof=credentials(req,true),intent=handoff.credentials(id(req),req.cookies[handoffCookie]),operationKey=key(req);
  if(operationKey!=='handoff:'+intent.id)throw new AppError('VALIDATION_FAILED','请使用本次意图返回的交接编号重试，不能另建交接操作。',400);
  const value=await repo.db.transaction(async()=>{const meta=await handoff.prelock(id(req),proof,intent),actor=reception.guestActor(meta),resource=await repo.idempotentResource(actor,{action:req.method+' '+req.url.split('?')[0],key:operationKey,body:input,code:200},async()=>{const result=await handoff.apply(id(req),proof,intent,input);await repo.audit(actor,meta.workspaceId,'speaker.participant_handoff_mock',result,req.id);return result;});if(resource!==intent.id)throw new AppError('HANDOFF_UNAVAILABLE','交接操作与原意图不符，请重新核对。',409);return handoff.nextAccess(await handoff.descriptor(id(req),proof,resource));});
  // The old ordinary capability is already revoked in the database. Keep its
  // existing browser cookie until its original expiry: if headers arrive but
  // the response body is lost, it and the separate short intent can recover.
  // First new-guest authorization permanently closes that delivery path.
  reply.setCookie(cookieName,value.cookie,{path:'/api/v1/guest/sessions/'+value.sessionId,httpOnly:true,sameSite:'strict',secure:config.webOrigin.startsWith('https:'),maxAge:Math.max(0,Math.floor((Date.parse(value.expiresAt)-Date.now())/1000))});return send(req,reply,{sessionId:value.sessionId,terminalUrl:value.terminalUrl});
 });
 app.post('/api/v1/sessions/:id/speaker-events',async(req,reply)=>{
  const input=speakerEventInput.parse(req.body),operationKey=key(req);
  await authenticated(req,async({principal})=>requirePermission(principal,'session.manage'));
  await repo.db.transaction(()=>reception.sweep());await repo.db.transaction(()=>speaker.sweep());
  const value=await authenticated(req,async({principal})=>{
   const hint=await speaker.prelock(id(req),null),meta=await reception.adminMeta(principal,id(req),true);
   const receipt=await repo.idempotentResource(principal,{action:req.method+' '+req.url.split('?')[0],key:operationKey,body:input,code:200},async()=>{
    const result=await speaker.event(id(req),input,hint);await repo.audit(principal,meta.workspaceId,'speaker.event_mock',result,req.id);return result;
   });return speaker.eventReceipt(id(req),receipt);
  });return send(req,reply,value);
 });
 const references='/api/v1/speaker-references';
 async function prepareOwner(req:FastifyRequest){await authenticated(req,async()=>undefined);await repo.db.transaction(()=>speaker.sweep());}
 app.get(references,async(req,reply)=>{const q=z.strictObject({workspaceId:z.uuid()}).parse(req.query);await prepareOwner(req);return send(req,reply,await authenticated(req,()=>speaker.referenceList(q.workspaceId)));});
 app.post(references,async(req,reply)=>{
  const input=speakerEnrollInput.parse(req.body);await prepareOwner(req);
  const value=await authenticated(req,async({principal})=>{const hint=await speaker.referencePrepare(null,input.workspaceId),resource=await repo.idempotentResource(principal,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:input,code:200},async()=>{const resource=await speaker.referenceApply(null,'enroll',input,hint);await repo.audit(principal,input.workspaceId,'speaker.reference_enroll_mock',resource,req.id);return resource;});return speaker.referenceView(resource);});return send(req,reply,value);
 });
 for(const[suffix,schema,action]of [['authorize-use',speakerUseInput,'authorize-use'],['delete',speakerDeleteInput,'delete']]as const){
  app.post(references+'/:id/'+suffix,async(req,reply)=>{
   const input=schema.parse(req.body);await prepareOwner(req);
   const value=await authenticated(req,async({principal})=>{const hint=await speaker.referencePrepare(id(req),null,'sessionId'in input?input.sessionId:null),resource=await repo.idempotentResource(principal,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:input,code:200},async()=>{const resource=await speaker.referenceApply(id(req),action,input,hint);await repo.audit(principal,String(hint.workspaceId),'speaker.reference_'+action.replace('-','_')+'_mock',id(req),req.id);return resource;});return action==='authorize-use'?speaker.revealUse(resource):speaker.referenceView(resource);});return send(req,reply,value);
  });
 }
}
