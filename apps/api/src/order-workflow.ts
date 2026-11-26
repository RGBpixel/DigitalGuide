import { timingSafeEqual } from 'node:crypto';
import { AppError } from '@digitalguide/domain';
import { orderConfirmInput,orderSubmitInput,orderChangeFields,type POSMutation } from '@digitalguide/contracts';
import type { DiningActor } from './dining-service.js';
import type { SessionRow } from './reception-service.js';
import { diningPreference } from './dining-preference.js';
import type { ChangeRow,DispatchRow,OrderRow,QuoteSnapshot } from './order-types.js';
import type { OrderService } from './order-service.js';
import { orderHash,orderNow,orderToken } from './order-common.js';

export function confirm(s:OrderService,a:DiningActor,c:ChangeRow,raw:unknown){
 const input=orderConfirmInput.parse(raw);s.dining.focus(a,input.focusVersion);const o=s.order(a,c.order_id);s.writable(a,o);s.core.version(c,input.version);
 const q=s.rawQuote(input.quoteId),reason=s.quoteReason(a,q);if(q.change_id!==c.id||c.status!=='awaiting_confirmation'||reason)throw new AppError('ORDER_QUOTE_CHANGED',reason||'此审阅不属于当前待确认草稿。',409);
 const expected=Buffer.from(orderToken(s.config,q)),actual=Buffer.from(input.confirmationToken);if(actual.length!==expected.length||!timingSafeEqual(expected,actual))throw new AppError('ORDER_CONFIRMATION_INVALID','确认令牌无效，请重新审阅。',409);
 const snap=JSON.parse(q.payload) as QuoteSnapshot;if(snap.warnings.length&&!input.warningsAccepted)throw new AppError('ORDER_WARNING_CONFIRMATION','请先逐项核对并接受当前预算或辣度提示。',409);
 s.repo.run("UPDATE restaurant_order_changes SET status='confirmed',version=version+1,confirmed_at=?,confirmed_actor_id=?,confirmed_focus_version=?,confirmed_quote_id=?,updated_at=? WHERE id=?",orderNow(),a.p.userId,a.session?.focus_version??null,q.id,orderNow(),c.id);
 s.ensureObligation(o);s.event(o,a.p.userId,'confirmed','已确认当前审阅；尚未发送后厨。',c.id);s.touch(o);s.syncStatus(o.id);return c.id;
}
export function submit(s:OrderService,a:DiningActor,c:ChangeRow,raw:unknown){
 const input=orderSubmitInput.parse(raw);s.dining.focus(a,input.focusVersion);const o=s.order(a,c.order_id);s.writable(a,o);s.core.version(c,input.version);
 const q=s.rawQuote(input.quoteId),reason=s.quoteReason(a,q);if(q.change_id!==c.id||c.status!=='confirmed'||c.confirmed_quote_id!==q.id||c.confirmed_actor_id!==a.p.userId||c.confirmed_focus_version!==(a.session?.focus_version??null)||reason)throw new AppError('ORDER_QUOTE_CHANGED',reason||'请由本次确认人重新审阅并确认。',409);
 const snap=JSON.parse(q.payload) as QuoteSnapshot,r=s.core.raw(o.restaurant_id),cfg=s.posConfig(r.id)!,fields=orderChangeFields.parse(JSON.parse(c.input));
 const request:POSMutation={requestId:c.id,restaurantId:r.id,orderId:o.id,orderNumber:o.number,kind:c.kind,remoteOrderId:o.remote_order_id,bindingVersion:snap.partyAccessVersion,table:{id:snap.tableId,code:snap.tableCode,name:snap.tableName},currency:'CNY',previousTotalMinor:snap.oldTotalMinor,proposedTotalMinor:snap.newTotalMinor,adds:snap.lines.filter(l=>l.operation==='add').map(l=>({lineId:l.lineId,skuId:l.skuId,itemId:l.itemId,itemName:l.itemName,skuName:l.skuName,quantity:l.quantity,unitPriceMinor:l.unitPriceMinor,preparationNote:l.preparationNote,dietaryTags:l.dietaryTags})),reductions:snap.lines.filter(l=>l.operation==='reduce').map(l=>({lineId:l.lineId,quantity:l.quantity,unitPriceMinor:l.unitPriceMinor})),kitchenNote:fields.note};
 s.inventory.reserve(c,snap);
 s.repo.run('INSERT INTO restaurant_order_dispatches(change_id,restaurant_id,provider_id,config_version,config_snapshot,request_hash,request_payload,simulated,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',c.id,r.id,cfg.provider_id,cfg.version,JSON.stringify(cfg),orderHash(request),JSON.stringify(request),+(cfg.provider_id==='mock-pos'),orderNow(),orderNow());
 s.repo.run("UPDATE restaurant_order_changes SET status='queued',version=version+1,updated_at=? WHERE id=?",orderNow(),c.id);s.ensureObligation(o);s.event(o,a.p.userId,'queued','已持久保存派单及库存预占，等待发送；尚未接单。',c.id);s.touch(o);s.syncStatus(o.id);return c.id;
}
export function withdraw(s:OrderService,a:DiningActor,c:ChangeRow,version:number){
 const o=s.order(a,c.order_id);s.writable(a,o,true);s.core.version(c,version);
 if(!['draft','awaiting_confirmation','confirmed','queued','rejected','stale'].includes(c.status))throw new AppError('ORDER_RESULT_PENDING','此请求已发送或结果未知，不能按未发送撤回；请查询同一请求或联系店员。',409);
 if(c.status==='queued'){const d=s.dispatch(c.id);if(d.status!=='queued'||d.attempts)throw new AppError('ORDER_RESULT_PENDING','派单已经开始，请先核实同一请求。',409);s.inventory.release(c,JSON.parse(s.rawQuote(c.confirmed_quote_id!).payload));s.repo.run("UPDATE restaurant_order_dispatches SET status='cancelled',version=version+1,updated_at=? WHERE change_id=?",orderNow(),c.id);}
 s.repo.run("UPDATE restaurant_order_changes SET status='withdrawn',version=version+1,updated_at=? WHERE id=?",orderNow(),c.id);s.repo.run("UPDATE restaurant_order_quotes SET status='withdrawn' WHERE change_id=? AND status='current'",c.id);s.repo.run('UPDATE restaurant_orders SET pending_change_id=NULL,attention_reason=NULL WHERE id=? AND (pending_change_id=? OR pending_change_id IS NULL)',o.id,c.id);
 s.event(o,a.p.userId,'withdrawn','已撤回尚未发送或已明确拒绝的变更；已接单菜品保留。',c.id);s.touch(o);s.syncStatus(o.id);return c.id;
}
export function control(s:OrderService,a:DiningActor,o:OrderRow,version:number,action:'handoff'|'resume',reason:string){
 s.order(a,o.id);s.core.version(o,version);s.writable(a,o,true);if(action==='resume'&&a.session)throw new AppError('FORBIDDEN','请由店员核实后恢复自动处理。',403);
 if(action==='resume'&&s.repo.get("SELECT d.change_id FROM restaurant_order_dispatches d JOIN restaurant_order_changes c ON c.id=d.change_id WHERE c.order_id=? AND d.error_code='POS_RECONCILIATION_REQUIRED'",o.id))throw new AppError('POS_RECONCILIATION_REQUIRED','存在矛盾或未能应用的远端回执，须核实POS与实际制作情况；本地恢复按钮不能把它标为已解决。',409);
 if(action==='handoff'&&o.pending_change_id){const c=s.rawChange(o.pending_change_id);if(c.status==='queued')withdraw(s,a,c,c.version);}
 s.repo.run('UPDATE restaurant_orders SET control_mode=?,attention_reason=? WHERE id=?',action==='handoff'?'human':'automatic',action==='handoff'?'已请求店员核对；已发送的请求仍须核实结果。':null,o.id);s.event(o,a.p.userId,action==='handoff'?'human_handoff':'automatic_resumed',reason);s.touch(o);s.syncStatus(o.id);return o.id;
}
// Called immediately before the first network send, inside the claim transaction.
// Stock/menu versions have already changed through our own reservation: the frozen
// price remains authoritative, while ownership and authorization must still hold.
export function beforeSend(s:OrderService,d:DispatchRow):QuoteSnapshot {
 const c=s.rawChange(d.change_id),o=s.raw(c.order_id),q=s.rawQuote(c.confirmed_quote_id!),snap=JSON.parse(q.payload) as QuoteSnapshot;
 let a:DiningActor;
 if(q.session_id){const session=s.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?',q.session_id);if(!session||session.status!=='active'||session.expires_at<=orderNow()||session.focus_version!==q.focus_version)throw new AppError('ORDER_ISSUER_CHANGED','发送前发问人或会话已变化，未发送请求已停止。',409);a={session,p:{userId:'guest:'+session.id,tenantId:session.tenant_id,workspaceIds:[session.workspace_id],role:'viewer'}};}
 else a={p:s.repo.principal(q.actor_id)};
 const {party:p,occupancy,table,restaurant:r}=s.seated(a,o),pref=diningPreference(s.repo,p),cfg=s.posConfig(r.id);
 if(o.control_mode==='human'||p.access_version!==snap.partyAccessVersion||p.version!==snap.partyVersion||occupancy.id!==snap.occupancyId||table.id!==snap.tableId||table.version!==snap.tableVersion||r.version!==snap.restaurantVersion||!pref?.usable||pref.id!==snap.preferenceId||orderHash(pref)!==snap.preferenceHash||!cfg?.enabled||cfg.version!==d.config_version||cfg.provider_id!==d.provider_id||q.expires_at<=orderNow())throw new AppError('ORDER_SOURCE_CHANGED','发送前归属、桌位、偏好、授权、连接或确认期限已变化，未发送请求已停止。',409);
 s.provider(d.provider_id);return snap;
}
