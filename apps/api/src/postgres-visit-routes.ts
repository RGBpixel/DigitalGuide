import {timingSafeEqual,randomUUID} from 'node:crypto';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {AppError,requirePermission} from '@digitalguide/domain';
import {visitDraftInput,visitConfirmInput,visitNotifyInput,visitGuestControlInput,visitEraseInput,visitManageInput,hostResponseInput,mockNotificationInput,mockReceiptInput,listInput} from '@digitalguide/contracts';
import {NativeReception,nativeReceptionCookieName} from '../../../packages/postgres/src/runtime-reception.js';
import {NativeVisits} from '../../../packages/postgres/src/runtime-visits.js';
import type {RouteContext} from './postgres-asset-routes.js';
import type {Config} from './config.js';
export function registerNativeVisitRoutes(context:RouteContext,config:Config){
 const{app,repo,authenticated}=context,reception=new NativeReception(repo),visits=new NativeVisits(repo,config.sessionSecret),runtimeId=config.nativePostgres!.runtimeId,cookieName=nativeReceptionCookieName(runtimeId),base='/api/v1/guest/sessions/:id/visit',id=(req:FastifyRequest)=>z.uuid().parse((req.params as{id:string}).id),key=(req:FastifyRequest)=>z.string().min(8).max(128).parse(req.headers['idempotency-key']),send=(req:FastifyRequest,reply:FastifyReply,value:unknown)=>context.send(req,reply.header('Cache-Control','private, no-store'),value);
 function credentials(req:FastifyRequest,write=false){const proof=reception.credentials(config.sessionSecret,runtimeId,id(req),req.cookies[cookieName]);if(write){const header=req.headers['x-csrf-token'];if(typeof header!=='string'||Buffer.byteLength(header)!==Buffer.byteLength(proof.csrfToken)||!timingSafeEqual(Buffer.from(header),Buffer.from(proof.csrfToken)))throw new AppError('FORBIDDEN','访客安全凭证已失效，请刷新终端。',403);}return proof;}
 async function prepare(req:FastifyRequest,write=false){const proof=credentials(req,write);await repo.db.transaction(()=>reception.guest(id(req),proof.tokenHash,null));await repo.db.transaction(()=>reception.sweep());await repo.db.transaction(()=>visits.sweep());return proof;}
 app.get(base,async(req,reply)=>{const proof=await prepare(req);return send(req,reply,await repo.db.transaction(async()=>{await reception.guest(id(req),proof.tokenHash,null);return visits.view(id(req),proof.tokenHash);}));});
 app.get(base+'/export',async(req,reply)=>{const proof=await prepare(req);return send(req,reply,await repo.db.transaction(async()=>{const meta=await reception.guest(id(req),proof.tokenHash,null),view=await visits.view(id(req),proof.tokenHash);await repo.audit(reception.guestActor(meta),meta.workspaceId,'visit.export_self',meta.id,req.id);return{schemaVersion:1,exportedAt:await repo.db.now(),visit:view.visit,privacyReceipt:view.privacyReceipt??null,exclusions:['受访人内部备注','其他人员资料','登录凭据']};}));});
 for(const[suffix,schema,action]of [['',visitDraftInput,'draft'],['/confirm',visitConfirmInput,'confirm'],['/notify',visitNotifyInput,'notify'],['/control',visitGuestControlInput,'control'],['/erase',visitEraseInput,'erase']]as const)app.post(base+suffix,async(req,reply)=>{
  const b=schema.parse(req.body),proof=await prepare(req,true);return send(req,reply,await repo.db.transaction(async()=>{const hint=await visits.prelock(id(req),proof.tokenHash,'hostName'in b?b.hostName:null),meta=await reception.guest(id(req),proof.tokenHash,proof.csrfHash,true);if(b.focusVersion!==meta.focusVersion||(meta.status!=='active'&&action!=='erase'))throw new AppError('VERSION_CONFLICT','当前服务对象已变化，请重新核对或请求人工接待。',409);const actor=reception.guestActor(meta);await repo.idempotentResource(actor,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:b,code:200},async()=>{const result=await visits.apply(id(req),proof.tokenHash,proof.csrfHash,action,b,hint);await repo.audit(actor,meta.workspaceId,'visit.'+action,result,req.id);return result;});return visits.view(id(req),proof.tokenHash);}));
 });
 for(const ownOnly of [false,true])app.get('/api/v1/visits'+(ownOnly?'/inbox':''),async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>{requirePermission(p,ownOnly?'visit.respond':'visit.manage');await visits.sweep();const q=listInput.parse(req.query);if(q.cursor)z.uuid().parse(q.cursor);const rows=await visits.staffList(p,q.workspaceId?[q.workspaceId]:p.workspaceIds,q.cursor??'',q.limit+1,ownOnly);return{items:rows.slice(0,q.limit),nextCursor:rows.length>q.limit?rows[q.limit-1].id:null};})));
 for(const[suffix,schema,action]of [['respond',hostResponseInput,'respond'],['control',visitManageInput,'control'],['mock-notification',mockNotificationInput,'scenario']]as const){
  app.post('/api/v1/visits/:id/'+suffix,async(req,reply)=>{
   const b=schema.parse(req.body);
   const value=await authenticated(req,async({principal:p})=>{
    requirePermission(p,action==='respond'?'visit.respond':'visit.manage');
    await visits.sweep();
    const workspace=await visits.staffScope(p,id(req),action==='respond',true);
    const result=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:b,code:200},async()=>{
     const value=await visits.staffApply(p,id(req),action,b);
     await repo.audit(p,workspace,'visit.'+action,value,req.id);
     return value;
    });
    return visits.staffView(p,result,action==='respond');
   });
   return send(req,reply,value);
  });
 }
 app.post('/api/v1/visits/:id/mock-receipt',async(req,reply)=>{
  const input=mockReceiptInput.parse(req.body);
  const value=await authenticated(req,async({principal:p})=>{
   requirePermission(p,'visit.manage');const workspace=await visits.staffScope(p,id(req),false,true);
   const resource=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:input,code:200},async()=>{
    const current=await visits.staffView(p,id(req));
    if(!current.delivery||current.delivery.channel!=='mock'||current.delivery.version!==input.version)throw new AppError('VERSION_CONFLICT','投递已变化或不是模拟渠道，请刷新后重试。',409);
    const event={eventId:randomUUID(),deliveryId:current.delivery.id,environment:'mock',schemaVersion:1,status:input.status,occurredAt:await repo.db.now()};
    await visits.receipt(event,visits.receiptSignature(event));await repo.audit(p,workspace,'visit.mock_receipt',id(req),req.id);return id(req);
   });return visits.staffView(p,resource);
  });return send(req,reply,value);
 });
 app.post('/api/v1/webhooks/mock-notification',async(req,reply)=>send(req,reply,await repo.db.transaction(()=>visits.receipt(req.body,req.headers['x-dg-signature']))));
}
