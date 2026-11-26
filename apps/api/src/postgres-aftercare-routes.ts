import {timingSafeEqual} from 'node:crypto';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {AppError} from '@digitalguide/domain';
import {nativeAftercareFeedbackInput,nativeAftercareFollowupInput,nativeAftercareRevokeInput,aftercareManagementInput} from '@digitalguide/contracts';
import {NativeAftercare} from '../../../packages/postgres/src/runtime-aftercare.js';
import type {AftercareKind} from '../../../packages/postgres/src/aftercare-crypto.js';
import {NativeReception,nativeReceptionCookieName} from '../../../packages/postgres/src/runtime-reception.js';
import type {NativeDiningProof} from '../../../packages/postgres/src/runtime-dining.js';
import type {RouteContext} from './postgres-asset-routes.js';
import type {Config} from './config.js';

export function registerNativeAftercareRoutes(context:RouteContext,config:Config){
 const{app,repo,authenticated}=context,service=new NativeAftercare(repo,config.sessionSecret),reception=new NativeReception(repo),cookieName=nativeReceptionCookieName(config.nativePostgres!.runtimeId),base='/api/v1';
 const id=(req:FastifyRequest,name='id')=>z.uuid().parse((req.params as Record<string,string>)[name]),key=(req:FastifyRequest)=>z.string().min(8).max(128).parse(req.headers['idempotency-key']),send=(req:FastifyRequest,reply:FastifyReply,value:unknown)=>context.send(req,reply.header('Cache-Control','private, no-store'),value);
 async function guest(req:FastifyRequest,write=false){
  const proof=reception.credentials(config.sessionSecret,config.nativePostgres!.runtimeId,id(req),req.cookies[cookieName]);
  if(write){const csrf=req.headers['x-csrf-token'];if(typeof csrf!=='string'||Buffer.byteLength(csrf)!==Buffer.byteLength(proof.csrfToken)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(proof.csrfToken)))throw new AppError('FORBIDDEN','本次终端安全凭证已变化，请刷新后重新核对。',403);}
  const meta=await repo.db.transaction(()=>reception.guest(id(req),proof.tokenHash,null));if(meta.serviceScene!=='restaurant'||!meta.restaurantId)throw new AppError('NOT_FOUND','请从本人的餐厅终端查看餐后记录。',404);
  await repo.db.transaction(()=>reception.sweep());await repo.db.transaction(()=>service.sweep(meta.restaurantId!));await repo.db.transaction(()=>service.sweepAftercare(meta.restaurantId!));return proof;
 }
 function input(schema:z.ZodType,raw:unknown){const outer=z.record(z.string(),z.unknown()).parse(raw),{selectionVersion,...rest}=outer;return{...schema.parse(rest) as Record<string,unknown>,focusVersion:z.int().nonnegative().parse(rest.focusVersion),selectionVersion:z.int().nonnegative().parse(selectionVersion)};}
 async function read(req:FastifyRequest,reply:FastifyReply,guestValue:boolean,board=false){
  if(guestValue){const proof=await guest(req);return send(req,reply,await repo.db.transaction(()=>service.aftercare(id(req,'partyId'),{id:id(req),...proof})));}
  const target=id(req,board?'id':'partyId'),kind=board?'restaurant':'party',meta=await authenticated(req,({principal:p})=>service.prepareHospitality(p,kind,target));await repo.db.transaction(()=>service.sweepAftercare(meta.restaurantId));
  return send(req,reply,await authenticated(req,async({principal:p})=>{await service.prepareHospitality(p,kind,target);return board?service.aftercareBoard(target):service.aftercare(target);}));
 }
 async function write(req:FastifyRequest,reply:FastifyReply,kind:AftercareKind,operation:'save'|'revoke',body:Record<string,unknown>){
  const access=await guest(req,true),proof:NativeDiningProof={id:id(req),...access,focusVersion:body.focusVersion as number},partyId=id(req,'partyId');
  return send(req,reply,await repo.db.transaction(async()=>{const meta=await reception.guest(proof.id,proof.tokenHash,proof.csrfHash??null,true),actor=reception.guestActor(meta);await service.aftercareContext(partyId,proof,true,body.selectionVersion as number);const action=await repo.idempotentResource(actor,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:service.sanitized(kind,operation,partyId,body),code:200},()=>service.applyAftercare(partyId,kind,operation,body,proof));return service.aftercareResult(action,proof);}));
 }
 for(const guestValue of [false,true])app.get((guestValue?base+'/guest/sessions/:id/dining':base+'/restaurant')+'/parties/:partyId/aftercare',(req,reply)=>read(req,reply,guestValue));
 for(const suffix of ['feedback','followup','feedback/revoke','followup/revoke'])app.post(base+'/restaurant/parties/:partyId/'+suffix,async req=>authenticated(req,async({principal:p})=>{await service.prepareHospitality(p,'party',id(req,'partyId'));throw new AppError('FORBIDDEN','员工不能代替本人提交评价、授权或撤回；请使用本人的当前终端或仅清除凭证。',403);}));
 app.get(base+'/restaurants/:id/aftercare',(req,reply)=>read(req,reply,false,true));
 const party=base+'/guest/sessions/:id/dining/parties/:partyId';
 for(const[kind,schema]of [['feedback',nativeAftercareFeedbackInput],['followup',nativeAftercareFollowupInput]] as const){app.post(party+'/'+kind,(req,reply)=>write(req,reply,kind,'save',input(schema,req.body)));app.post(party+'/'+kind+'/revoke',(req,reply)=>write(req,reply,kind,'revoke',input(nativeAftercareRevokeInput,req.body)));}
 // This capability only erases one named record. It does not use a login cookie or grant any business right.
 app.post(base+'/restaurant/aftercare/manage',{bodyLimit:1024},async(req,reply)=>{if(!await repo.db.transaction(()=>service.attemptManagement(req.ip)))throw new AppError('RATE_LIMITED','本人凭证核对次数较多，请一分钟后再试。',429);const body=aftercareManagementInput.parse(req.body);return send(req,reply,await repo.db.transaction(()=>service.manageAftercare(body.code)));});
}
