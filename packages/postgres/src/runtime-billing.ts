import {createHash,createHmac,randomUUID} from 'node:crypto';
import {AppError,canonical,type Principal} from '../../domain/src/index.js';
import {billSchema,partyBillingSchema,paymentConfigSchema,receiptDocumentSchema,type Bill,type FinancialQuote} from '../../contracts/src/index.js';
import {NativeKitchen} from './runtime-kitchen.js';
import type {NativeDiningContext,NativeDiningProof} from './runtime-dining.js';

export type NativeBillingKind='restaurant'|'party'|'order'|'bill'|'quote'|'operation';
type BillingContext=NativeDiningContext&{actorEpoch:number|null;grantVersion:number|null;partyAccessVersion:number|null};
type RawQuote=FinancialQuote&{_confirmation:{quoteId:string;meta:BillingContext;hash:string}|null};
type RawBill=Omit<Bill,'quotes'>&{quotes:RawQuote[]};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const errors:Record<string,[number,string]>={
 FINANCIAL_ACTION_UNAVAILABLE:[409,'原资金请求、版本、权限或动作状态已经变化，请先核对原结果。'],FINANCIAL_FIXTURE_UNAVAILABLE:[409,'仅可为已发送、未知且未处理中的本地模拟请求明确建立一次远端事实。'],FINANCIAL_RECEIPT_MISMATCH:[409,'可信回执与原金额、商户、门店、币种、环境或远端编号不一致，未入账。'],FINANCIAL_NOT_SENT:[409,'原资金请求尚未发送，不能接受远端付款或退款结果。'],FINANCIAL_EVENT_CONFLICT:[409,'同一资金事件的内容发生变化，请核对原回执。'],FINANCIAL_WORKER_LEASE:[409,'原资金租约已到期或已被新结果替代，旧回调不能提交。'],FINANCIAL_SOURCE_EXPIRED:[409,'执行前原期限、授权、会话、金额或连接已经变化，请核对原资金请求。'],FINANCIAL_REQUEST_MISMATCH:[409,'原模拟远端请求与固定资金请求不一致，未执行新资金动作。'],BILL_NOT_SETTLED:[409,'账单仍有待核实资金或异常，尚不能生成已结算收据。'],
 VALIDATION_FAILED:[400,'账单输入无效，请核对当前版本及明确确认信息。'],NOT_FOUND:[404,'账单或资金请求不存在，或不在当前门店和本人就餐组范围内。'],FORBIDDEN:[403,'当前职责不能执行此操作；退款与支付连接配置须本店经理核对。'],VERSION_CONFLICT:[409,'账单、订单或支付连接已有新版本，请刷新后重新核对。'],AUTHORIZATION_CHANGED:[409,'原人员授权、顾客会话或就餐选择已变化，请重新核对。'],
 PAYMENT_PROVIDER_UNAVAILABLE:[409,'真实支付尚未接通，不能启用或回退为模拟成功。'],PAYMENT_NOT_CONFIGURED:[409,'请经理明确配置本地模拟支付连接，或接通并验证真实支付。'],BILL_NOT_REVIEWABLE:[409,'订单仍有未确认变更、未知派单、人工核对或桌位变化，请先核对实际接单与入座。'],FINANCIAL_PENDING:[409,'本单已有资金请求、收款或待核对事实，请核对原请求，不能重新收款。'],BILL_AMOUNT_INVALID:[409,'服务器账单金额超出支持范围，请联系店员核对原明细。'],BILL_EMPTY:[409,'尚无可核实的接单明细，不能生成账单。'],BILL_CONFIRMATION_INVALID:[409,'确认令牌与原账单审阅不符，请重新核对。'],BILL_QUOTE_CHANGED:[409,'原审阅已到期，或账单、会话、授权、商户及可退额已变化，请重新审阅。'],REFUND_UNAVAILABLE:[409,'原收款不存在、可退额不足或仍有待核对资金事实，请核对原请求。'],FINANCIAL_ALREADY_SENT:[409,'仅可撤回尚未发送的请求；已发送或未知结果须查询原请求。']
};
export class NativeBilling extends NativeKitchen {
 override async call<T>(name:string,args:unknown[]=[]):Promise<T>{try{return await super.call<T>(name,args);}catch(error){const match=/^DGBILL:([A-Z_]+)$/.exec(error instanceof Error?error.message:''),known=match&&errors[match[1]];if(match&&known)throw new AppError(match[1],known[1],known[0]);throw error;}}
 billingContext(kind:NativeBillingKind,id:string,proof?:NativeDiningProof,write=false,historical=false){return this.call<BillingContext>('dg_native_bill_context',[kind,id,...this.proofArgs(proof,write),write,historical]);}
 async prepareBilling(p:Principal,kind:NativeBillingKind,id:string,write=false){const meta=await this.billingContext(kind,id,undefined,write,true);await this.core.workspaceLock(p,meta.workspaceId,write);return meta;}
 billingToken(quoteId:string,meta:BillingContext){return createHmac('sha256',this.secret).update(canonical(['native-financial-confirm-v1',this.db.config.runtimeId,this.db.config.appEnv,meta.restaurantId,meta.partyId,quoteId,meta.actorType,meta.actorId,meta.actorEpoch,meta.grantVersion,meta.sessionId,meta.accessId,meta.focusVersion,meta.selectionVersion,meta.partyAccessVersion])).digest('base64url');}
 presentBill(raw:RawBill):Bill{return billSchema.parse({...raw,quotes:raw.quotes.map(value=>{const{_confirmation,...quote}=value;let token:string|null=null;if(_confirmation){token=this.billingToken(_confirmation.quoteId,_confirmation.meta);if(hash(token)!==_confirmation.hash)throw new AppError('NATIVE_RUNTIME_BINDING','当前服务密钥与原账单审阅不匹配，请管理员核对原实例配置。',503);}return{...quote,confirmationToken:token};})});}
 async applyBilling(kind:NativeBillingKind,id:string,action:'config'|'review'|'refund_review'|'confirm'|'withdraw'|'action',input:Record<string,unknown>,proof?:NativeDiningProof){
  if(action==='action')return this.call<string>('dg_native_bill_action',[id,input,...this.proofArgs(proof,true)]);
  let body={...input};if(action==='review'||action==='refund_review'){const meta=await this.billingContext(kind,id,proof,true,action==='refund_review'),quoteId=randomUUID();body={...body,_quoteId:quoteId,_confirmationHash:hash(this.billingToken(quoteId,meta))};}
  if(action==='confirm'){const{confirmationToken,...rest}=body;body={...rest,_confirmationHash:hash(String(confirmationToken))};}
  return this.call<string>('dg_native_bill_apply',[kind,id,action,body,...this.proofArgs(proof,true)]);
 }
 async billingRead(kind:'restaurant'|'party'|'bill',id:string,proof?:NativeDiningProof){const raw=await this.call<Record<string,unknown>>('dg_native_bill_read',[kind,id,proof?.id??null,proof?.tokenHash??null]);if(kind==='restaurant')return paymentConfigSchema.parse(raw);if(kind==='bill')return this.presentBill(raw as unknown as RawBill);return partyBillingSchema.parse({...raw,bills:(raw.bills as RawBill[]).map(b=>this.presentBill(b))});}
 async billingResult(id:string,proof?:NativeDiningProof){const raw=await this.call<Record<string,unknown>>('dg_native_bill_result',[id,proof?.id??null,proof?.tokenHash??null]);return'quotes'in raw?this.presentBill(raw as unknown as RawBill):paymentConfigSchema.parse(raw);}
 billingMockResult(id:string,input:Record<string,unknown>){return this.call<string>('dg_native_bill_mock_fixture',[id,input]);}
 async billingReceipt(id:string,proof?:NativeDiningProof){return receiptDocumentSchema.parse(await this.call<unknown>('dg_native_bill_receipt_document',[id,proof?.id??null,proof?.tokenHash??null]));}
}
