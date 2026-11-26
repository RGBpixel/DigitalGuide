import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { AppError,canonical } from '@digitalguide/domain';
import { id,billReviewInput,financialConfirmInput,financialActionInput,refundReviewInput,paymentConfigInput,paymentConfigSchema,financialCallbackInput,financialFixtureInput,type FinancialReceipt,type PartyBilling } from '@digitalguide/contracts';
import type { Config } from './config.js';
import { BillingService } from './billing-service.js';
import type { BillRow } from './billing-types.js';
import type { DiningActor } from './dining-service.js';
import type { OrderRow } from './order-types.js';
import { restaurantActionContext,type RestaurantActionHelpers } from './restaurant-action-context.js';
import { orderNow,orderHash } from './order-common.js';
export function financialSignature(config:Config,timestamp:string,body:unknown){return createHmac('sha256',config.sessionSecret).update(canonical({purpose:'mock-financial-callback-v1',environment:config.providerMode,appEnv:config.appEnv,timestamp,body})).digest('hex');}
export function registerBillingRoutes(app:FastifyInstance,repo:Repository,config:Config,helpers:RestaurantActionHelpers){
 const s=new BillingService(repo,config),http=restaurantActionContext(repo,config,helpers),param=(req:FastifyRequest,key='id')=>id.parse((req.params as Record<string,string>)[key]),project=(a:DiningActor,ref:{id:string})=>s.view(a,s.bill(a,ref.id));
 for(const guest of [false,true]){
  const base=guest?'/api/v1/guest/sessions/:id/dining':'/api/v1/restaurant';
  app.get(base+'/parties/:partyId/billing',(req,reply)=>http.read(req,reply,guest,a=>{const p=s.dining.party(a,param(req,'partyId')),r=s.dining.restaurant(a,p.restaurant_id),connection=s.connection(r,a.session?undefined:a.p),result:PartyBilling={partyId:p.id,bills:repo.all<BillRow>('SELECT * FROM restaurant_bills WHERE party_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50',p.id).map(b=>s.view(a,b)),unbilledOrders:repo.all<OrderRow>('SELECT o.* FROM restaurant_orders o WHERE o.party_id=? AND NOT EXISTS (SELECT 1 FROM restaurant_bills b WHERE b.order_id=o.id) AND EXISTS (SELECT 1 FROM restaurant_order_lines l WHERE l.order_id=o.id AND l.quantity>l.cancelled_quantity) ORDER BY o.created_at DESC,o.rowid DESC',p.id).map(o=>({id:o.id,number:o.number,version:o.version,contentVersion:o.content_version,status:o.status,totalMinor:s.orders.total(o.id)})),connection:paymentConfigSchema.omit({canManage:true,scenario:true}).strip().parse(connection),automatic:!a.session||a.session.status==='active',canManage:!a.session&&s.core.can(a.p,r,true)};return result;}));
  app.post(base+'/orders/:orderId/billing/review',(req,reply)=>{const input=billReviewInput.parse(req.body),guard=(a:DiningActor)=>s.orders.order(a,param(req,'orderId'));return http.write(req,reply,guest,input.focusVersion,guard,a=>{const o=guard(a),id=s.reviewBill(a,o.id,input);return {id,restaurantId:o.restaurant_id};},project);});
  app.get(base+'/bills/:billId',(req,reply)=>http.read(req,reply,guest,a=>s.view(a,s.bill(a,param(req,'billId')))));
  app.get(base+'/bills/:billId/receipt',(req,reply)=>http.read(req,reply,guest,a=>s.receipt(a,s.bill(a,param(req,'billId')))));
  app.post(base+'/billing/confirm',(req,reply)=>{const input=financialConfirmInput.parse(req.body),guard=(a:DiningActor)=>s.bill(a,s.rawQuote(input.quoteId).bill_id);return http.write(req,reply,guest,input.focusVersion,guard,a=>{const op=s.rawOperation(s.confirm(a,input)),b=s.bill(a,op.bill_id);return {id:b.id,restaurantId:b.restaurant_id};},project);});
  app.post(base+'/financial-operations/:operationId/actions',(req,reply)=>{const input=financialActionInput.parse(req.body),guard=(a:DiningActor)=>s.operation(a,param(req,'operationId'));return http.write(req,reply,guest,input.focusVersion,guard,a=>{const op=guard(a);s.action(a,op,input);const b=s.bill(a,op.bill_id);return {id:b.id,restaurantId:b.restaurant_id};},project);});
 }
 app.post('/api/v1/restaurant/bills/:billId/refund-review',(req,reply)=>{const input=refundReviewInput.parse(req.body),guard=(a:DiningActor)=>{const b=s.bill(a,param(req,'billId'));s.core.row(a.p,b.restaurant_id,true);return b;};return http.write(req,reply,false,undefined,guard,a=>{const b=guard(a);s.reviewRefund(a,b,input);return {id:b.id,restaurantId:b.restaurant_id};},project);});
 app.get('/api/v1/restaurants/:id/payments',(req,reply)=>http.read(req,reply,false,a=>s.connection(s.core.row(a.p,param(req)),a.p)));
 app.post('/api/v1/restaurants/:id/payments',(req,reply)=>{const input=paymentConfigInput.parse(req.body),guard=(a:DiningActor)=>s.core.row(a.p,param(req),true);return http.write(req,reply,false,undefined,guard,a=>{const r=guard(a);s.configure(a.p,r,input);return {id:r.id,restaurantId:r.id};},(a,ref)=>s.connection(s.core.row(a.p,ref.id,true),a.p));});
 app.post('/api/v1/restaurant/financial-operations/:operationId/mock-result',(req,reply)=>{
  const input=financialFixtureInput.parse(req.body),guard=(a:DiningActor)=>{const op=s.operation(a,param(req,'operationId')),b=s.bill(a,op.bill_id);s.core.row(a.p,b.restaurant_id,true);if(config.providerMode!=='mock'||config.appEnv==='production'||!op.simulated)throw new AppError('MOCK_DISABLED','当前环境不接受模拟资金结果。',409);return op;};
  return http.write(req,reply,false,undefined,guard,a=>{const op=guard(a),b=s.bill(a,op.bill_id);s.core.version(op,input.version);if(op.status!=='unknown'||!op.send_attempts||op.lease_token)throw new AppError('MOCK_FINANCIAL_RESULT_UNAVAILABLE','仅为已发送、未知且当前未处理中的模拟请求建立测试事实。',409);
   const old=repo.get<{status:string;sequence:number}>('SELECT * FROM mock_financial_operations WHERE operation_id=?',op.id);if(old&&old.status!=='pending'&&old.status!==input.status)throw new AppError('MOCK_REMOTE_ALREADY_FINAL','模拟远端已有最终事实，不能覆盖为相反结果。',409);
   const request=JSON.parse(op.request_payload),remoteOperationId=(op.kind==='payment'?'mock-pay:':'mock-refund:')+op.id,remoteTransactionId=(op.kind==='payment'?'mock-charge:':'mock-refund-tx:')+op.id,sequence=Math.max(op.last_sequence+1,(old?.sequence||0)+1,input.status==='pending'?1:2);
   if(old)repo.run('UPDATE mock_financial_operations SET status=?,sequence=?,updated_at=? WHERE operation_id=?',input.status,sequence,orderNow(),op.id);else repo.run('INSERT INTO mock_financial_operations VALUES (?,?,?,?,?,?,?,?,?)',op.id,op.request_hash,op.request_payload,remoteOperationId,remoteTransactionId,input.status,sequence,orderNow(),orderNow());
   const receipt:FinancialReceipt={operationId:op.id,kind:op.kind,requestHash:op.request_hash,restaurantId:b.restaurant_id,billId:b.id,merchantId:op.merchant_id,amountMinor:op.amount_minor,currency:request.currency,remoteOperationId,remoteTransactionId,status:input.status,sequence,simulated:true};s.applyReceipt(receipt,randomUUID(),orderHash(receipt));return {id:b.id,restaurantId:b.restaurant_id};},project);
 });
 app.post('/api/v1/webhooks/mock-payments',(req,reply)=>{
  if(config.providerMode!=='mock'||config.appEnv==='production')throw new AppError('MOCK_DISABLED','当前环境不接受模拟资金回调。',403);
  const timestamp=String(req.headers['x-payment-timestamp']||''),signature=String(req.headers['x-payment-signature']||''),expected=financialSignature(config,timestamp,req.body),time=Date.parse(timestamp);
  if(!Number.isFinite(time)||Math.abs(Date.now()-time)>300000||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new AppError('PAYMENT_SIGNATURE_INVALID','支付回执签名或时间窗口不正确，未入账。',401);
  const body=financialCallbackInput.parse(req.body);return http.send(req,reply,repo.transaction(()=>{const result=s.applyReceipt(body.receipt,body.eventId,orderHash(body.receipt)),b=s.raw(s.rawOperation(body.receipt.operationId).bill_id),r=s.core.raw(b.restaurant_id);repo.audit({tenantId:r.tenant_id,workspaceIds:[r.workspace_id],userId:'provider:mock-payments',role:'viewer'},r.workspace_id,'financial.callback',body.receipt.operationId,req.id);return result;}));
 });
}
