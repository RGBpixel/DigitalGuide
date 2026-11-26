import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError,type Principal } from '@digitalguide/domain';
import type { POSConfig,RestaurantOrder,OrderChange,OrderQuote,POSReceipt } from '@digitalguide/contracts';
import { posMutationSchema } from '@digitalguide/contracts';
import { selectPOSProvider,type MockPOSOperation } from '@digitalguide/providers';
import type { Config } from './config.js';
import { DiningFoodService } from './dining-food.js';
import type { DiningActor,PartyRow,OccupancyRow } from './dining-service.js';
import type { RestaurantRow,TableRow } from './restaurant-service.js';
import { OrderInventory } from './order-inventory.js';
import type { OrderRow,ChangeRow,QuoteRow,DispatchRow,LineRow,KitchenRow,POSConfigRow,QuoteSnapshot } from './order-types.js';
import { invalidateDiningReplies } from './restaurant-state.js';
import { orderNow } from './order-common.js';
import * as drafts from './order-drafts.js';
import * as workflow from './order-workflow.js';
import * as views from './order-views.js';
import { applyReceipt } from './order-receipts.js';
export class OrderService {
 dining:DiningFoodService;inventory:OrderInventory;
 constructor(public repo:Repository,public config:Config){this.dining=new DiningFoodService(repo,config);this.inventory=new OrderInventory(repo);}
 get core(){return this.dining.core;}
 raw(id:string){const o=this.repo.get<OrderRow>('SELECT o.* FROM restaurant_orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=? AND r.environment=? AND r.app_env=?',id,this.config.providerMode,this.config.appEnv);if(!o)throw new AppError('NOT_FOUND','订单不存在或不在当前环境。',404);return o;}
 order(a:DiningActor,id:string){const o=this.raw(id);this.dining.party(a,o.party_id);return o;}
 current(a:DiningActor,partyId:string){this.dining.party(a,partyId);return this.repo.get<OrderRow>("SELECT * FROM restaurant_orders WHERE party_id=? AND settlement_status='unsettled' AND status NOT IN ('closed','cancelled') ORDER BY created_at DESC LIMIT 1",partyId);}
 rawChange(id:string){const c=this.repo.get<ChangeRow>('SELECT * FROM restaurant_order_changes WHERE id=?',id);if(!c)throw new AppError('NOT_FOUND','订单变更不存在。',404);this.raw(c.order_id);return c;}
 change(a:DiningActor,id:string){const c=this.rawChange(id);this.order(a,c.order_id);return c;}
 rawQuote(id:string){const q=this.repo.get<QuoteRow>('SELECT * FROM restaurant_order_quotes WHERE id=?',id);if(!q)throw new AppError('NOT_FOUND','订单审阅不存在。',404);this.rawChange(q.change_id);return q;}
 dispatch(id:string){const d=this.repo.get<DispatchRow>('SELECT * FROM restaurant_order_dispatches WHERE change_id=?',id);if(!d)throw new AppError('NOT_FOUND','本次变更尚未派单。',404);this.rawChange(id);return d;}
 lines(orderId:string){return this.repo.all<LineRow>('SELECT * FROM restaurant_order_lines WHERE order_id=? ORDER BY created_at,id',orderId);}
 ticket(lineId:string){const t=this.repo.get<KitchenRow>('SELECT * FROM restaurant_kitchen_tickets WHERE line_id=?',lineId);if(!t)throw new AppError('KITCHEN_RECORD_MISSING','制作记录不完整，请由店员核对，不能自动推断已出餐。',409);return t;}
 posConfig(restaurantId:string){this.core.raw(restaurantId);return this.repo.get<POSConfigRow>('SELECT * FROM restaurant_pos_configs WHERE restaurant_id=?',restaurantId);}
 connection(r:RestaurantRow,p?:Principal):POSConfig {const c=this.posConfig(r.id),mockAllowed=this.config.providerMode==='mock'&&this.config.appEnv!=='production',configured=!!c?.enabled&&c.provider_id==='mock-pos'&&mockAllowed;return {restaurantId:r.id,providerId:c?.provider_id||null,enabled:!!c?.enabled,scenario:c?.scenario||null,version:c?.version||0,configured,simulated:c?.provider_id==='mock-pos',mockAllowed,canManage:!!p&&this.core.can(p,r,true),notice:configured?'显式模拟后厨连接；无真实POS、通知或付款。':c?.provider_id==='external-pos'?'真实POS尚未接入，请联系门店经理配置；不会返回模拟成功。':'尚未配置后厨连接，可先编辑草稿；提交前请联系门店经理。'};}
 configure(p:Principal,r:RestaurantRow,input:{version:number;providerId:'mock-pos'|'external-pos';enabled:boolean;scenario:POSConfigRow['scenario']}){this.core.row(p,r.id,true);const old=this.posConfig(r.id);if((old?.version||0)!==input.version)throw new AppError('VERSION_CONFLICT','后厨连接已变化，请重新载入。',409);if(input.providerId==='mock-pos'&&(this.config.providerMode!=='mock'||this.config.appEnv==='production'))throw new AppError('MOCK_DISABLED','当前环境不能启用模拟后厨。',409);this.repo.run('INSERT INTO restaurant_pos_configs(restaurant_id,provider_id,enabled,scenario,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(restaurant_id) DO UPDATE SET provider_id=excluded.provider_id,enabled=excluded.enabled,scenario=excluded.scenario,version=restaurant_pos_configs.version+1,updated_at=excluded.updated_at',r.id,input.providerId,+input.enabled,input.scenario,orderNow(),orderNow());invalidateDiningReplies(this.repo,r.id);return r.id;}
 provider(providerId:string){return selectPOSProvider(providerId,this.config.providerMode,this.config.appEnv,{
  get:(id)=>{const row=this.repo.get<{change_id:string;restaurant_id:string;request_hash:string;payload:string;remote_request_id:string;remote_order_id:string;outcome:'accepted'|'rejected';sequence:number}>('SELECT m.* FROM mock_pos_operations m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.change_id=? AND r.environment=? AND r.app_env=?',id,this.config.providerMode,this.config.appEnv);if(!row)return undefined;return {requestId:row.change_id,restaurantId:row.restaurant_id,requestHash:row.request_hash,payload:posMutationSchema.parse(JSON.parse(row.payload)),remoteRequestId:row.remote_request_id,remoteOrderId:row.remote_order_id,outcome:row.outcome,sequence:row.sequence};},
  put:(row:MockPOSOperation)=>this.repo.transaction(()=>{this.core.raw(row.restaurantId);const old=this.repo.get<{request_hash:string}>('SELECT request_hash FROM mock_pos_operations WHERE change_id=?',row.requestId);if(old){if(old.request_hash!==row.requestHash)throw new AppError('POS_REQUEST_CONFLICT','远端请求编号对应了不同内容，须人工核对。',409);return;}this.repo.run('INSERT INTO mock_pos_operations VALUES (?,?,?,?,?,?,?,?,?)',row.requestId,row.restaurantId,row.requestHash,JSON.stringify(row.payload),row.remoteRequestId,row.remoteOrderId,row.outcome,row.sequence,orderNow());})
 });}
 writableReason(a:DiningActor,o:OrderRow,allowHuman=false){const p=this.dining.party(a,o.party_id);if(!['waiting','reserved','held','seated'].includes(p.status))return '本次就餐已结束，请联系店员处理历史记录。';if(this.repo.get("SELECT f.id FROM restaurant_financial_operations f JOIN restaurant_bills b ON b.id=f.bill_id WHERE b.order_id=? AND (f.status IN ('queued','submitting','pending','unknown','needs_attention') OR EXISTS (SELECT 1 FROM restaurant_financial_postings p WHERE p.operation_id=f.id AND p.kind='payment'))",o.id))return '本单有待核实或已入账资金，请先在账单中核对；已付款后加菜需建立新订单。';if(o.settlement_status==='settled'||['closed','cancelled'].includes(o.status))return '本订单已结束；如需继续用餐请建立新订单。';if(a.session?.status!=='active'&&a.session)return '当前会话已暂停自动处理，请联系工作人员。';if(o.control_mode==='human'&&!allowHuman)return '本订单正在人工处理，请等待店员核对。';return null;}
 writable(a:DiningActor,o:OrderRow,allowHuman=false){const reason=this.writableReason(a,o,allowHuman);if(reason)throw new AppError('ORDER_NOT_WRITABLE',reason,409);return this.dining.party(a,o.party_id);}
 seated(a:DiningActor,o:OrderRow):{party:PartyRow;occupancy:OccupancyRow;table:TableRow;restaurant:RestaurantRow}{const p=this.writable(a,o),r=this.dining.restaurant(a,o.restaurant_id),occupancy=this.repo.get<OccupancyRow>("SELECT * FROM dining_occupancies WHERE party_id=? AND state='seated'",p.id);if(p.status!=='seated'||!occupancy)throw new AppError('ORDER_SEATING_REQUIRED','可以先保存点单草稿，请实际入座后再审阅确认下单。',409);const table=this.dining.table(occupancy.table_id,r);if(!table.enabled||table.operation!=='open')throw new AppError('ORDER_TABLE_CHANGED','当前桌位状态需店员核对，暂不能提交旧确认。',409);return {party:p,occupancy,table,restaurant:r};}
 total(orderId:string){const total=this.repo.get<{n:number}>('SELECT COALESCE(sum((quantity-cancelled_quantity)*unit_price_minor),0) n FROM restaurant_order_lines WHERE order_id=?',orderId)!.n;if(!Number.isSafeInteger(total)||total<0||total>100_000_000)throw new AppError('ORDER_AMOUNT_INVALID','订单金额超出本地可处理范围，请由门店经理核对。',409);return total;}
 event(o:OrderRow,actorId:string,kind:string,message:string,changeId:string|null=null){this.repo.run('INSERT INTO restaurant_order_events VALUES (?,?,?,?,?,?,?)',randomUUID(),o.id,changeId,actorId,kind,JSON.stringify({message}),orderNow());}
 touch(o:OrderRow){this.repo.run('UPDATE restaurant_orders SET version=version+1,updated_at=? WHERE id=?',orderNow(),o.id);invalidateDiningReplies(this.repo,o.restaurant_id,o.party_id);}
 syncStatus(id:string){const o=this.raw(id),lines=this.lines(id),active=lines.filter(l=>l.quantity>l.cancelled_quantity),pending=o.pending_change_id?this.repo.get<ChangeRow>('SELECT * FROM restaurant_order_changes WHERE id=?',o.pending_change_id):undefined;let status:RestaurantOrder['status'];
  const disputed=!!this.repo.get("SELECT d.change_id FROM restaurant_order_dispatches d JOIN restaurant_order_changes c ON c.id=d.change_id WHERE c.order_id=? AND (d.status IN ('submitting','submitted','unknown') OR d.error_code='POS_RECONCILIATION_REQUIRED')",id);
  if(o.settlement_status==='settled'&&!pending&&!disputed&&active.every(l=>this.ticket(l.id).served_quantity===l.quantity-l.cancelled_quantity))status='closed';
  else if(active.length){const tickets=active.map(l=>({l,t:this.ticket(l.id)}));status=tickets.every(({l,t})=>t.served_quantity===l.quantity-l.cancelled_quantity)?'served':tickets.every(({l,t})=>t.ready_quantity===l.quantity-l.cancelled_quantity)?'ready':tickets.some(({t})=>t.started_quantity>0)?'preparing':'accepted';}
  else if(pending&&['draft','awaiting_confirmation','confirmed','queued','submitting','submitted'].includes(pending.status))status=pending.status as RestaurantOrder['status'];
  else {const latest=this.repo.get<ChangeRow>('SELECT * FROM restaurant_order_changes WHERE order_id=? ORDER BY sequence DESC LIMIT 1',id);status=lines.length||latest?.status==='withdrawn'?'cancelled':latest&&['rejected','stale','unknown'].includes(latest.status)?'needs_attention':'draft';}
  this.repo.run('UPDATE restaurant_orders SET status=? WHERE id=?',status,id);if(['closed','cancelled'].includes(status)&&!pending&&!disputed)this.repo.run("UPDATE dining_obligations SET active=0 WHERE reference_id=? AND kind='order'",o.id);return status;
 }
 ensureObligation(o:OrderRow){this.repo.run("INSERT INTO dining_obligations(id,party_id,kind,reference_id,active,created_at) VALUES (?,?,'order',?,1,?) ON CONFLICT(kind,reference_id) DO UPDATE SET active=1",randomUUID(),o.party_id,o.id,orderNow());}
 kitchenPermission(p:Principal,r:RestaurantRow,action:'read'|'cook'|'serve'='read'){try{p=this.repo.principal(p.userId);}catch{return false;}if(p.tenantId!==r.tenant_id||!p.workspaceIds.includes(r.workspace_id))return false;if(p.role==='admin')return true;const grant=this.repo.get<{role:string}>('SELECT role FROM restaurant_staff WHERE restaurant_id=? AND user_id=? AND enabled=1 AND (expires_at IS NULL OR expires_at>?)',r.id,p.userId,orderNow());return grant?.role==='manager'||action==='read'&&['host','kitchen'].includes(grant?.role||'')||action==='cook'&&grant?.role==='kitchen'||action==='serve'&&grant?.role==='host';}
 kitchenRestaurant(p:Principal,id:string,action:'read'|'cook'|'serve'='read'){const r=this.core.raw(id);if(!this.kitchenPermission(p,r,action))throw new AppError('NOT_FOUND','没有此门店相应后厨或上菜权限。',404);return r;}
 createChange(a:DiningActor,partyId:string,input:unknown,sourceRequestId?:string){return drafts.createChange(this,a,partyId,input,sourceRequestId);}
 updateChange(a:DiningActor,c:ChangeRow,input:unknown){return drafts.updateChange(this,a,c,input);}
 review(a:DiningActor,c:ChangeRow,version:number){return drafts.review(this,a,c,version);}
 quoteReason(a:DiningActor,q:QuoteRow){return drafts.quoteReason(this,a,q);}
 quoteView(a:DiningActor,q:QuoteRow):OrderQuote{return drafts.quoteView(this,a,q);}
 confirm(a:DiningActor,c:ChangeRow,input:unknown){return workflow.confirm(this,a,c,input);}
 submit(a:DiningActor,c:ChangeRow,input:unknown){return workflow.submit(this,a,c,input);}
 withdraw(a:DiningActor,c:ChangeRow,version:number){return workflow.withdraw(this,a,c,version);}
 control(a:DiningActor,o:OrderRow,version:number,action:"handoff"|"resume",reason:string){return workflow.control(this,a,o,version,action,reason);}
 changeView(a:DiningActor,c:ChangeRow):OrderChange{return views.changeView(this,a,c);}
 view(a:DiningActor,o:OrderRow):RestaurantOrder{return views.view(this,a,o);}
 applyReceipt(receipt:POSReceipt,eventId:string,payloadHash:string){return applyReceipt(this,receipt,eventId,payloadHash);}
 beforeSend(dispatch:DispatchRow):QuoteSnapshot{return workflow.beforeSend(this,dispatch);}
}
