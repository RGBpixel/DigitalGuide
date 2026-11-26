import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError } from '@digitalguide/domain';
import { financialRequestSchema,type FinancialScenario } from '@digitalguide/contracts';
import { FinancialFailure } from '@digitalguide/providers';
import type { Config } from '../../api/src/config.js';
import { BillingService } from '../../api/src/billing-service.js';
import type { FinancialOperationRow } from '../../api/src/billing-types.js';
import { orderNow,orderHash } from '../../api/src/order-common.js';

export async function runFinancialOperation(repo:Repository,config:Config,signal?:AbortSignal){
 const s=new BillingService(repo,config),lease=randomUUID(),claim=repo.transaction(()=>{
  const scope='bill_id IN (SELECT b.id FROM restaurant_bills b JOIN restaurants r ON r.id=b.restaurant_id WHERE r.environment=? AND r.app_env=?)',args=[config.providerMode,config.appEnv];
  for(const op of repo.all<FinancialOperationRow>(`SELECT * FROM restaurant_financial_operations WHERE ${scope} AND lease_token IS NOT NULL AND lease_until<=?`,...args,orderNow())){
   const attention=op.status==='needs_attention'||op.error_code==='FINANCIAL_RECONCILIATION_REQUIRED';repo.run('UPDATE restaurant_financial_operations SET status=?,lease_token=NULL,lease_until=NULL,lease_action=NULL,next_action=NULL,error_code=?,error_message=?,version=version+1,updated_at=? WHERE id=?',attention?'needs_attention':'unknown',attention?'FINANCIAL_RECONCILIATION_REQUIRED':'FINANCIAL_OPERATION_INTERRUPTED',attention?op.error_message:'上次操作中断，结果待核实；保留原编号和退款额度，不会自动重发资金操作。',orderNow(),op.id);const b=s.raw(op.bill_id);s.event(b,'worker','financial_interrupted','操作租约到期，保留原请求，只能核对原结果。',op.id);s.touch(b);s.refresh(b.id);
  }
  const op=repo.get<FinancialOperationRow>(`SELECT * FROM restaurant_financial_operations WHERE ${scope} AND lease_token IS NULL AND (status='queued' OR (status IN ('pending','unknown','needs_attention') AND next_action IS NOT NULL) OR (kind='refund' AND status='pending' AND lookups<3 AND (last_lookup_at IS NULL OR last_lookup_at<=?))) ORDER BY created_at,id LIMIT 1`,...args,new Date(Date.now()-1000).toISOString());if(!op)return null;
  const action=op.status==='queued'?'send':op.next_action||'query',b=s.raw(op.bill_id);
  if(action==='send'){
   try{s.beforeSend(op);}catch(e){repo.run("UPDATE restaurant_financial_operations SET status='stale',error_code='FINANCIAL_SOURCE_CHANGED',error_message=?,version=version+1,updated_at=? WHERE id=?",e instanceof AppError?e.message:'发送前检查未完成，未发送请求已停止，请重新核对。',orderNow(),op.id);s.event(b,'worker','financial_stopped_before_send','来源、权限、金额或连接变化，未发送请求已停止。',op.id);s.touch(b);s.refresh(b.id);return {stopped:true,op,action};}
   if(op.send_attempts)throw new AppError('FINANCIAL_RESEND_BLOCKED','此财务请求已经尝试发送，不得自动重发。',409);
  }
  if(action==='simulate'){
   try{s.beforeSimulate(op);if(op.simulate_attempts)throw new AppError('MOCK_PAYMENT_ALREADY_ATTEMPTED','模拟付款已经尝试过，请查询原结果。',409);}catch(e){repo.run('UPDATE restaurant_financial_operations SET next_action=NULL,error_code=?,error_message=?,version=version+1,updated_at=? WHERE id=?','FINANCIAL_ACTION_BLOCKED',e instanceof AppError?e.message:'本次付款确认来源已变化，请核对原收银入口。',orderNow(),op.id);s.event(b,'worker','simulate_blocked','未执行新的模拟付款，保留原支付入口待核实。',op.id);s.touch(b);return {stopped:true,op,action};}
  }
  repo.run('UPDATE restaurant_financial_operations SET status=?,send_attempts=send_attempts+?,simulate_attempts=simulate_attempts+?,lookups=lookups+?,last_lookup_at=?,next_action=NULL,lease_action=?,lease_token=?,lease_until=?,version=version+1,updated_at=? WHERE id=?',action==='send'?'submitting':op.status,+(action==='send'),+(action==='simulate'),+(action==='query'),action==='query'?orderNow():op.last_lookup_at,action,lease,new Date(Date.now()+10000).toISOString(),orderNow(),op.id);s.touch(b);s.refresh(b.id);return {stopped:false,op:s.rawOperation(op.id),action};
 });
 if(!claim)return false;if(claim.stopped||signal?.aborted)return true;const {op,action}=claim;
 try{
  const provider=s.provider(op.provider_id),scenario=(JSON.parse(op.config_snapshot) as {scenario:FinancialScenario}).scenario;
  const receipt=action==='send'?op.kind==='payment'?await provider.createCheckout(financialRequestSchema.parse(JSON.parse(op.request_payload)),scenario):await provider.submitRefund(financialRequestSchema.parse(JSON.parse(op.request_payload)),scenario):action==='simulate'?await provider.simulateCheckout(op.id,scenario):action==='close'?await provider.closeCheckout(op.id):await provider.lookup(op.id);
  if(signal?.aborted)return true;
  repo.transaction(()=>{const fresh=s.rawOperation(op.id);if(fresh.lease_token!==lease||!fresh.lease_until||fresh.lease_until<=orderNow())return;const b=s.raw(op.bill_id);
   if(receipt)s.applyReceipt(receipt,randomUUID(),orderHash(receipt));
   const after=s.rawOperation(op.id);if(after.lease_token===lease){const attention=after.status==='needs_attention'||after.error_code==='FINANCIAL_RECONCILIATION_REQUIRED',unknown=!attention&&!receipt&&(after.status==='unknown'||after.kind==='refund'&&after.lookups>=3||action==='close');repo.run('UPDATE restaurant_financial_operations SET status=?,lease_token=NULL,lease_until=NULL,lease_action=NULL,error_code=?,error_message=?,version=version+1,updated_at=? WHERE id=?',attention?'needs_attention':unknown?'unknown':after.status,attention?'FINANCIAL_RECONCILIATION_REQUIRED':unknown?'FINANCIAL_RESULT_UNRESOLVED':after.error_code,unknown?'尚未核实原请求结果，保留原编号和额度，请查询或联系店员。':after.error_message,orderNow(),op.id);s.touch(b);s.refresh(b.id);}
  });
 }catch(e){repo.transaction(()=>{const fresh=s.rawOperation(op.id);if(fresh.lease_token!==lease)return;const b=s.raw(op.bill_id),attention=fresh.status==='needs_attention'||fresh.error_code==='FINANCIAL_RECONCILIATION_REQUIRED';repo.run('UPDATE restaurant_financial_operations SET status=?,lease_token=NULL,lease_until=NULL,lease_action=NULL,error_code=?,error_message=?,version=version+1,updated_at=? WHERE id=?',attention?'needs_attention':'unknown',attention?'FINANCIAL_RECONCILIATION_REQUIRED':e instanceof FinancialFailure?e.code:'FINANCIAL_RESULT_UNKNOWN',attention?fresh.error_message:'通信结果未核实，保留原编号及额度；不会自动重发支付或退款。',orderNow(),op.id);s.event(b,'worker','financial_result_unknown','本次通信结果待核实，只查询原请求，不重发资金操作。',op.id);s.touch(b);s.refresh(b.id);});}
 return true;
}
