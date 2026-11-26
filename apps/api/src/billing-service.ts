import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError,type Principal } from '@digitalguide/domain';
import { financialRequestSchema,type PaymentConfig,type Bill,type FinancialQuote,type FinancialOperation,type FinancialReceipt } from '@digitalguide/contracts';
import { selectPaymentProvider,FinancialFailure,type MockFinancialRecord } from '@digitalguide/providers';
import type { Config } from './config.js';
import type { DiningActor } from './dining-service.js';
import type { RestaurantRow } from './restaurant-service.js';
import { OrderService } from './order-service.js';
import { orderNow } from './order-common.js';
import { invalidateDiningReplies } from './restaurant-state.js';
import type { BillRow,FinancialConfigRow,FinancialOperationRow,FinancialPosting,FinancialQuoteRow } from './billing-types.js';
import * as review from './billing-review.js';
import * as operations from './billing-operations.js';
import * as views from './billing-views.js';
import { applyFinancialReceipt } from './billing-receipts.js';

export class BillingService {
 orders:OrderService;
 constructor(public repo:Repository,public config:Config){this.orders=new OrderService(repo,config);}
 get dining(){return this.orders.dining;}get core(){return this.orders.core;}
 raw(id:string){const b=this.repo.get<BillRow>('SELECT b.* FROM restaurant_bills b JOIN restaurants r ON r.id=b.restaurant_id WHERE b.id=? AND r.environment=? AND r.app_env=?',id,this.config.providerMode,this.config.appEnv);if(!b)throw new AppError('NOT_FOUND','账单不存在或不在当前环境。',404);return b;}
 bill(a:DiningActor,id:string){const b=this.raw(id);this.dining.party(a,b.party_id);return b;}
 rawOperation(id:string){const o=this.repo.get<FinancialOperationRow>('SELECT * FROM restaurant_financial_operations WHERE id=?',id);if(!o)throw new AppError('NOT_FOUND','支付或退款请求不存在。',404);this.raw(o.bill_id);return o;}
 operation(a:DiningActor,id:string){const o=this.rawOperation(id);this.bill(a,o.bill_id);return o;}
 rawQuote(id:string){const q=this.repo.get<FinancialQuoteRow>('SELECT * FROM restaurant_financial_quotes WHERE id=?',id);if(!q)throw new AppError('NOT_FOUND','账单或退款审阅不存在。',404);this.raw(q.bill_id);return q;}
 paymentConfig(rid:string){this.core.raw(rid);return this.repo.get<FinancialConfigRow>('SELECT * FROM restaurant_payment_configs WHERE restaurant_id=?',rid);}
 connection(r:RestaurantRow,p?:Principal):PaymentConfig {const c=this.paymentConfig(r.id),mockAllowed=this.config.providerMode==='mock'&&this.config.appEnv!=='production',configured=!!c?.enabled&&c.provider_id==='mock-payments'&&mockAllowed;return {restaurantId:r.id,providerId:c?.provider_id||null,enabled:!!c?.enabled,scenario:c?.scenario||null,version:c?.version||0,configured,simulated:c?.provider_id==='mock-payments',mockAllowed,canManage:!!p&&this.core.can(p,r,true),notice:configured?'显式模拟收银与退款，仅验证本地流程，没有真实资金往来。':c?.provider_id==='external-payments'?'真实支付尚未接入，请联系门店经理；不会用模拟结果冒充付款。':'门店未启用支付连接，可先查看账单并联系店员。'};}
 configure(p:Principal,r:RestaurantRow,input:{version:number;providerId:'mock-payments'|'external-payments';enabled:boolean;scenario:FinancialConfigRow['scenario']}){this.core.row(p,r.id,true);const old=this.paymentConfig(r.id);if((old?.version||0)!==input.version)throw new AppError('VERSION_CONFLICT','支付配置已变化，请重新载入。',409);if(input.providerId==='mock-payments'&&(this.config.providerMode!=='mock'||this.config.appEnv==='production'))throw new AppError('MOCK_DISABLED','当前环境禁止模拟收款和退款。',409);this.repo.run('INSERT INTO restaurant_payment_configs(restaurant_id,provider_id,enabled,merchant_id,scenario,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(restaurant_id) DO UPDATE SET provider_id=excluded.provider_id,enabled=excluded.enabled,merchant_id=excluded.merchant_id,scenario=excluded.scenario,version=restaurant_payment_configs.version+1,updated_at=excluded.updated_at',r.id,input.providerId,+input.enabled,input.providerId==='mock-payments'?'mock-merchant:'+r.id:'unconfigured:'+r.id,input.scenario,orderNow(),orderNow());invalidateDiningReplies(this.repo,r.id);return r.id;}
 provider(providerId:string){return selectPaymentProvider(providerId,this.config.providerMode,this.config.appEnv,{
  get:(id)=>{const row=this.repo.get<{payload:string;request_hash:string;remote_operation_id:string;remote_transaction_id:string;status:FinancialReceipt['status'];sequence:number}>('SELECT m.* FROM mock_financial_operations m JOIN restaurant_financial_operations o ON o.id=m.operation_id JOIN restaurant_bills b ON b.id=o.bill_id JOIN restaurants r ON r.id=b.restaurant_id WHERE m.operation_id=? AND r.environment=? AND r.app_env=?',id,this.config.providerMode,this.config.appEnv);return row?{request:financialRequestSchema.parse(JSON.parse(row.payload)),requestHash:row.request_hash,remoteOperationId:row.remote_operation_id,remoteTransactionId:row.remote_transaction_id,status:row.status,sequence:row.sequence}:undefined;},
  put:(next:MockFinancialRecord)=>this.repo.transaction(()=>{this.core.raw(next.request.restaurantId);const old=this.repo.get<{request_hash:string;status:string;sequence:number}>('SELECT * FROM mock_financial_operations WHERE operation_id=?',next.request.operationId);if(old){if(old.request_hash!==next.requestHash||old.sequence>next.sequence||old.sequence===next.sequence&&old.status!==next.status)throw new FinancialFailure('MOCK_REMOTE_STATE_CHANGED');if(old.sequence===next.sequence)return;if(old.status!=='pending')throw new FinancialFailure('MOCK_REMOTE_ALREADY_FINAL');this.repo.run('UPDATE mock_financial_operations SET status=?,sequence=?,updated_at=? WHERE operation_id=?',next.status,next.sequence,orderNow(),next.request.operationId);}else this.repo.run('INSERT INTO mock_financial_operations VALUES (?,?,?,?,?,?,?,?,?)',next.request.operationId,next.requestHash,JSON.stringify(next.request),next.remoteOperationId,next.remoteTransactionId,next.status,next.sequence,orderNow(),orderNow());})
 });}
 postings(id:string){return this.repo.all<FinancialPosting>('SELECT * FROM restaurant_financial_postings WHERE bill_id=? ORDER BY created_at,id',id);}
 totals(b:BillRow){const posts=this.postings(b.id),operations=this.repo.all<FinancialOperationRow>('SELECT * FROM restaurant_financial_operations WHERE bill_id=?',b.id),active=operations.filter(o=>['queued','submitting','pending','unknown','needs_attention'].includes(o.status)),paid=posts.filter(p=>p.kind==='payment').reduce((n,p)=>n+p.amount_minor,0),refunded=posts.filter(p=>p.kind==='refund').reduce((n,p)=>n+p.amount_minor,0),reserved=active.filter(o=>o.kind==='refund').reduce((n,o)=>n+o.amount_minor,0);return {paid,refunded,reserved,activePayments:active.filter(o=>o.kind==='payment'),activeRefunds:active.filter(o=>o.kind==='refund'),balance:b.amount_minor-paid};}
 refundable(payment:FinancialOperationRow,exceptId?:string){if(payment.kind!=='payment'||!this.repo.get('SELECT id FROM restaurant_financial_postings WHERE operation_id=? AND kind=\'payment\'',payment.id))return 0;const n=this.repo.get<{n:number}>("SELECT COALESCE(sum(amount_minor),0) n FROM restaurant_financial_operations WHERE parent_payment_id=? AND id<>? AND (status IN ('queued','submitting','pending','unknown','needs_attention') OR EXISTS (SELECT 1 FROM restaurant_financial_postings p WHERE p.operation_id=restaurant_financial_operations.id))",payment.id,exceptId||'')!.n;return Math.max(0,payment.amount_minor-n);}
 event(b:BillRow,actor:string,kind:string,message:string,operationId:string|null=null){this.repo.run('INSERT INTO restaurant_financial_events VALUES (?,?,?,?,?,?,?)',randomUUID(),b.id,operationId,actor,kind,JSON.stringify({message}),orderNow());}
 touch(b:BillRow){this.repo.run('UPDATE restaurant_bills SET version=version+1,updated_at=? WHERE id=?',orderNow(),b.id);invalidateDiningReplies(this.repo,b.restaurant_id,b.party_id);}
 obligation(b:BillRow,active:boolean){this.repo.run("INSERT INTO dining_obligations(id,party_id,kind,reference_id,active,created_at) VALUES (?,?,'bill',?,?,?) ON CONFLICT(kind,reference_id) DO UPDATE SET active=excluded.active",randomUUID(),b.party_id,b.id,+active,orderNow());}
 refresh(id:string){const b=this.raw(id),t=this.totals(b),o=this.orders.raw(b.order_id),overpaid=t.paid-t.refunded>b.amount_minor,overRefund=this.repo.get("SELECT p.id FROM restaurant_financial_operations p WHERE p.bill_id=? AND p.kind='payment' AND COALESCE((SELECT sum(r.amount_minor) FROM restaurant_financial_postings r JOIN restaurant_financial_operations ro ON ro.id=r.operation_id WHERE ro.parent_payment_id=p.id),0)>p.amount_minor",b.id);let status:Bill['status'],attention:string|null=null;
  const financialConflict=this.repo.get<{error_message:string|null}>("SELECT error_message FROM restaurant_financial_operations WHERE bill_id=? AND error_code='FINANCIAL_RECONCILIATION_REQUIRED' LIMIT 1",b.id);
  if(financialConflict){status='needs_attention';attention=financialConflict.error_message||'存在尚未完成本地应用的可信资金回执，请经理核对，不能直接恢复或当作结算完成。';}
  else if(this.repo.get("SELECT d.change_id FROM restaurant_order_dispatches d JOIN restaurant_order_changes c ON c.id=d.change_id WHERE c.order_id=? AND d.error_code='POS_RECONCILIATION_REQUIRED'",o.id)){status='needs_attention';attention='订单存在矛盾POS回执，收款事实已保留，仍需经理核实实际接单和资金记录。';}
  else if(overRefund){status='needs_attention';attention='收到超出原收款的退款事实，已保留账目，请由经理核实，不能在本地抹除。';}
  else if(overpaid){status='needs_attention';attention='存在已核实超付，请由经理核对并按权限处理退款。';}
  else if(t.paid>=b.amount_minor&&t.activePayments.length){status='needs_attention';attention='已收到足额资金事实，但还有其他支付尝试未核实，请先查询或关闭原尝试，避免重复付款。';}
  else if(t.activePayments.length)status='payment_pending';
  else if(!b.amount_minor&&!t.paid)status='void';
  else if(t.paid>=b.amount_minor)status=t.refunded>=t.paid?'refunded':t.refunded?'partially_refunded':'paid';
  else status='open';
  const settled=['paid','partially_refunded','refunded','void'].includes(status),unresolved=!settled||t.activeRefunds.length>0;this.repo.run('UPDATE restaurant_bills SET status=?,attention_reason=?,settled_at=CASE WHEN settled_at IS NULL AND ? THEN ? ELSE settled_at END WHERE id=?',status,attention,+settled,orderNow(),b.id);this.obligation(b,unresolved);
  if(settled&&o.settlement_status!=='settled'){this.repo.run("UPDATE restaurant_orders SET settlement_status='settled',version=version+1,updated_at=? WHERE id=?",orderNow(),o.id);this.orders.syncStatus(o.id);}
  return this.raw(id);
 }
 reviewBill(a:DiningActor,orderId:string,input:unknown){return review.reviewBill(this,a,orderId,input);}
 reviewRefund(a:DiningActor,b:BillRow,input:unknown){return review.reviewRefund(this,a,b,input);}
 quoteView(a:DiningActor,q:FinancialQuoteRow):FinancialQuote{return review.quoteView(this,a,q);}
 confirm(a:DiningActor,input:unknown){return operations.confirmFinancial(this,a,input);}
 action(a:DiningActor,op:FinancialOperationRow,input:Parameters<typeof operations.financialAction>[3]){return operations.financialAction(this,a,op,input);}
 beforeSend(op:FinancialOperationRow){return operations.beforeFinancialSend(this,op);}
 beforeSimulate(op:FinancialOperationRow){return operations.beforeSimulatedPayment(this,op);}
 view(a:DiningActor,b:BillRow):Bill{return views.billView(this,a,b);}
 operationView(a:DiningActor,op:FinancialOperationRow):FinancialOperation{return views.operationView(this,a,op);}
 receipt(a:DiningActor,b:BillRow){return views.receiptDocument(this,a,b);}
 applyReceipt(receipt:FinancialReceipt,eventId:string,payloadHash:string){return applyFinancialReceipt(this,receipt,eventId,payloadHash);}
}
