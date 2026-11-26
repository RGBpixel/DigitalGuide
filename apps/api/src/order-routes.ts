import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import type { FastifyInstance,FastifyReply,FastifyRequest } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { AppError,canonical } from '@digitalguide/domain';
import { id,orderChangeInput,orderChangeUpdateInput,orderReviewInput,orderConfirmInput,orderSubmitInput,orderVersionInput,orderQueryInput,orderControlInput,posConfigInput,posConfigSchema,posFixtureInput,posCallbackInput,kitchenEventInput } from '@digitalguide/contracts';
import type { Config } from './config.js';
import { authenticatedSession } from './auth-check.js';
import { executeIdempotent } from './idempotency.js';
import type { SessionRow } from './reception-service.js';
import type { DiningActor } from './dining-service.js';
import type { KitchenRow } from './order-types.js';
import { OrderService } from './order-service.js';
import { kitchenRestaurants,kitchenView,kitchenEvent } from './order-views.js';
import { orderHash,orderNow } from './order-common.js';
interface Helpers {guest(req:FastifyRequest):SessionRow;expire():unknown}
export function posSignature(config:Config,timestamp:string,body:unknown){return createHmac('sha256',config.sessionSecret).update(canonical({purpose:'mock-pos-callback-v1',environment:config.providerMode,appEnv:config.appEnv,timestamp,body})).digest('hex');}
export function registerOrderRoutes(app:FastifyInstance,repo:Repository,config:Config,helpers:Helpers){
 const s=new OrderService(repo,config),param=(req:FastifyRequest,key='id')=>id.parse((req.params as Record<string,string>)[key]),send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.send({data,requestId:req.id});
 const staff=(req:FastifyRequest)=>authenticatedSession(repo,req,config).principal;
 const actor=(req:FastifyRequest,guest:boolean,focusVersion?:number,write=false):DiningActor=>{if(!guest)return {p:staff(req)};const session=helpers.guest(req),a:DiningActor={session,p:{userId:'guest:'+session.id,tenantId:session.tenant_id,workspaceIds:[session.workspace_id],role:'viewer'}};s.core.guest(session);if(write)s.dining.focus(a,focusVersion);return a;};
 function write(req:FastifyRequest,reply:FastifyReply,guest:boolean,focusVersion:number|undefined,guard:(a:DiningActor)=>unknown,work:(a:DiningActor)=>{id:string;restaurantId:string},project:(a:DiningActor,ref:{id:string;restaurantId:string})=>unknown){
  helpers.expire();repo.transaction(()=>guard(actor(req,guest,focusVersion,true)));const first=actor(req,guest,focusVersion,true);
  const result=executeIdempotent(repo,req,first.p.tenantId,first.p.userId,()=>{const a=actor(req,guest,focusVersion,true);guard(a);const ref=work(a),r=s.core.raw(ref.restaurantId);repo.audit(a.p,r.workspace_id,'orders.'+req.routeOptions.url,ref.id,req.id);return ref;});
  return send(req,reply,repo.transaction(()=>{const a=actor(req,guest,focusVersion,true);guard(a);return project(a,result.data);}));
 }
 for(const guest of [false,true]){
  const base=guest?'/api/v1/guest/sessions/:id/dining/parties/:partyId':'/api/v1/restaurant/parties/:partyId';
  app.get(base+'/orders',(req,reply)=>{helpers.expire();return send(req,reply,repo.transaction(()=>{const a=actor(req,guest),p=s.dining.party(a,param(req,'partyId')),r=s.dining.restaurant(a,p.restaurant_id),o=s.current(a,p.id)||repo.get<import('./order-types.js').OrderRow>('SELECT * FROM restaurant_orders WHERE party_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',p.id),connection=s.connection(r,a.session?undefined:a.p),publicConnection=posConfigSchema.omit({canManage:true,scenario:true}).strip().parse(connection);return guest?{partyId:p.id,order:o?s.view(a,o):null,connection:publicConnection,automatic:a.session!.status==='active'}:{order:o?s.view(a,o):null,connection};}));});
  app.post(base+'/orders',(req,reply)=>{const input=orderChangeInput.parse(req.body),guard=(a:DiningActor)=>s.dining.party(a,param(req,'partyId'));return write(req,reply,guest,input.focusVersion,guard,a=>{const c=s.createChange(a,param(req,'partyId'),input);return {id:s.rawChange(c).order_id,restaurantId:guard(a).restaurant_id};},(a,ref)=>s.view(a,s.order(a,ref.id)));});
  const changes=guest?'/api/v1/guest/sessions/:id/dining/changes/:changeId':'/api/v1/restaurant/order-changes/:changeId';
  for(const action of ['update','review','confirm','submit','withdraw','query'] as const)app.post(changes+'/'+action,(req,reply)=>{
   const schema=action==='update'?orderChangeUpdateInput:action==='review'?orderReviewInput:action==='confirm'?orderConfirmInput:action==='submit'?orderSubmitInput:action==='withdraw'?orderVersionInput:orderQueryInput,input=schema.parse(req.body),guard=(a:DiningActor)=>s.change(a,param(req,'changeId'));
   return write(req,reply,guest,input.focusVersion,guard,a=>{const c=guard(a);if(action==='update')s.updateChange(a,c,input);else if(action==='review')s.review(a,c,input.version);else if(action==='confirm')s.confirm(a,c,input);else if(action==='submit')s.submit(a,c,input);else if(action==='withdraw')s.withdraw(a,c,input.version);else{const d=s.dispatch(c.id);s.core.version(d,input.version);if(!['unknown','submitted'].includes(d.status))throw new AppError('POS_QUERY_UNAVAILABLE','只有已发送待核实的请求可查询；不会另发新单。',409);repo.run('UPDATE restaurant_order_dispatches SET query_requested=1,version=version+1,updated_at=? WHERE change_id=?',orderNow(),c.id);const o=s.order(a,c.order_id);s.event(o,a.p.userId,'query_requested','已请求核对同一远端请求，没有重新派单。',c.id);}
    const o=s.order(a,c.order_id);return {id:o.id,restaurantId:o.restaurant_id};},(a,ref)=>s.view(a,s.order(a,ref.id)));
  });
  const orderBase=guest?'/api/v1/guest/sessions/:id/dining/orders/:orderId':'/api/v1/restaurant/orders/:orderId';
  app.get(orderBase,(req,reply)=>{helpers.expire();return send(req,reply,repo.transaction(()=>{const a=actor(req,guest);return s.view(a,s.order(a,param(req,'orderId')));}));});
  app.post(orderBase+'/control',(req,reply)=>{const input=orderControlInput.parse(req.body),guard=(a:DiningActor)=>s.order(a,param(req,'orderId'));return write(req,reply,guest,input.focusVersion,guard,a=>{const o=guard(a);s.control(a,o,input.version,input.action,input.reason);return {id:o.id,restaurantId:o.restaurant_id};},(a,ref)=>s.view(a,s.order(a,ref.id)));});
 }
 app.get('/api/v1/restaurants/:id/pos',(req,reply)=>send(req,reply,repo.transaction(()=>{const p=staff(req);return s.connection(s.core.row(p,param(req)),p);})));
 app.post('/api/v1/restaurants/:id/pos',(req,reply)=>{const input=posConfigInput.parse(req.body),guard=(a:DiningActor)=>s.core.row(a.p,param(req),true);return write(req,reply,false,undefined,guard,a=>{const r=guard(a);s.configure(a.p,r,input);return {id:r.id,restaurantId:r.id};},(a,ref)=>s.connection(s.core.row(a.p,ref.id,true),a.p));});
 app.get('/api/v1/kitchen/restaurants',(req,reply)=>send(req,reply,repo.transaction(()=>kitchenRestaurants(s,staff(req)))));
 app.get('/api/v1/restaurant/skus/:id/order-stock-history',(req,reply)=>send(req,reply,repo.transaction(()=>{
  const sku=repo.get<{restaurant_id:string}>('SELECT restaurant_id FROM restaurant_menu_skus WHERE id=?',param(req));if(!sku)throw new AppError('NOT_FOUND','规格不存在。',404);s.core.row(staff(req),sku.restaurant_id,true);
  return repo.all<{id:string;change_id:string;number:string;kind:string;before_quantity:number;after_quantity:number;created_at:string}>('SELECT m.*,o.number FROM restaurant_stock_movements m JOIN restaurant_order_changes c ON c.id=m.change_id JOIN restaurant_orders o ON o.id=c.order_id WHERE m.sku_id=? ORDER BY m.created_at DESC,m.rowid DESC LIMIT 100',param(req)).map(m=>({id:m.id,changeId:m.change_id,orderNumber:m.number,kind:m.kind,beforeQuantity:m.before_quantity,afterQuantity:m.after_quantity,createdAt:m.created_at}));
 })));
 app.get('/api/v1/kitchen/restaurants/:id/tickets',(req,reply)=>send(req,reply,repo.transaction(()=>{const p=staff(req),r=s.kitchenRestaurant(p,param(req));return repo.all<KitchenRow>('SELECT * FROM restaurant_kitchen_tickets WHERE restaurant_id=? ORDER BY accepted_at DESC,rowid DESC LIMIT 200',r.id).map(t=>kitchenView(s,p,t));})));
 app.post('/api/v1/kitchen/tickets/:id/events',(req,reply)=>{
  const input=kitchenEventInput.parse(req.body),guard=(a:DiningActor)=>{const t=repo.get<KitchenRow>('SELECT * FROM restaurant_kitchen_tickets WHERE id=?',param(req));if(!t)throw new AppError('NOT_FOUND','制作单不存在。',404);s.kitchenRestaurant(a.p,t.restaurant_id,input.action==='serve'?'serve':'cook');return t;};
  return write(req,reply,false,undefined,guard,a=>{const t=guard(a);kitchenEvent(s,a.p,t.id,input);return {id:t.id,restaurantId:t.restaurant_id};},(a,ref)=>kitchenView(s,a.p,repo.get<KitchenRow>('SELECT * FROM restaurant_kitchen_tickets WHERE id=?',ref.id)!));
 });
 app.post('/api/v1/restaurant/order-changes/:changeId/mock-result',(req,reply)=>{
  const input=posFixtureInput.parse(req.body),guard=(a:DiningActor)=>{const c=s.change(a,param(req,'changeId'));s.core.row(a.p,s.raw(c.order_id).restaurant_id,true);if(config.providerMode!=='mock'||config.appEnv==='production')throw new AppError('MOCK_DISABLED','当前环境不提供模拟远端结果。',409);return c;};
  return write(req,reply,false,undefined,guard,a=>{const c=guard(a),o=s.raw(c.order_id),d=s.dispatch(c.id);s.core.version(d,input.version);if(d.status!=='unknown'||d.provider_id!=='mock-pos'||!d.attempts)throw new AppError('MOCK_RESULT_UNAVAILABLE','仅可为本地已发送但尚无结果的模拟请求建立测试回执。',409);
   const old=repo.get<{outcome:string}>('SELECT * FROM mock_pos_operations WHERE change_id=?',c.id);if(old&&old.outcome!==input.outcome)throw new AppError('MOCK_RESULT_EXISTS','已有模拟远端事实，不能覆盖为相反结果。',409);
   const request=JSON.parse(d.request_payload),remoteRequestId='mock-pos:'+c.id,remoteOrderId=request.remoteOrderId||'mock-order:'+o.id,sequence=Math.max(2,d.last_sequence+1);
   if(!old)repo.run('INSERT INTO mock_pos_operations VALUES (?,?,?,?,?,?,?,?,?)',c.id,o.restaurant_id,d.request_hash,d.request_payload,remoteRequestId,remoteOrderId,input.outcome,sequence,orderNow());
   const receipt={requestId:c.id,requestHash:d.request_hash,restaurantId:o.restaurant_id,remoteRequestId,remoteOrderId,status:input.outcome,sequence,simulated:true,reasonCode:null};s.applyReceipt(receipt,randomUUID(),orderHash(receipt));return {id:o.id,restaurantId:o.restaurant_id};},(a,ref)=>s.view(a,s.order(a,ref.id)));
 });
 app.post('/api/v1/webhooks/mock-pos',(req,reply)=>{
  if(config.providerMode!=='mock'||config.appEnv==='production')throw new AppError('MOCK_DISABLED','此环境不接受模拟POS回执。',403);
  const timestamp=String(req.headers['x-pos-timestamp']||''),signature=String(req.headers['x-pos-signature']||''),ms=Date.parse(timestamp),expected=posSignature(config,timestamp,req.body);
  if(!Number.isFinite(ms)||Math.abs(Date.now()-ms)>300000||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new AppError('POS_SIGNATURE_INVALID','POS回执签名或时间窗口无效。',401);
  const body=posCallbackInput.parse(req.body);return send(req,reply,repo.transaction(()=>s.applyReceipt(body.receipt,body.eventId,orderHash(body.receipt))));
 });
}
