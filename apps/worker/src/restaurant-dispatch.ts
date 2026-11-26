import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError } from '@digitalguide/domain';
import { posMutationSchema,type POSScenario } from '@digitalguide/contracts';
import { POSFailure } from '@digitalguide/providers';
import type { Config } from '../../api/src/config.js';
import { OrderService } from '../../api/src/order-service.js';
import type { DispatchRow,QuoteSnapshot } from '../../api/src/order-types.js';
import { orderHash,orderNow } from '../../api/src/order-common.js';

export async function runRestaurantDispatch(repo:Repository,config:Config,signal?:AbortSignal){
 const s=new OrderService(repo,config),lease=randomUUID(),claimed=repo.transaction(()=>{
  const scope='restaurant_id IN (SELECT id FROM restaurants WHERE environment=? AND app_env=?)',args=[config.providerMode,config.appEnv];
  for(const d of repo.all<DispatchRow>(`SELECT * FROM restaurant_order_dispatches WHERE ${scope} AND status='submitting' AND lease_until<=?`,...args,orderNow())){
   const c=s.rawChange(d.change_id),o=s.raw(c.order_id);repo.run("UPDATE restaurant_order_dispatches SET status='unknown',lease_token=NULL,lease_until=NULL,error_code='POS_SEND_INTERRUPTED',error_message='发送过程已中断，结果未知；只允许核对同一请求，不会自动重发。',version=version+1,updated_at=? WHERE change_id=?",orderNow(),c.id);repo.run("UPDATE restaurant_order_changes SET status='unknown',version=version+1,updated_at=? WHERE id=?",orderNow(),c.id);repo.run('UPDATE restaurant_orders SET attention_reason=? WHERE id=?','后厨派单结果未知，请查询同一请求或联系店员。',o.id);s.event(o,'worker','send_interrupted','发送租约到期，保留库存和义务，禁止自动重发。',c.id);s.touch(o);s.syncStatus(o.id);
  }
  const d=repo.get<DispatchRow>(`SELECT * FROM restaurant_order_dispatches WHERE ${scope} AND (lease_until IS NULL OR lease_until<=?) AND (status='queued' OR (status='submitted' AND lookups<3 AND (last_lookup_at IS NULL OR last_lookup_at<=?)) OR (status IN ('submitted','unknown') AND query_requested=1)) ORDER BY created_at,change_id LIMIT 1`,...args,orderNow(),new Date(Date.now()-1000).toISOString());
  if(!d)return null;
  const c=s.rawChange(d.change_id),o=s.raw(c.order_id),sending=d.status==='queued';
  if(sending){
   try{s.beforeSend(d);}catch(error){const snap=JSON.parse(s.rawQuote(c.confirmed_quote_id!).payload) as QuoteSnapshot;s.inventory.release(c,snap);const message=error instanceof AppError?error.message:'发送前检查失败，请由管理员核对，未发送请求已停止。';repo.run("UPDATE restaurant_order_dispatches SET status='stale',version=version+1,error_code='ORDER_SOURCE_CHANGED',error_message=?,updated_at=? WHERE change_id=?",message,orderNow(),c.id);repo.run("UPDATE restaurant_order_changes SET status='stale',version=version+1,updated_at=? WHERE id=?",orderNow(),c.id);repo.run('UPDATE restaurant_orders SET pending_change_id=NULL,attention_reason=? WHERE id=?',message,o.id);s.event(o,'worker','stopped_before_send',message,c.id);s.touch(o);s.syncStatus(o.id);return {stopped:true,d,sending};}
   if(d.attempts)throw new AppError('POS_RESEND_BLOCKED','本地请求已尝试发送，不能再次发送。',409);
  }
  repo.run('UPDATE restaurant_order_dispatches SET status=?,attempts=attempts+?,lookups=lookups+?,last_lookup_at=?,query_requested=0,lease_token=?,lease_until=?,version=version+1,updated_at=? WHERE change_id=?',sending?'submitting':d.status,+sending,+!sending,sending?d.last_lookup_at:orderNow(),lease,new Date(Date.now()+10000).toISOString(),orderNow(),c.id);
  if(sending){repo.run("UPDATE restaurant_order_changes SET status='submitting',version=version+1,updated_at=? WHERE id=?",orderNow(),c.id);s.event(o,'worker','sending','正在向显式配置的模拟后厨发送同一持久请求。',c.id);s.touch(o);s.syncStatus(o.id);}
  return {stopped:false,d:s.dispatch(d.change_id),sending};
 });
 if(!claimed)return false;if(claimed.stopped)return true;if(signal?.aborted)return true;
 const {d,sending}=claimed;
 try{
  const provider=s.provider(d.provider_id),receipt=sending?await provider.submit(posMutationSchema.parse(JSON.parse(d.request_payload)),(JSON.parse(d.config_snapshot) as {scenario:POSScenario}).scenario):await provider.lookup(d.change_id);
  if(signal?.aborted)return true;
  repo.transaction(()=>{
   const fresh=s.dispatch(d.change_id);if(fresh.lease_token!==lease||!fresh.lease_until||fresh.lease_until<=orderNow())return;
   if(receipt)s.applyReceipt(receipt,randomUUID(),orderHash(receipt));
   else{
    const unknown=fresh.status==='unknown'||fresh.lookups>=3,c=s.rawChange(d.change_id),o=s.raw(c.order_id);
    repo.run('UPDATE restaurant_order_dispatches SET status=?,lease_token=NULL,lease_until=NULL,error_code=?,error_message=?,version=version+1,updated_at=? WHERE change_id=?',unknown?'unknown':fresh.status,unknown?'POS_RESULT_UNRESOLVED':null,unknown?'尚未核实远端结果；库存继续保留，只查询原请求。':null,orderNow(),c.id);
    if(unknown){repo.run("UPDATE restaurant_order_changes SET status='unknown',version=version+1,updated_at=? WHERE id=?",orderNow(),c.id);repo.run('UPDATE restaurant_orders SET attention_reason=? WHERE id=?','远端结果尚未核实，请查询同一请求或联系店员。',o.id);s.event(o,'worker','lookup_unresolved','已核对原请求，远端尚无可确认结果；没有重新发送。',c.id);s.touch(o);s.syncStatus(o.id);}
   }
  });
 }catch(error){
  repo.transaction(()=>{const fresh=s.dispatch(d.change_id);if(fresh.lease_token!==lease)return;const c=s.rawChange(d.change_id),o=s.raw(c.order_id),code=error instanceof POSFailure?error.code:'POS_RESULT_UNKNOWN';
   repo.run("UPDATE restaurant_order_dispatches SET status='unknown',lease_token=NULL,lease_until=NULL,error_code=?,error_message='通信未能核实结果；保留预占及原请求，不会自动重发。',version=version+1,updated_at=? WHERE change_id=?",code,orderNow(),c.id);repo.run("UPDATE restaurant_order_changes SET status='unknown',version=version+1,updated_at=? WHERE id=?",orderNow(),c.id);repo.run('UPDATE restaurant_orders SET attention_reason=? WHERE id=?','通信结果未知，请核对同一请求。',o.id);s.event(o,'worker','result_unknown','通信结果未知，库存继续预占；请查询同一请求。',c.id);s.touch(o);s.syncStatus(o.id);
  });
 }
 return true;
}
