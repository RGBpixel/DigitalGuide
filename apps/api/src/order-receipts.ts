import { randomUUID } from 'node:crypto';
import { AppError } from '@digitalguide/domain';
import { posReceiptSchema,type POSReceipt } from '@digitalguide/contracts';
import type { OrderService } from './order-service.js';
import type { QuoteSnapshot } from './order-types.js';
import { orderNow } from './order-common.js';

export function applyReceipt(s:OrderService,raw:POSReceipt,eventId:string,payloadHash:string){
 const r=posReceiptSchema.parse(raw),d=s.dispatch(r.requestId),c=s.rawChange(d.change_id),o=s.raw(c.order_id),request=JSON.parse(d.request_payload);
 if(r.restaurantId!==d.restaurant_id||r.requestHash!==d.request_hash||r.simulated!==!!d.simulated||d.provider_id!=='mock-pos'||r.remoteRequestId!=='mock-pos:'+c.id||r.remoteOrderId!==(request.remoteOrderId||'mock-order:'+o.id))throw new AppError('POS_RECEIPT_MISMATCH','回执与原门店、请求、环境或远端编号不一致。',409);
 if(!d.attempts)throw new AppError('POS_REQUEST_NOT_SENT','此请求尚未发送，不能接受伪造的远端接单回执。',409);
 const old=s.repo.get<{payload_hash:string;applied:number;conflict:number}>('SELECT * FROM restaurant_pos_callbacks WHERE event_id=?',eventId);
 if(old){if(old.payload_hash!==payloadHash)throw new AppError('POS_EVENT_CONFLICT','同一回执事件内容发生变化。',409);return {duplicate:true,applied:!!old.applied,conflict:!!old.conflict};}
 s.repo.run('INSERT INTO restaurant_pos_callbacks(event_id,change_id,payload_hash,payload,outcome,sequence,created_at) VALUES (?,?,?,?,?,?,?)',eventId,c.id,payloadHash,JSON.stringify(r),r.status,r.sequence,orderNow());
 if(r.sequence<=d.last_sequence)return {duplicate:false,applied:false,conflict:false};
 const conflict=(message:string)=>{
  s.repo.run('UPDATE restaurant_pos_callbacks SET conflict=1 WHERE event_id=?',eventId);
  s.repo.run("UPDATE restaurant_order_dispatches SET status=CASE WHEN status IN ('accepted','rejected') THEN status ELSE 'unknown' END,last_sequence=?,remote_request_id=?,remote_order_id=?,error_code='POS_RECONCILIATION_REQUIRED',error_message=?,lease_token=NULL,lease_until=NULL,query_requested=0,version=version+1,updated_at=? WHERE change_id=?",r.sequence,r.remoteRequestId,r.remoteOrderId,message,orderNow(),c.id);
  if(!['accepted','rejected'].includes(c.status))s.repo.run("UPDATE restaurant_order_changes SET status='unknown',version=version+1,updated_at=? WHERE id=?",orderNow(),c.id);
  s.repo.run("UPDATE restaurant_orders SET control_mode='human',attention_reason=? WHERE id=?",message,o.id);s.ensureObligation(o);s.event(o,'provider','receipt_conflict',message,c.id);s.touch(o);s.syncStatus(o.id);return {duplicate:false,applied:false,conflict:true};
 };
 if(['accepted','rejected'].includes(d.status)){
  if(r.status===d.status){s.repo.run('UPDATE restaurant_order_dispatches SET last_sequence=? WHERE change_id=?',r.sequence,c.id);return {duplicate:false,applied:false,conflict:false};}
  if(r.status==='submitted')return {duplicate:false,applied:false,conflict:false};
  return conflict('收到相互矛盾的最终回执；原业务记录保留，请由店员向POS核对，不能自动重发或改账。');
 }
 if(d.error_code==='POS_RECONCILIATION_REQUIRED'||!['submitting','submitted','unknown'].includes(d.status))return conflict('远端事实与本地派单状态冲突，回执已保留，须人工核对。');
 if(r.status==='submitted'){
  s.repo.run("UPDATE restaurant_order_dispatches SET status='submitted',last_sequence=?,remote_request_id=?,remote_order_id=?,lease_token=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,version=version+1,updated_at=? WHERE change_id=?",r.sequence,r.remoteRequestId,r.remoteOrderId,orderNow(),c.id);
  s.repo.run("UPDATE restaurant_order_changes SET status='submitted',version=version+1,updated_at=? WHERE id=?",orderNow(),c.id);s.repo.run('UPDATE restaurant_pos_callbacks SET applied=1 WHERE event_id=?',eventId);s.event(o,'provider','channel_submitted','模拟渠道已接收请求，仍等待后厨接单。',c.id);s.touch(o);s.syncStatus(o.id);return {duplicate:false,applied:true,conflict:false};
 }
 // Preserve the trusted receipt even if applying local business facts fails.
 // Only the inventory/order projection is rolled back to this savepoint.
 const snap=JSON.parse(s.rawQuote(c.confirmed_quote_id!).payload) as QuoteSnapshot;
 s.repo.run('SAVEPOINT order_receipt_apply');
 try{
  if(r.status==='accepted'){
   if(s.total(o.id)!==snap.oldTotalMinor)throw new AppError('ORDER_TOTAL_CONFLICT','本地金额与原派单快照不一致。',409);
   s.inventory.accept(c,snap);
   for(const l of snap.lines.filter(l=>l.operation==='add')){
    s.repo.run('INSERT INTO restaurant_order_lines(id,order_id,change_id,item_id,sku_id,item_name,sku_name,unit_price_minor,quantity,preparation_note,dietary_tags,stock_tracked,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',l.lineId,o.id,c.id,l.itemId,l.skuId,l.itemName,l.skuName,l.unitPriceMinor,l.quantity,l.preparationNote,JSON.stringify(l.dietaryTags),+l.tracked,orderNow());
    s.repo.run('INSERT INTO restaurant_kitchen_tickets(id,restaurant_id,order_id,line_id,table_id,table_name,table_code,accepted_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',randomUUID(),o.restaurant_id,o.id,l.lineId,snap.tableId,snap.tableName,snap.tableCode,orderNow(),orderNow());
   }
   if(s.total(o.id)!==snap.newTotalMinor)throw new AppError('ORDER_TOTAL_CONFLICT','接单金额与原派单快照不一致。',409);
   s.repo.run('UPDATE restaurant_orders SET content_version=content_version+1,remote_order_id=? WHERE id=?',r.remoteOrderId,o.id);
  }else s.inventory.release(c,snap);
  s.repo.run('RELEASE SAVEPOINT order_receipt_apply');
 }catch(error){s.repo.run('ROLLBACK TO SAVEPOINT order_receipt_apply');s.repo.run('RELEASE SAVEPOINT order_receipt_apply');return conflict(error instanceof AppError?'回执已保留；'+error.message+' 请由店员核对。':'回执已保留，但本地应用异常，须由管理员核对库存和接单记录。');}
 s.repo.run('UPDATE restaurant_order_dispatches SET status=?,last_sequence=?,remote_request_id=?,remote_order_id=?,lease_token=NULL,lease_until=NULL,query_requested=0,error_code=?,error_message=?,version=version+1,updated_at=? WHERE change_id=?',r.status,r.sequence,r.remoteRequestId,r.remoteOrderId,r.status==='rejected'?'POS_REJECTED':null,r.status==='rejected'?'模拟后厨明确拒绝；预占库存已释放，需重新审阅或撤回。':null,orderNow(),c.id);
 s.repo.run('UPDATE restaurant_order_changes SET status=?,version=version+1,updated_at=? WHERE id=?',r.status,orderNow(),c.id);
 s.repo.run('UPDATE restaurant_orders SET pending_change_id=NULL,attention_reason=? WHERE id=?',r.status==='rejected'?'后厨明确拒绝此次变更；已接单菜品仍保留。':null,o.id);
 s.repo.run("UPDATE restaurant_order_quotes SET status=? WHERE id=?",r.status,c.confirmed_quote_id!);s.repo.run('UPDATE restaurant_pos_callbacks SET applied=1 WHERE event_id=?',eventId);
 s.event(o,'provider',r.status==='accepted'?'kitchen_accepted':'kitchen_rejected',r.status==='accepted'?'模拟后厨已接单，制作记录与价格快照已保存；尚未结算。':'模拟后厨明确拒绝本次变更；已释放此次预占及退菜锁定。',c.id);s.touch(o);s.syncStatus(o.id);
 return {duplicate:false,applied:true,conflict:false};
}
