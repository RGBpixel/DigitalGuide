import {createHash,createHmac,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError,canonical,type Principal} from '../../domain/src/index.js';
import {restaurantOrderSchema,posConfigSchema,guestOrdersSchema,partyOrderHistorySchema,type RestaurantOrder,type OrderQuote} from '../../contracts/src/index.js';
import {NativeFood} from './runtime-food.js';
import {type NativeDiningContext,type NativeDiningProof} from './runtime-dining.js';
import {nativeBusinessInteger} from './runtime-repository.js';

export type NativeOrderKind='restaurant'|'party'|'order'|'change';
type OrderContext=NativeDiningContext&{actorEpoch:number|null;grantVersion:number|null};
type RawQuote=OrderQuote&{_confirmation:{quoteId:string;meta:OrderContext;hash:string}|null};
type RawOrder=Omit<RestaurantOrder,'changes'>&{changes:(Omit<RestaurantOrder['changes'][number],'currentQuote'>&{currentQuote:RawQuote|null})[]};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const errors:Record<string,[number,string]>={
 POS_RECONCILIATION_REQUIRED:[409,'本单回执存在矛盾或本地投影失败，请经理核实POS与实际制作；本地操作不能把它标为已解决。'],
 ORDER_WORKER_LEASE:[409,'原派单租约已到期或已有更新结果，旧回调不能提交。'],ORDER_SOURCE_EXPIRED:[409,'发送前原期限、顾客或授权已变化，保留请求交由店员核对。'],POS_RECEIPT_MISMATCH:[409,'回执与固定的原门店、请求摘要、环境或远端编号不一致。'],POS_REQUEST_NOT_SENT:[409,'原请求尚未发送，不能接受远端确认回执。'],POS_EVENT_CONFLICT:[409,'同一回执事件的内容发生变化，请核对原事件。'],POS_QUERY_UNAVAILABLE:[409,'只有已发送且待核实的原请求可查询，矛盾回执须人工核对。'],POS_FIXTURE_UNAVAILABLE:[409,'仅可为明确的本地未决模拟请求建立一次远端事实。'],
 VALIDATION_FAILED:[400,'点单输入无效，请核对菜品、数量、版本及明确确认信息。'],FORBIDDEN:[403,'当前顾客或门店职责不能进行此操作。'],NOT_FOUND:[404,'订单不在当前门店或本人就餐组范围内。'],VERSION_CONFLICT:[409,'订单、当前发问人或就餐选择已变化，请载入最新记录。'],AUTHORIZATION_CHANGED:[409,'原操作的人员、授权或当前服务对象已变化，请重新核对。'],PARTY_ENDED:[409,'本次就餐已结束，请联系店员处理历史订单。'],POS_PROVIDER_UNAVAILABLE:[409,'真实后厨连接尚未实现，不能启用或返回模拟成功。'],POS_NOT_CONFIGURED:[409,'请由经理明确配置本地模拟后厨，或接通并验证真实POS。'],PREFERENCE_CONFIRMATION_REQUIRED:[409,'请先明确确认当前安排下的本次口味，再审阅点单。'],ORDER_SEATING_REQUIRED:[409,'请先由店员确认实际入座和当前桌位，再审阅点单。'],ORDER_QUOTE_CHANGED:[409,'原审阅已到期，或价格、桌位、偏好及授权发生变化，请重新审阅。'],ORDER_CONFIRMATION_INVALID:[409,'确认令牌与当前审阅不符，请重新核对。'],ORDER_WARNING_CONFIRMATION:[409,'请明确核对并接受本次审阅提示后再确认。'],ORDER_DIETARY_CHECK:[409,'所选菜品存在过敏、忌口冲突或必要配料资料不全，请联系店员核对或换菜。'],ORDER_DIETARY_SHARING_REQUIRED:[409,'请明确同意向后厨分享本次必要避让成分，或联系店员核对。'],ORDER_OUT_OF_STOCK:[409,'当前可售数量不足，请调整数量后重新审阅。'],ORDER_STOCK_CHANGED:[409,'库存或菜品已变化，未预占或发送，请重新审阅。'],ORDER_RESULT_PENDING:[409,'本单结果仍需核对，不能按未发送处理或自动重发。'],ORDER_ALREADY_SENT:[409,'此变更已进入发送流程，不能修改原请求。'],ORDER_CHANGED:[409,'当前订单已有新版本，请刷新后重新核对。'],ORDER_CHANGE_PENDING:[409,'已有待处理变更，请先完成或撤回当前草稿。'],ORDER_NOT_WRITABLE:[409,'订单控制或结算状态不允许修改，请联系店员。'],ORDER_FINANCIAL_PENDING:[409,'本单正在结算或已有付款记录，请先由店员核对。'],ORDER_REVIEW_LOCKED:[409,'当前草稿已不可审阅，请载入最新记录。'],ORDER_KIND_CHANGED:[409,'首次点单与已接单状态不符，请重新选择操作。'],ORDER_INITIAL_REDUCTION:[400,'首次点单不能包含退菜。'],ORDER_CANCEL_ADDS:[400,'取消订单不能同时加菜。'],ORDER_DUPLICATE_REDUCTION:[400,'同一菜品明细不能重复退菜。'],ORDER_EMPTY:[400,'请选择本次新增菜品或退菜明细。'],ORDER_AMOUNT_INVALID:[409,'本单金额超出支持范围，请联系店员。'],ORDER_RECOMMENDATION_CHANGED:[409,'原菜单推荐已失效，请重新获取并核对。'],MENU_UNAVAILABLE:[409,'当前菜品已停售或下架，请重新选择。'],KITCHEN_ALREADY_STARTED:[409,'相关菜品已开做或数量变化，不能按原数量退菜。'],KITCHEN_QUANTITY_CHANGED:[409,'制作或待退数量已变化，请重新核对。'],ORDER_DATA_INCOMPLETE:[409,'订单制作记录不完整，请联系店员核对。'],ORDER_LIMIT:[409,'本组历史变更较多，请联系店员。'],RATE_LIMITED:[429,'点单操作较频繁，请稍后重试。']
};
export class NativeOrders extends NativeFood {
 override async call<T>(name:string,args:unknown[]=[]):Promise<T>{try{return await super.call<T>(name,args);}catch(error){const match=/^DGORDER:([A-Z_]+)$/.exec(error instanceof Error?error.message:''),known=match&&errors[match[1]];if(match&&known)throw new AppError(match[1],known[1],known[0]);throw error;}}
 orderContext(kind:NativeOrderKind,id:string,proof?:NativeDiningProof,write=false){return this.call<OrderContext>('dg_native_order_context',[kind,id,...this.proofArgs(proof,write),write]);}
 async prepareOrder(p:Principal,kind:NativeOrderKind,id:string,write=false){const meta=await this.orderContext(kind,id,undefined,write);await this.core.workspaceLock(p,meta.workspaceId,write);return meta;}
 confirmationToken(quoteId:string,meta:OrderContext){return createHmac('sha256',this.secret).update(canonical(['native-order-confirm-v1',this.db.config.runtimeId,this.db.config.appEnv,meta.restaurantId,meta.partyId,quoteId,meta.actorType,meta.actorId,meta.actorEpoch??null,meta.grantVersion??null,meta.sessionId,meta.accessId,meta.focusVersion,meta.selectionVersion])).digest('base64url');}
 presentOrder(raw:RawOrder):RestaurantOrder{
  return restaurantOrderSchema.parse({...raw,changes:raw.changes.map(change=>({...change,currentQuote:change.currentQuote?(()=>{const{_confirmation,...quote}=change.currentQuote;let token:string|null=null;if(_confirmation){token=this.confirmationToken(_confirmation.quoteId,_confirmation.meta);if(hash(token)!==_confirmation.hash)throw new AppError('NATIVE_RUNTIME_BINDING','当前服务密钥与原审阅不匹配，请联系管理员核对原实例配置。',503);}return{...quote,confirmationToken:token};})():null}))});
 }
 async applyOrder(kind:NativeOrderKind,id:string,action:'config'|'draft'|'update'|'review'|'confirm'|'submit'|'withdraw'|'query'|'control',input:Record<string,unknown>,proof?:NativeDiningProof){
  if(action==='control')return this.call<string>('dg_native_order_control',[id,input,...this.proofArgs(proof,true)]);
  if(action==='query')return this.call<string>('dg_native_order_query',[id,input,...this.proofArgs(proof,true)]);
  let body={...input};
  if(action==='review'){const meta=await this.orderContext(kind,id,proof,true),quoteId=randomUUID();body={...body,_quoteId:quoteId,_confirmationHash:hash(this.confirmationToken(quoteId,meta))};}
  if(action==='confirm'){const{confirmationToken,...rest}=body;body={...rest,_confirmationHash:hash(String(confirmationToken))};}
  return this.call<string>('dg_native_order_apply',[kind,id,action,body,...this.proofArgs(proof,true)]);
 }
 mockResult(id:string,input:Record<string,unknown>){return this.call<string>('dg_native_order_mock_fixture',[id,input]);}
 async orderRead(kind:NativeOrderKind,id:string,proof?:NativeDiningProof){const raw=await this.call<Record<string,unknown>>('dg_native_order_read',[kind,id,proof?.id??null,proof?.tokenHash??null]);if(kind==='restaurant')return posConfigSchema.parse(raw);if(kind==='order')return this.presentOrder(raw as unknown as RawOrder);const value={...raw,order:raw.order?this.presentOrder(raw.order as RawOrder):null};return proof?guestOrdersSchema.parse(value):z.strictObject({order:restaurantOrderSchema.nullable(),connection:posConfigSchema}).parse(value);}
 async orderResult(id:string,proof?:NativeDiningProof){const value=await this.call<Record<string,unknown>>('dg_native_order_result',[id,proof?.id??null,proof?.tokenHash??null]);return'changes'in value?this.presentOrder(value as unknown as RawOrder):posConfigSchema.parse(value);}
 async history(id:string,proof?:NativeDiningProof){return partyOrderHistorySchema.parse(await this.call<unknown>('dg_native_order_history',[id,proof?.id??null,proof?.tokenHash??null]));}
 override async sweep(id?:string){return(await super.sweep(id))+nativeBusinessInteger(await this.call<unknown>('dg_native_order_sweep',[id??null]));}
}
