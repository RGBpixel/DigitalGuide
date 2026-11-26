import { randomUUID } from 'node:crypto';
import { AppError } from '@digitalguide/domain';
import { financialReceiptSchema,type FinancialReceipt } from '@digitalguide/contracts';
import type { BillingService } from './billing-service.js';
import { orderNow } from './order-common.js';
export function applyFinancialReceipt(s:BillingService,raw:FinancialReceipt,eventId:string,payloadHash:string){
 const r=financialReceiptSchema.parse(raw),op=s.rawOperation(r.operationId),b=s.raw(op.bill_id),operationPrefix=op.kind==='payment'?'mock-pay:':'mock-refund:',transactionPrefix=op.kind==='payment'?'mock-charge:':'mock-refund-tx:';
 if(r.kind!==op.kind||r.restaurantId!==b.restaurant_id||r.billId!==b.id||r.requestHash!==op.request_hash||r.merchantId!==op.merchant_id||r.amountMinor!==op.amount_minor||r.currency!=='CNY'||r.simulated!==!!op.simulated||op.provider_id!=='mock-payments'||r.remoteOperationId!==operationPrefix+op.id||r.remoteTransactionId!==transactionPrefix+op.id)throw new AppError('FINANCIAL_RECEIPT_MISMATCH','资金回执与原请求、商户、门店、金额、币种或环境不一致，未入账。',409);
 if(!op.send_attempts)throw new AppError('FINANCIAL_NOT_SENT','此请求尚未发送，不能接受远端付款或退款结果。',409);
 const old=s.repo.get<{payload_hash:string;applied:number;attention:number}>('SELECT * FROM restaurant_financial_receipts WHERE event_id=?',eventId);if(old){if(old.payload_hash!==payloadHash)throw new AppError('FINANCIAL_EVENT_CONFLICT','同一回执事件内容已变化。',409);return {duplicate:true,applied:!!old.applied,attention:!!old.attention};}
 s.repo.run('INSERT INTO restaurant_financial_receipts(event_id,operation_id,payload_hash,payload,status,sequence,created_at) VALUES (?,?,?,?,?,?,?)',eventId,op.id,payloadHash,JSON.stringify(r),r.status,r.sequence,orderNow());
 const posted=!!s.repo.get('SELECT id FROM restaurant_financial_postings WHERE operation_id=?',op.id);
 // A verified success is a funds fact. A later failure cannot erase it, and a
 // delayed success is retained even after a previous expiry/failure notification.
 if(posted){s.repo.run('UPDATE restaurant_financial_operations SET last_sequence=max(last_sequence,?) WHERE id=?',r.sequence,op.id);return {duplicate:false,applied:false,attention:false};}
 if(r.status==='pending'&&['failed','expired','cancelled','stale'].includes(op.status)){s.repo.run('UPDATE restaurant_financial_operations SET last_sequence=max(last_sequence,?) WHERE id=?',r.sequence,op.id);s.event(b,'provider','ignored_pending_after_terminal','已核实失败或关闭的原请求不因后续待支付回执重新打开；若有可信成功资金事实仍会保留。',op.id);return {duplicate:false,applied:false,attention:false};}
 // A lookup can confirm that an interrupted simulation left the original
 // checkout pending, with the same remote sequence that we already knew.
 const confirmsInterruptedPending=r.status==='pending'&&op.status==='unknown'&&r.sequence===op.last_sequence;
 if(r.status!=='succeeded'&&r.sequence<=op.last_sequence&&!confirmsInterruptedPending)return {duplicate:false,applied:false,attention:false};
 if(op.error_code==='FINANCIAL_RECONCILIATION_REQUIRED'){s.repo.run('UPDATE restaurant_financial_receipts SET attention=1 WHERE event_id=?',eventId);return {duplicate:false,applied:false,attention:true};}
 s.repo.run('SAVEPOINT financial_receipt_apply');
 try{
  if(r.status==='succeeded')s.repo.run('INSERT INTO restaurant_financial_postings VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),b.id,op.id,op.kind,op.amount_minor,'CNY',op.provider_id,op.merchant_id,r.remoteTransactionId,s.config.providerMode,s.config.appEnv,orderNow());
  s.repo.run('UPDATE restaurant_financial_operations SET status=?,remote_operation_id=?,remote_transaction_id=?,last_sequence=max(last_sequence,?),error_code=?,error_message=?,lease_token=NULL,lease_until=NULL,lease_action=NULL,next_action=NULL,version=version+1,updated_at=? WHERE id=?',r.status,r.remoteOperationId,r.remoteTransactionId,r.sequence,r.status==='failed'?'FINANCIAL_VERIFIED_FAILED':null,r.status==='failed'?'模拟渠道明确失败，此请求未入账；可重新审阅或联系店员。':null,orderNow(),op.id);
  s.repo.run('UPDATE restaurant_financial_receipts SET applied=1 WHERE event_id=?',eventId);s.event(b,'provider',op.kind+'_'+r.status,r.status==='succeeded'?(op.kind==='payment'?'已核实模拟收款，资金事实已记账；菜品履行单独核对。':'已核实模拟退款，保留原收款并单独登记退款。'):r.status==='pending'?(op.kind==='payment'?'模拟收银入口已创建，尚未付款。':'模拟渠道已接收退款，仍待可信最终结果。'):r.status==='expired'?'原模拟支付入口已核实关闭或到期，没有凭本地按钮假定付款。':'模拟渠道明确未完成本次资金操作。',op.id);s.touch(b);s.refresh(b.id);s.repo.run('RELEASE SAVEPOINT financial_receipt_apply');return {duplicate:false,applied:true,attention:false};
 }catch(e){
  s.repo.run('ROLLBACK TO SAVEPOINT financial_receipt_apply');s.repo.run('RELEASE SAVEPOINT financial_receipt_apply');const message=e instanceof AppError?'可信回执已保留；'+e.message+' 请由经理核对。':'可信资金回执已保留，本地应用出现异常，须由经理核对账目，不能假定已经结算。';
  s.repo.run('UPDATE restaurant_financial_receipts SET attention=1 WHERE event_id=?',eventId);s.repo.run("UPDATE restaurant_financial_operations SET status='needs_attention',last_sequence=max(last_sequence,?),error_code='FINANCIAL_RECONCILIATION_REQUIRED',error_message=?,lease_token=NULL,lease_until=NULL,lease_action=NULL,next_action=NULL,version=version+1,updated_at=? WHERE id=?",r.sequence,message,orderNow(),op.id);s.repo.run("UPDATE restaurant_bills SET status='needs_attention',attention_reason=? WHERE id=?",message,b.id);s.obligation(b,true);s.event(b,'provider','financial_apply_conflict',message,op.id);s.touch(b);return {duplicate:false,applied:false,attention:true};
 }
}
