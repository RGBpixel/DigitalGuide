import { randomUUID } from 'node:crypto';
import { AppError } from '@digitalguide/domain';
import { billReviewInput,refundReviewInput,type FinancialQuote,type Bill } from '@digitalguide/contracts';
import type { BillingService } from './billing-service.js';
import type { DiningActor,OccupancyRow } from './dining-service.js';
import type { BillRow,FinancialQuoteRow,FinancialQuoteSnapshot } from './billing-types.js';
import { financialToken } from './billing-common.js';
import { orderNow,orderHash } from './order-common.js';

export function paymentContext(s:BillingService,a:DiningActor,b:BillRow){
 const o=s.orders.order(a,b.order_id),p=s.dining.party(a,b.party_id),r=s.dining.restaurant(a,b.restaurant_id);s.dining.usable(p);
 const occupancy=s.repo.get<OccupancyRow>("SELECT * FROM dining_occupancies WHERE party_id=? AND state='seated'",p.id);
 if(p.status!=='seated'||!occupancy)throw new AppError('PAYMENT_SEATING_REQUIRED','请在当前实际入座的就餐记录核对账单。',409);
 if(o.pending_change_id||o.control_mode==='human'||s.repo.get("SELECT d.change_id FROM restaurant_order_dispatches d JOIN restaurant_order_changes c ON c.id=d.change_id WHERE c.order_id=? AND (d.status IN ('queued','submitting','submitted','unknown') OR d.error_code='POS_RECONCILIATION_REQUIRED')",o.id))throw new AppError('ORDER_NOT_FINAL','订单仍有草稿、派单或人工核对，请先确认本次实际接单明细再结账。',409);
 if(a.session&&a.session.status!=='active')throw new AppError('STATE_CONFLICT','当前已转人工，请联系店员核对账单。',409);
 return {o,p,r,occupancy};
}
function createQuote(s:BillingService,a:DiningActor,b:BillRow,kind:'payment'|'refund',amountMinor:number,reason='',parentPaymentId:string|null=null){
 const p=s.dining.party(a,b.party_id),r=s.dining.restaurant(a,b.restaurant_id),o=s.orders.order(a,b.order_id),cfg=s.paymentConfig(r.id),connection=s.connection(r);if(!connection.configured||!cfg)throw new AppError('PAYMENT_NOT_CONFIGURED',connection.notice,409);
 const id=randomUUID(),expiresAt=new Date(Date.now()+120000).toISOString(),occupancy=s.repo.get<OccupancyRow>("SELECT * FROM dining_occupancies WHERE party_id=? AND state='seated'",p.id),parent=parentPaymentId?s.rawOperation(parentPaymentId):null;
 const snap:FinancialQuoteSnapshot={id,kind,billId:b.id,billVersion:b.version,orderId:o.id,orderVersion:o.version,orderContentVersion:o.content_version,restaurantId:r.id,restaurantVersion:r.version,partyId:p.id,partyVersion:p.version,partyAccessVersion:p.access_version,occupancyId:occupancy?.id||'',actorId:a.p.userId,sessionId:a.session?.id||null,focusVersion:a.session?.focus_version??null,configVersion:cfg.version,merchantId:cfg.merchant_id,parentPaymentId,parentPaymentVersion:parent?.version??null,amountMinor,reason,lines:JSON.parse(b.snapshot),expiresAt};
 s.repo.run("UPDATE restaurant_financial_quotes SET status='superseded' WHERE bill_id=? AND kind=? AND status='current'",b.id,kind);
 s.repo.run('INSERT INTO restaurant_financial_quotes(id,bill_id,kind,parent_payment_id,hash,payload,actor_id,session_id,focus_version,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,b.id,kind,parentPaymentId,orderHash(snap),JSON.stringify(snap),a.p.userId,snap.sessionId,snap.focusVersion,expiresAt,orderNow());return id;
}
export function reviewBill(s:BillingService,a:DiningActor,orderId:string,raw:unknown){
 const input=billReviewInput.parse(raw),o=s.orders.order(a,orderId);s.dining.focus(a,input.focusVersion);s.core.version(o,input.orderVersion);
 const existing=s.repo.get<BillRow>('SELECT * FROM restaurant_bills WHERE order_id=?',o.id);if((existing?.version||0)!==input.billVersion)throw new AppError('VERSION_CONFLICT','账单已更新，请重新载入当前明细。',409);
 const total=s.orders.total(o.id),lines:Bill['lines']=s.orders.lines(o.id).filter(l=>l.quantity>l.cancelled_quantity).map(l=>({lineId:l.id,itemName:l.item_name,skuName:l.sku_name,unitPriceMinor:l.unit_price_minor,quantity:l.quantity-l.cancelled_quantity,subtotalMinor:(l.quantity-l.cancelled_quantity)*l.unit_price_minor})),id=existing?.id||randomUUID();
 if(existing){const t=s.totals(existing);if(t.activePayments.length||t.paid)throw new AppError('BILL_PAYMENT_EXISTS','此账单已有待核实或已入账支付，请查询原尝试；不能另开重复收银。',409);}
 if(o.pending_change_id||o.control_mode==='human')throw new AppError('ORDER_NOT_FINAL','请先完成或撤回当前订单变更，再核对账单。',409);
 if(existing)s.repo.run('UPDATE restaurant_bills SET order_content_version=?,amount_minor=?,snapshot=?,version=version+1,updated_at=? WHERE id=?',o.content_version,total,JSON.stringify(lines),orderNow(),id);
 else s.repo.run('INSERT INTO restaurant_bills(id,restaurant_id,party_id,order_id,number,order_content_version,amount_minor,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',id,o.restaurant_id,o.party_id,o.id,'B-'+o.number.slice(2),o.content_version,total,JSON.stringify(lines),orderNow(),orderNow());
 const b=s.raw(id);if(total){paymentContext(s,a,b);createQuote(s,a,b,'payment',total);s.obligation(b,true);}else{if(!['cancelled','closed'].includes(o.status))throw new AppError('BILL_EMPTY','订单尚无已接单菜品，请先核对订单。',409);s.refresh(id);}
 s.event(b,a.p.userId,'bill_reviewed','已按服务器实际接单数量与原价生成账单审阅；尚未付款。');return id;
}
export function reviewRefund(s:BillingService,a:DiningActor,b:BillRow,raw:unknown){
 const input=refundReviewInput.parse(raw);if(a.session)throw new AppError('FORBIDDEN','退款须由门店经理核对后执行。',403);s.core.row(a.p,b.restaurant_id,true);s.core.version(b,input.billVersion);const p=s.operation(a,input.paymentId);
 if(s.repo.get("SELECT id FROM restaurant_financial_operations WHERE bill_id=? AND error_code='FINANCIAL_RECONCILIATION_REQUIRED'",b.id))throw new AppError('FINANCIAL_RECONCILIATION_REQUIRED','账单仍有可信资金回执待本地核对，请先由经理处理，不能继续追加退款。',409);
 if(p.bill_id!==b.id||p.kind!=='payment'||s.refundable(p)<input.amountMinor)throw new AppError('REFUND_LIMIT','退款超过已核实原收款的可退余额，或另有待核实退款，请先核对。',409);
 s.touch(b);const fresh=s.raw(b.id);createQuote(s,a,fresh,'refund',input.amountMinor,input.reason,p.id);s.event(fresh,a.p.userId,'refund_reviewed','经理已审阅退款金额和原因；尚未发起退款。',p.id);return b.id;
}
export function quoteReason(s:BillingService,a:DiningActor,q:FinancialQuoteRow):string|null {
 try{
  const b=s.bill(a,q.bill_id),snap=JSON.parse(q.payload) as FinancialQuoteSnapshot,p=s.dining.party(a,b.party_id),r=s.dining.restaurant(a,b.restaurant_id),o=s.orders.order(a,b.order_id),cfg=s.paymentConfig(r.id);
  if(q.actor_id!==a.p.userId||q.session_id!==(a.session?.id||null)||q.focus_version!==(a.session?.focus_version??null))return '此审阅属于之前的确认人或发问人，请重新审阅。';
  if(q.status!=='current'||q.expires_at<=orderNow())return '此审阅已到期或已使用，请重新核对。';
  if(b.version!==snap.billVersion||p.version!==snap.partyVersion||p.access_version!==snap.partyAccessVersion||r.version!==snap.restaurantVersion||o.content_version!==snap.orderContentVersion||b.order_content_version!==snap.orderContentVersion)return '账单、订单、就餐记录或当前归属已变化，请重新审阅。';
  if(!cfg?.enabled||cfg.version!==snap.configVersion||cfg.merchant_id!==snap.merchantId||!s.connection(r).configured)return '支付商户或连接已变化，请重新核对。';
  if(q.kind==='payment'){const c=paymentContext(s,a,b),t=s.totals(b);if(c.occupancy.id!==snap.occupancyId||t.activePayments.length||t.balance!==snap.amountMinor||t.balance<=0)return '当前桌位、待核实支付或剩余金额已变化，请先查询原尝试。';}
  else{if(a.session)return '退款需要门店经理核对。';s.core.row(a.p,r.id,true);const parent=s.rawOperation(snap.parentPaymentId!);if(parent.bill_id!==b.id||parent.version!==snap.parentPaymentVersion||s.refundable(parent)<snap.amountMinor)return '原收款或可退余额已变化，请重新审阅。';}
  return null;
 }catch(e){if(e instanceof AppError)return e.message;throw e;}
}
export function quoteView(s:BillingService,a:DiningActor,q:FinancialQuoteRow):FinancialQuote {
 s.bill(a,q.bill_id);const snap=JSON.parse(q.payload) as FinancialQuoteSnapshot,reason=quoteReason(s,a,q);return {id:q.id,billId:q.bill_id,kind:q.kind,parentPaymentId:q.parent_payment_id,hash:q.hash,billVersion:snap.billVersion,orderContentVersion:snap.orderContentVersion,amountMinor:snap.amountMinor,currency:'CNY',reason:snap.reason,lines:snap.lines,valid:!reason,invalidReason:reason,confirmationToken:reason?null:financialToken(s.config,q),expiresAt:q.expires_at,createdAt:q.created_at};
}
