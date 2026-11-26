import { randomUUID,timingSafeEqual } from 'node:crypto';
import { AppError } from '@digitalguide/domain';
import { financialConfirmInput,type FinancialRequest } from '@digitalguide/contracts';
import type { DiningActor } from './dining-service.js';
import type { SessionRow } from './reception-service.js';
import type { BillingService } from './billing-service.js';
import type { FinancialOperationRow,FinancialQuoteSnapshot,FinancialQuoteRow } from './billing-types.js';
import { financialToken } from './billing-common.js';
import { quoteReason,paymentContext } from './billing-review.js';
import { orderHash,orderNow } from './order-common.js';

export function confirmFinancial(s:BillingService,a:DiningActor,raw:unknown){
 const input=financialConfirmInput.parse(raw);s.dining.focus(a,input.focusVersion);const q=s.rawQuote(input.quoteId),b=s.bill(a,q.bill_id),reason=quoteReason(s,a,q);if(reason)throw new AppError('FINANCIAL_QUOTE_CHANGED',reason,409);
 const expected=Buffer.from(financialToken(s.config,q)),actual=Buffer.from(input.confirmationToken);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new AppError('FINANCIAL_CONFIRMATION_INVALID','本次确认令牌无效，请重新审阅。',409);
 const snap=JSON.parse(q.payload) as FinancialQuoteSnapshot,p=s.dining.party(a,b.party_id),cfg=s.paymentConfig(b.restaurant_id)!,id=randomUUID(),parent=q.parent_payment_id?s.rawOperation(q.parent_payment_id):null,request:FinancialRequest={operationId:id,kind:q.kind,restaurantId:b.restaurant_id,billId:b.id,orderId:b.order_id,merchantId:cfg.merchant_id,amountMinor:snap.amountMinor,currency:'CNY',parentPaymentId:q.parent_payment_id,parentRemoteTransactionId:parent?.remote_transaction_id||null};
 s.repo.run('INSERT INTO restaurant_financial_operations(id,bill_id,kind,parent_payment_id,quote_id,amount_minor,provider_id,merchant_id,config_version,config_snapshot,request_payload,request_hash,reason,simulated,actor_id,session_id,focus_version,party_access_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,b.id,q.kind,q.parent_payment_id,q.id,snap.amountMinor,cfg.provider_id,cfg.merchant_id,cfg.version,JSON.stringify(cfg),JSON.stringify(request),orderHash(request),snap.reason,+(cfg.provider_id==='mock-payments'),a.p.userId,a.session?.id||null,a.session?.focus_version??null,p.access_version,orderNow(),orderNow());
 s.repo.run("UPDATE restaurant_financial_quotes SET status='consumed' WHERE id=?",q.id);s.event(b,a.p.userId,q.kind+'_queued',q.kind==='payment'?'已确认创建模拟收银入口，尚未付款。':'经理已明确确认模拟退款，待核实结果。',id);s.touch(b);s.refresh(b.id);return id;
}
export function financialAction(s:BillingService,a:DiningActor,op:FinancialOperationRow,input:{version:number;action:'query'|'close'|'withdraw'|'simulate';focusVersion?:number}){
 s.dining.focus(a,input.focusVersion);const b=s.bill(a,op.bill_id),p=s.dining.party(a,b.party_id);s.core.version(op,input.version);
 if(op.kind==='refund'&&input.action!=='query'&&(a.session||!s.core.can(a.p,s.core.raw(b.restaurant_id),true)))throw new AppError('FORBIDDEN','退款操作须由本店经理执行。',403);
 if(op.lease_token&&op.lease_until&&op.lease_until>orderNow())throw new AppError('FINANCIAL_ACTION_RUNNING','原请求正在核实，请等待当前结果，不要重复发起。',409);
 if(input.action==='withdraw'){
  if(op.status!=='queued'||op.send_attempts)throw new AppError('FINANCIAL_ALREADY_SENT','此请求已发送，不能按未发送撤回；请查询或关闭原支付。',409);
  s.repo.run("UPDATE restaurant_financial_operations SET status='cancelled',version=version+1,updated_at=? WHERE id=?",orderNow(),op.id);s.event(b,a.p.userId,'financial_withdrawn','已撤回尚未发送的财务请求。',op.id);s.touch(b);s.refresh(b.id);return op.id;
 }
 if(!['pending','unknown','needs_attention'].includes(op.status))throw new AppError('FINANCIAL_ACTION_UNAVAILABLE','此请求尚未发送或已有可信最终结果，请载入当前状态。',409);
 if(op.status==='needs_attention'&&input.action!=='query')throw new AppError('FINANCIAL_RECONCILIATION_REQUIRED','可信资金回执仍待经理核对，只能查询原事实，不能由本地关闭或重复付款抹除。',409);
 if(input.action==='close'&&op.kind!=='payment')throw new AppError('REFUND_CLOSE_UNSUPPORTED','已发送退款不能在本地直接取消，请核对原退款结果。',409);
 if(input.action==='simulate'){
  if(op.kind!=='payment'||s.config.providerMode!=='mock'||s.config.appEnv==='production'||!op.simulated)throw new AppError('MOCK_DISABLED','当前操作不提供模拟付款。',409);
  if(op.status!=='pending'||!op.remote_operation_id||op.simulate_attempts||s.totals(b).balance<op.amount_minor)throw new AppError('MOCK_PAYMENT_UNAVAILABLE','当前尚无可确认收银入口、已确认过付款或金额已覆盖，请查询原请求。',409);
  s.dining.usable(p);if(a.session&&a.session.status!=='active')throw new AppError('STATE_CONFLICT','当前已转人工，请联系店员。',409);
 }
 s.repo.run('UPDATE restaurant_financial_operations SET next_action=?,action_actor_id=?,action_session_id=?,action_focus_version=?,action_party_access_version=?,version=version+1,updated_at=? WHERE id=?',input.action,a.p.userId,a.session?.id||null,a.session?.focus_version??null,p.access_version,orderNow(),op.id);s.event(b,a.p.userId,'financial_'+input.action+'_requested',input.action==='simulate'?'本人已明确选择模拟付款，无真实资金操作。':input.action==='close'?'请求核实关闭原支付入口；已支付结果不会被关闭降级。':'请求查询同一个支付或退款编号，没有重新发送。',op.id);s.touch(b);return op.id;
}
function issuer(s:BillingService,actorId:string,sessionId:string|null,focus:number|null):DiningActor {
 if(sessionId){const session=s.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?',sessionId);if(!session||session.status!=='active'||session.focus_version!==focus||session.expires_at<=orderNow())throw new AppError('FINANCIAL_ISSUER_CHANGED','当前确认人或会话已变化，未发送操作已停止。',409);return {session,p:{userId:'guest:'+session.id,tenantId:session.tenant_id,workspaceIds:[session.workspace_id],role:'viewer'}};}
 return {p:s.repo.principal(actorId)};
}
export function beforeFinancialSend(s:BillingService,op:FinancialOperationRow){
 const q=s.rawQuote(op.quote_id),snap=JSON.parse(q.payload) as FinancialQuoteSnapshot,a=issuer(s,op.actor_id,op.session_id,op.focus_version),b=s.bill(a,op.bill_id),p=s.dining.party(a,b.party_id),r=s.core.raw(b.restaurant_id),cfg=s.paymentConfig(r.id);
 if(!cfg?.enabled||cfg.version!==op.config_version||cfg.merchant_id!==op.merchant_id||p.access_version!==op.party_access_version||r.version!==snap.restaurantVersion||q.expires_at<=orderNow())throw new AppError('FINANCIAL_SOURCE_CHANGED','发送前连接、商户、归属或确认期限已变化，未发送操作已停止。',409);
 if(op.kind==='payment'){const c=paymentContext(s,a,b);if(c.occupancy.id!==snap.occupancyId||p.version!==snap.partyVersion||c.o.content_version!==snap.orderContentVersion||b.order_content_version!==snap.orderContentVersion||s.totals(b).balance!==op.amount_minor)throw new AppError('BILL_CHANGED','发送前账单、订单或当前桌位已变化，请重新核对。',409);}
 else{if(a.session)throw new AppError('FORBIDDEN','退款需要本店经理。',403);s.core.row(a.p,r.id,true);const parent=s.rawOperation(op.parent_payment_id!);if(parent.bill_id!==b.id||s.refundable(parent,op.id)<op.amount_minor)throw new AppError('REFUND_LIMIT','原收款可退余额已变化，尚未发送退款已停止。',409);}
 s.provider(op.provider_id);return snap;
}
export function beforeSimulatedPayment(s:BillingService,op:FinancialOperationRow){
 if(!op.action_actor_id)throw new AppError('FINANCIAL_ACTION_MISSING','缺少本次明确的模拟付款确认。',409);const a=issuer(s,op.action_actor_id,op.action_session_id,op.action_focus_version),b=s.bill(a,op.bill_id),p=s.dining.party(a,b.party_id);s.dining.usable(p);
 const cfg=s.paymentConfig(b.restaurant_id);if(!cfg?.enabled||cfg.version!==op.config_version||cfg.merchant_id!==op.merchant_id||p.access_version!==op.action_party_access_version||s.totals(b).balance<op.amount_minor||op.simulate_attempts>1)throw new AppError('MOCK_PAYMENT_SOURCE_CHANGED','当前归属或待付金额已变化，请查询并核实原收银入口。',409);
}
export function quoteSnapshot(q:FinancialQuoteRow){return JSON.parse(q.payload) as FinancialQuoteSnapshot;}
