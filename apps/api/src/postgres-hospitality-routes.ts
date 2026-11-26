import {timingSafeEqual} from 'node:crypto';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {AppError} from '@digitalguide/domain';
import {nativeDiningServiceInput,nativeDiningServiceActionInput,toolConfirmInput} from '@digitalguide/contracts';
import {NativeHospitality,type NativeHospitalityKind} from '../../../packages/postgres/src/runtime-hospitality.js';
import {NativeReception,nativeReceptionCookieName} from '../../../packages/postgres/src/runtime-reception.js';
import type {NativeDiningProof} from '../../../packages/postgres/src/runtime-dining.js';
import type {RouteContext} from './postgres-asset-routes.js';
import type {Config} from './config.js';
export function registerNativeHospitalityRoutes(context:RouteContext,config:Config){
 const{app,repo,authenticated}=context,service=new NativeHospitality(repo,config.sessionSecret),reception=new NativeReception(repo),cookieName=nativeReceptionCookieName(config.nativePostgres!.runtimeId),base='/api/v1';
 const id=(req:FastifyRequest,name='id')=>z.uuid().parse((req.params as Record<string,string>)[name]),key=(req:FastifyRequest)=>z.string().min(8).max(128).parse(req.headers['idempotency-key']),send=(req:FastifyRequest,reply:FastifyReply,value:unknown)=>context.send(req,reply.header('Cache-Control','private, no-store'),value);
 async function guest(req:FastifyRequest,write=false){const proof=reception.credentials(config.sessionSecret,config.nativePostgres!.runtimeId,id(req),req.cookies[cookieName]);if(write){const csrf=req.headers['x-csrf-token'];if(typeof csrf!=='string'||Buffer.byteLength(csrf)!==Buffer.byteLength(proof.csrfToken)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(proof.csrfToken)))throw new AppError('FORBIDDEN','本次终端安全凭证已变化，请刷新后重新核对。',403);}const meta=await repo.db.transaction(()=>reception.guest(id(req),proof.tokenHash,null));if(meta.serviceScene!=='restaurant'||!meta.restaurantId)throw new AppError('NOT_FOUND','请从本店顾客终端提交餐中服务。',404);await repo.db.transaction(()=>reception.sweep());await repo.db.transaction(()=>service.sweep(meta.restaurantId!));return proof;}
 function input(schema:z.ZodType,raw:unknown,guestValue:boolean){if(!guestValue)return schema.parse(raw) as Record<string,unknown>;const outer=z.record(z.string(),z.unknown()).parse(raw),{selectionVersion,...rest}=outer;return{...schema.parse(rest) as Record<string,unknown>,focusVersion:z.int().nonnegative().parse(rest.focusVersion),selectionVersion:z.int().nonnegative().parse(selectionVersion)};}
 async function staffScope(req:FastifyRequest,kind:NativeHospitalityKind,target:string,write=false){return authenticated(req,({principal:p})=>service.prepareHospitality(p,kind,target,write));}
 async function read(req:FastifyRequest,reply:FastifyReply,guestValue:boolean,kind:'party'|'restaurant',target:string){if(guestValue){const proof=await guest(req);return send(req,reply,await repo.db.transaction(()=>service.services(kind,target,{id:id(req),...proof})));}const meta=await staffScope(req,kind,target);await repo.db.transaction(()=>service.sweep(meta.restaurantId));return send(req,reply,await authenticated(req,async({principal:p})=>{await service.prepareHospitality(p,kind,target);return service.services(kind,target);}));}
 async function write(req:FastifyRequest,reply:FastifyReply,guestValue:boolean,kind:'party'|'service',target:string,action:'create'|'acknowledge'|'resolve'|'cancel',body:Record<string,unknown>){
  if(!guestValue){await staffScope(req,kind,target,true);return send(req,reply,await authenticated(req,async({principal:p})=>{await service.prepareHospitality(p,kind,target,true);const operation=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:key(req),body,code:200},()=>service.applyHospitality(kind,target,action,body));return service.hospitalityResult(operation);}));}
  const access=await guest(req,true),proof:NativeDiningProof={id:id(req),...access,focusVersion:body.focusVersion as number};return send(req,reply,await repo.db.transaction(async()=>{const meta=await reception.guest(proof.id,proof.tokenHash,proof.csrfHash??null,true),actor=reception.guestActor(meta);await service.hospitalityContext(kind,target,proof,true,body.selectionVersion as number);const operation=await repo.idempotentResource(actor,{action:req.method+' '+req.url.split('?')[0],key:key(req),body,code:200},()=>service.applyHospitality(kind,target,action,body,proof));return service.hospitalityResult(operation,proof);}));
 }
 for(const guestValue of [false,true]){const prefix=guestValue?base+'/guest/sessions/:id/dining':base+'/restaurant';app.get(prefix+'/parties/:partyId/services',(req,reply)=>read(req,reply,guestValue,'party',id(req,'partyId')));app.post(prefix+'/parties/:partyId/services',(req,reply)=>write(req,reply,guestValue,'party',id(req,'partyId'),'create',input(nativeDiningServiceInput,req.body,guestValue)));app.post(prefix+'/services/:requestId/actions',(req,reply)=>{const body=input(nativeDiningServiceActionInput,req.body,guestValue);return write(req,reply,guestValue,'service',id(req,'requestId'),body.action as 'acknowledge'|'resolve'|'cancel',body);});}
 app.get(base+'/restaurants/:id/services',(req,reply)=>read(req,reply,false,'restaurant',id(req)));
 app.post(base+'/guest/sessions/:id/tools/confirm',async(req,reply)=>{
  const body=toolConfirmInput.parse(req.body),access=await guest(req,true),proof:NativeDiningProof={id:id(req),...access,focusVersion:body.focusVersion};
  return send(req,reply,await repo.db.transaction(async()=>{
   const meta=await reception.guest(proof.id,proof.tokenHash,proof.csrfHash??null,true),actor=reception.guestActor(meta);
   if(body.focusVersion!==meta.focusVersion)throw new AppError('VERSION_CONFLICT','当前发问人已变化，请重新核对本次建议。',409);
   const action=await repo.idempotentResource(actor,{action:req.method+' '+req.url.split('?')[0],key:key(req),body,code:200},async()=>{const value=await service.confirmSuggestion(proof,body);await repo.audit(actor,meta.workspaceId,'dining.service_suggestion.confirmed',body.requestId,req.id);return value;});
   await service.hospitalityResult(action,proof);
   return reception.guestView(proof.id,proof.tokenHash,access.csrfToken);
  }));
 });
}
