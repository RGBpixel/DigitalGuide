import {createHmac,timingSafeEqual} from 'node:crypto';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {AppError,canonical} from '@digitalguide/domain';
import {orderChangeInput,orderChangeUpdateInput,orderReviewInput,orderConfirmInput,orderSubmitInput,orderVersionInput,orderQueryInput,orderControlInput,posConfigInput,posFixtureInput,posCallbackInput} from '@digitalguide/contracts';
import {NativeOrders,type NativeOrderKind} from '../../../packages/postgres/src/runtime-orders.js';
import {type NativeDiningProof} from '../../../packages/postgres/src/runtime-dining.js';
import {NativeReception,nativeReceptionCookieName} from '../../../packages/postgres/src/runtime-reception.js';
import type {RouteContext} from './postgres-asset-routes.js';
import type {Config} from './config.js';

export function nativePOSSignature(config:Config,timestamp:string,body:unknown){return createHmac('sha256',config.sessionSecret).update(canonical({purpose:'native-pos-callback-v1',runtimeId:config.nativePostgres!.runtimeId,providerId:'mock-pos',appEnv:config.appEnv,timestamp,body})).digest('hex');}

export function registerNativeOrderRoutes(context:RouteContext,config:Config){
 const{app,repo,authenticated}=context,orders=new NativeOrders(repo,config.sessionSecret),reception=new NativeReception(repo),base='/api/v1',cookieName=nativeReceptionCookieName(config.nativePostgres!.runtimeId);
 const id=(req:FastifyRequest,name='id')=>z.uuid().parse((req.params as Record<string,string>)[name]),key=(req:FastifyRequest)=>z.string().min(8).max(128).parse(req.headers['idempotency-key']),send=(req:FastifyRequest,reply:FastifyReply,value:unknown)=>context.send(req,reply.header('Cache-Control','private, no-store'),value);
 async function staffSweep(req:FastifyRequest,kind:NativeOrderKind,target:string){const meta=await authenticated(req,({principal:p})=>orders.prepareOrder(p,kind,target));await repo.db.transaction(()=>orders.sweep(meta.restaurantId));}
 async function guest(req:FastifyRequest,write=false){
  const proof=reception.credentials(config.sessionSecret,config.nativePostgres!.runtimeId,id(req),req.cookies[cookieName]);
  if(write){const csrf=req.headers['x-csrf-token'];if(typeof csrf!=='string'||Buffer.byteLength(csrf)!==Buffer.byteLength(proof.csrfToken)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(proof.csrfToken)))throw new AppError('FORBIDDEN','访客安全凭证已失效，请刷新当前终端。',403);}
  const meta=await repo.db.transaction(()=>reception.guest(id(req),proof.tokenHash,null));if(meta.serviceScene!=='restaurant'||!meta.restaurantId)throw new AppError('NOT_FOUND','本次接待不是餐厅顾客终端。',404);
  await repo.db.transaction(()=>reception.sweep());await repo.db.transaction(()=>orders.sweep(meta.restaurantId!));return proof;
 }
 function guestInput(schema:z.ZodType,raw:unknown):Record<string,unknown>{const outer=z.record(z.string(),z.unknown()).parse(raw),{selectionVersion,...rest}=outer;return{...schema.parse(rest) as Record<string,unknown>,focusVersion:z.int().nonnegative().parse(rest.focusVersion),selectionVersion:z.int().nonnegative().parse(selectionVersion)};}
 for(const isGuest of [false,true]){
  const party=isGuest?'/guest/sessions/:id/dining/parties/:partyId':'/restaurant/parties/:partyId',change=isGuest?'/guest/sessions/:id/dining/changes/:changeId':'/restaurant/order-changes/:changeId',order=isGuest?'/guest/sessions/:id/dining/orders/:orderId':'/restaurant/orders/:orderId';
  app.get(base+party+'/order-history',async(req,reply)=>{const target=id(req,'partyId');if(!isGuest){await staffSweep(req,'party',target);return send(req,reply,await authenticated(req,async({principal:p})=>{await orders.prepareOrder(p,'party',target);return orders.history(target);}));}const proof=await guest(req);return send(req,reply,await repo.db.transaction(()=>orders.history(target,{id:id(req),tokenHash:proof.tokenHash})));});
  for(const[path,kind,reference]of [[party+'/orders','party','partyId'],[order,'order','orderId']] as const)app.get(base+path,async(req,reply)=>{
   const target=id(req,reference);if(!isGuest){await staffSweep(req,kind,target);return send(req,reply,await authenticated(req,async({principal:p})=>{await orders.prepareOrder(p,kind,target);return orders.orderRead(kind,target);}));}
   const proof=await guest(req);return send(req,reply,await repo.db.transaction(()=>orders.orderRead(kind,target,{id:id(req),tokenHash:proof.tokenHash})));
  });
  type WriteSpec=[string,z.ZodType,NativeOrderKind,string,'draft'|'update'|'review'|'confirm'|'submit'|'withdraw'|'query'|'control'];
  const specs:WriteSpec[]=[[party+'/orders',orderChangeInput,'party','partyId','draft'],[order+'/control',orderControlInput,'order','orderId','control'],...[['update',orderChangeUpdateInput],['review',orderReviewInput],['confirm',orderConfirmInput],['submit',orderSubmitInput],['withdraw',orderVersionInput],['query',orderQueryInput]].map(([action,schema])=>[change+'/'+action,schema,'change','changeId',action] as WriteSpec)];
  for(const[path,schema,kind,reference,action]of specs)app.post(base+path,async(req,reply)=>{
   const input=isGuest?guestInput(schema,req.body):schema.parse(req.body) as Record<string,unknown>,target=id(req,reference);
   if(!isGuest){await staffSweep(req,kind,target);return send(req,reply,await authenticated(req,async({principal:p})=>{await orders.prepareOrder(p,kind,target,true);const operation=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:input,code:200},()=>orders.applyOrder(kind,target,action,input));return orders.orderResult(operation);}));}
   const credentials=await guest(req,true),proof:NativeDiningProof={id:id(req),tokenHash:credentials.tokenHash,csrfHash:credentials.csrfHash,focusVersion:input.focusVersion as number};
   return send(req,reply,await repo.db.transaction(async()=>{const meta=await reception.guest(id(req),credentials.tokenHash,credentials.csrfHash,true);if(meta.status!=='active'||meta.focusVersion!==input.focusVersion)throw new AppError('VERSION_CONFLICT','当前发问人或接待状态已变化，请重新核对。',409);const current=await orders.orderContext(kind,target,proof,true);if(current.selectionVersion!==input.selectionVersion)throw new AppError('VERSION_CONFLICT','当前就餐选择已变化，请重新核对。',409);const operation=await repo.idempotentResource(reception.guestActor(meta),{action:req.method+' '+req.url.split('?')[0],key:key(req),body:input,code:200},()=>orders.applyOrder(kind,target,action,input,proof));return orders.orderResult(operation,proof);}));
  });
 }
 app.post(base+'/restaurant/order-changes/:changeId/mock-result',async(req,reply)=>{const input=posFixtureInput.parse(req.body),target=id(req,'changeId');await staffSweep(req,'change',target);return send(req,reply,await authenticated(req,async({principal:p})=>{await orders.prepareOrder(p,'change',target,true);const operation=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:input,code:200},()=>orders.mockResult(target,input));return orders.orderResult(operation);}));});
 app.post(base+'/webhooks/mock-pos',async(req,reply)=>{const body=posCallbackInput.parse(req.body),timestamp=z.iso.datetime().parse(req.headers['x-pos-timestamp']),signature=z.string().regex(/^[a-f0-9]{64}$/).parse(req.headers['x-pos-signature']),expected=nativePOSSignature(config,timestamp,body);if(Math.abs(Date.now()-Date.parse(timestamp))>300000||!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex')))throw new AppError('POS_CALLBACK_AUTH','POS回执签名或时间窗口无效，请核对原回调配置。',401);return send(req,reply,await repo.db.transaction(()=>orders.call('dg_native_order_receipt_apply',[body.eventId,body.receipt,'callback'])));});
 app.get(base+'/restaurants/:id/pos',async(req,reply)=>{await staffSweep(req,'restaurant',id(req));return send(req,reply,await authenticated(req,async({principal:p})=>{await orders.prepareOrder(p,'restaurant',id(req));return orders.orderRead('restaurant',id(req));}));});
 app.post(base+'/restaurants/:id/pos',async(req,reply)=>{const input=posConfigInput.parse(req.body);await staffSweep(req,'restaurant',id(req));return send(req,reply,await authenticated(req,async({principal:p})=>{await orders.prepareOrder(p,'restaurant',id(req),true);const operation=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:input,code:200},()=>orders.applyOrder('restaurant',id(req),'config',input));return orders.orderResult(operation);}));});
}
