import { randomUUID } from 'node:crypto';
import { AppError } from '@digitalguide/domain';
import { orderChangeFields, orderChangeInput, orderChangeUpdateInput, quoteLineSchema,type OrderQuote } from '@digitalguide/contracts';
import type { DiningActor } from './dining-service.js';
import { diningPreference } from './dining-preference.js';
import type { MenuItemRow, MenuSkuRow } from './restaurant-service.js';
import type { ChangeRow, QuoteRow, QuoteSnapshot, QuoteLineInternal } from './order-types.js';
import type { OrderService } from './order-service.js';
import { orderHash, orderNow, orderToken } from './order-common.js';

function normalize(s:OrderService, orderId:string, kind:ChangeRow['kind'], raw:unknown) {
 const {newLines,reductions,shareDietary,note,recommendationId}=raw as Record<string,unknown>;
 const input=orderChangeFields.parse({newLines,reductions,shareDietary,note,recommendationId});
 if(kind==='cancel') {
  if(input.newLines.length)throw new AppError('ORDER_CANCEL_ADDS','整单取消不能同时加菜。',409);
  input.reductions=s.lines(orderId).filter(l=>l.quantity>l.cancelled_quantity).map(l=>({lineId:l.id,quantity:l.quantity-l.cancelled_quantity}));
 }
 if(!input.newLines.length&&!input.reductions.length)throw new AppError('ORDER_EMPTY','请选择菜品或要退的未制作数量。',409);
 if(new Set(input.reductions.map(l=>l.lineId)).size!==input.reductions.length)throw new AppError('ORDER_DUPLICATE_REDUCTION','同一道已接单菜品只能填写一次退菜数量。',409);
 if(kind==='initial'&&input.reductions.length)throw new AppError('ORDER_INITIAL_REDUCTION','首次点单不能退已有菜品。',409);
 for(const l of input.newLines)if(!s.repo.get('SELECT id FROM restaurant_menu_skus WHERE id=? AND restaurant_id=(SELECT restaurant_id FROM restaurant_orders WHERE id=?) AND archived=0',l.skuId,orderId))throw new AppError('NOT_FOUND','菜品规格不在本门店当前菜单。',404);
 for(const l of input.reductions)if(!s.repo.get('SELECT id FROM restaurant_order_lines WHERE id=? AND order_id=?',l.lineId,orderId))throw new AppError('NOT_FOUND','待退菜品不在此订单。',404);
 return input;
}
export function createChange(s:OrderService,a:DiningActor,partyId:string,raw:unknown,sourceRequestId?:string) {
 const input=orderChangeInput.parse(raw),p=s.dining.party(a,partyId);s.dining.focus(a,input.focusVersion);s.dining.usable(p);
 let o=s.current(a,partyId);
 if(!o){if(input.orderVersion!==0||input.kind!=='initial')throw new AppError('ORDER_CHANGED','当前没有未结束订单，请重新开始首次点单。',409);
  const id=randomUUID();s.repo.run('UPDATE restaurants SET order_counter=order_counter+1 WHERE id=?',p.restaurant_id);const n=s.repo.get<{order_counter:number}>('SELECT order_counter FROM restaurants WHERE id=?',p.restaurant_id)!.order_counter;
  s.repo.run('INSERT INTO restaurant_orders(id,restaurant_id,party_id,number,created_at,updated_at) VALUES (?,?,?,?,?,?)',id,p.restaurant_id,p.id,'O-'+String(n).padStart(6,'0'),orderNow(),orderNow());o=s.raw(id);
 }else s.core.version(o,input.orderVersion);
 s.writable(a,o);
 if(o.pending_change_id)throw new AppError('ORDER_CHANGE_PENDING','已有一份未完成变更，请先完成、撤回或核对其回执。',409);
 const hasLines=s.lines(o.id).some(l=>l.quantity>l.cancelled_quantity);
 if((input.kind==='initial')===hasLines)throw new AppError('ORDER_KIND_CHANGED',hasLines?'当前已有接单菜品，请选择加菜/改单。':'当前没有接单菜品，请使用首次点单。',409);
 const fields=normalize(s,o.id,input.kind,input),id=randomUUID(),sequence=s.repo.get<{n:number}>('SELECT COALESCE(max(sequence),0)+1 n FROM restaurant_order_changes WHERE order_id=?',o.id)!.n;
 if(sequence>500)throw new AppError('ORDER_CHANGE_LIMIT','本订单变更记录较多，请由店员核对后处理。',409);
 s.repo.run('INSERT INTO restaurant_order_changes(id,order_id,kind,sequence,base_content_version,input,source,source_request_id,actor_id,session_id,focus_version,party_access_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,o.id,input.kind,sequence,o.content_version,JSON.stringify(fields),sourceRequestId?'conversation':'manual',sourceRequestId||null,a.p.userId,a.session?.id||null,a.session?.focus_version??null,p.access_version,orderNow(),orderNow());
 s.repo.run('UPDATE restaurant_orders SET pending_change_id=?,attention_reason=NULL WHERE id=?',id,o.id);s.event(o,a.p.userId,'draft_created','已保存可编辑点单草稿；尚未下单。',id);s.touch(o);s.syncStatus(o.id);return id;
}
export function updateChange(s:OrderService,a:DiningActor,c:ChangeRow,raw:unknown) {
 const input=orderChangeUpdateInput.parse(raw),o=s.order(a,c.order_id),p=s.writable(a,o);s.dining.focus(a,input.focusVersion);s.core.version(c,input.version);
 if(!['draft','awaiting_confirmation','confirmed'].includes(c.status))throw new AppError('ORDER_ALREADY_SENT','此变更已进入派单或已结束，请核对结果后新建变更。',409);
 const fields=normalize(s,o.id,c.kind,input);s.repo.run("UPDATE restaurant_order_quotes SET status='superseded' WHERE change_id=? AND status='current'",c.id);
 s.repo.run("UPDATE restaurant_order_changes SET input=?,status='draft',version=version+1,base_content_version=?,actor_id=?,session_id=?,focus_version=?,party_access_version=?,current_quote_id=NULL,confirmed_at=NULL,confirmed_actor_id=NULL,confirmed_focus_version=NULL,confirmed_quote_id=NULL,updated_at=? WHERE id=?",JSON.stringify(fields),o.content_version,a.p.userId,a.session?.id||null,a.session?.focus_version??null,p.access_version,orderNow(),c.id);
 s.event(o,a.p.userId,'draft_updated','草稿已修改，旧审阅及确认失效。',c.id);s.touch(o);s.syncStatus(o.id);return c.id;
}
export function review(s:OrderService,a:DiningActor,c:ChangeRow,version:number) {
 const o=s.order(a,c.order_id);s.core.version(c,version);const {party:p,occupancy,table,restaurant:r}=s.seated(a,o);
 if(!['draft','awaiting_confirmation','confirmed'].includes(c.status)||o.pending_change_id!==c.id)throw new AppError('ORDER_REVIEW_LOCKED','此变更已派单或已结束，不能重新审阅。',409);
 if(c.base_content_version!==o.content_version)throw new AppError('ORDER_CONTENT_CHANGED','已接单明细已变化，请先重新保存草稿。',409);
 const pref=diningPreference(s.repo,p);if(!pref?.usable)throw new AppError('PREFERENCE_CONFIRMATION_REQUIRED',pref?.reason||'请先确认本次口味；未提供过敏信息也需要明确选择。',409);
 const connection=s.connection(r);if(!connection.configured)throw new AppError('POS_NOT_CONFIGURED',connection.notice,409);
 const input=normalize(s,o.id,c.kind,JSON.parse(c.input));if(input.recommendationId)s.dining.validateRecommendation(a,input.recommendationId);
 const lines:QuoteLineInternal[]=[],warnings:string[]=[],totals=new Map<string,number>(),matches=(tags:string[],needles:string[])=>needles.some(n=>tags.some(t=>t.toLowerCase().includes(n.toLowerCase())||n.toLowerCase().includes(t.toLowerCase())));
 for(const l of input.newLines){
  const sku=s.repo.get<MenuSkuRow>('SELECT * FROM restaurant_menu_skus WHERE id=? AND restaurant_id=? AND archived=0',l.skuId,r.id),item=sku?s.repo.get<MenuItemRow>('SELECT * FROM restaurant_menu_items WHERE id=?',sku.item_id):undefined;
  if(!sku||!item||!sku.on_sale||!item.listed)throw new AppError('MENU_UNAVAILABLE','草稿中有菜品停售或下架，请重新选择。',409);
  const qty=(totals.get(sku.id)||0)+l.quantity;totals.set(sku.id,qty);if(sku.stock_tracked&&sku.stock_remaining<qty)throw new AppError('ORDER_OUT_OF_STOCK',item.name+'可供数量不足，请调整份量。',409);
  const tags=[...JSON.parse(item.ingredient_tags),...JSON.parse(item.allergen_tags),...JSON.parse(item.may_contain_tags)] as string[],f=pref.preferences;
  if((f.avoids.length||f.allergyMode==='specified')&&(!item.allergen_info_complete||matches(tags,[...f.avoids,...f.allergens])))throw new AppError('ORDER_DIETARY_CHECK',item.name+'的成分信息不足或与本次避让成分冲突，请由店员核对后选择其他菜品。',409);
  if(f.allergyMode==='specified'&&!input.shareDietary)throw new AppError('ORDER_DIETARY_SHARING_REQUIRED','本次有明确需避开的过敏成分，请确认仅将必要避让提示交给后厨，或联系店员。',409);
  if(f.maxSpice!==null&&item.spice_level>f.maxSpice)warnings.push(item.name+'超过本次辣度范围');
  if(f.budgetPerDishMinor!==null&&sku.price_minor>f.budgetPerDishMinor)warnings.push(item.name+'超过本次单道菜预算');
  lines.push({operation:'add',lineId:randomUUID(),skuId:sku.id,itemId:item.id,itemName:item.name,skuName:sku.name,quantity:l.quantity,unitPriceMinor:sku.price_minor,subtotalMinor:l.quantity*sku.price_minor,preparationNote:l.preparationNote,dietaryTags:input.shareDietary?[...f.avoids,...f.allergens]:[],tracked:!!sku.stock_tracked,skuVersion:sku.version,itemVersion:item.version,ticketVersion:null});
 }
 for(const l of input.reductions){const old=s.lines(o.id).find(x=>x.id===l.lineId)!;const t=s.ticket(old.id);if(old.quantity-old.cancelled_quantity-t.started_quantity-t.pending_cancel_quantity<l.quantity)throw new AppError('KITCHEN_ALREADY_STARTED','退菜数量包含已开做或待退部分，请联系店员。',409);
  lines.push({operation:'reduce',lineId:old.id,skuId:old.sku_id,itemId:old.item_id,itemName:old.item_name,skuName:old.sku_name,quantity:l.quantity,unitPriceMinor:old.unit_price_minor,subtotalMinor:l.quantity*old.unit_price_minor,preparationNote:old.preparation_note,dietaryTags:JSON.parse(old.dietary_tags),tracked:!!old.stock_tracked,skuVersion:0,itemVersion:0,ticketVersion:t.version});
 }
 const oldTotalMinor=s.total(o.id),newTotalMinor=oldTotalMinor+lines.reduce((sum,l)=>sum+(l.operation==='add'?1:-1)*l.subtotalMinor,0);
 if(!Number.isSafeInteger(newTotalMinor)||newTotalMinor<0||newTotalMinor>100_000_000)throw new AppError('ORDER_AMOUNT_INVALID','订单总额超出本地处理范围。',409);
 const id=randomUUID(),expiresAt=new Date(Date.now()+120000).toISOString(),changeVersion=c.version+1,snapshot:QuoteSnapshot={id,orderId:o.id,changeId:c.id,changeVersion,contentVersion:o.content_version,inputHash:orderHash(input),restaurantId:r.id,restaurantVersion:r.version,partyId:p.id,partyVersion:p.version,partyAccessVersion:p.access_version,occupancyId:occupancy.id,tableId:table.id,tableVersion:table.version,tableName:table.name,tableCode:table.code,menuVersion:r.menu_version,posConfigVersion:connection.version,preferenceId:pref.id,preferenceHash:orderHash(pref),actorId:a.p.userId,sessionId:a.session?.id||null,focusVersion:a.session?.focus_version??null,expiresAt,oldTotalMinor,newTotalMinor,lines,warnings:[...new Set(warnings)],dietaryNotice:input.shareDietary?'仅分享本次必要避让成分；不包含顾客资料、喜好及聊天。':'未向后厨分享本次偏好资料。'};
 s.repo.run("UPDATE restaurant_order_quotes SET status='superseded' WHERE change_id=? AND status='current'",c.id);
 s.repo.run('INSERT INTO restaurant_order_quotes(id,change_id,change_version,hash,payload,actor_id,session_id,focus_version,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',id,c.id,changeVersion,orderHash(snapshot),JSON.stringify(snapshot),a.p.userId,snapshot.sessionId,snapshot.focusVersion,expiresAt,orderNow());
 s.repo.run("UPDATE restaurant_order_changes SET status='awaiting_confirmation',version=?,current_quote_id=?,confirmed_at=NULL,confirmed_actor_id=NULL,confirmed_quote_id=NULL,confirmed_focus_version=NULL,updated_at=? WHERE id=?",changeVersion,id,orderNow(),c.id);
 s.event(o,a.p.userId,'reviewed','已按当前桌位、价格、库存及本次偏好生成两分钟审阅。',c.id);s.touch(o);s.syncStatus(o.id);return c.id;
}
export function quoteReason(s:OrderService,a:DiningActor,q:QuoteRow):string|null {
 try{
  const c=s.change(a,q.change_id),o=s.order(a,c.order_id),snap=JSON.parse(q.payload) as QuoteSnapshot;
  if(q.actor_id!==a.p.userId||q.session_id!==(a.session?.id||null)||q.focus_version!==(a.session?.focus_version??null))return '审阅属于之前的操作人或发问人，请重新审阅。';
  if(q.status!=='current'||q.expires_at<=orderNow())return '审阅已到期或已被替代，请重新审阅。';
  if(!['awaiting_confirmation','confirmed'].includes(c.status)||c.current_quote_id!==q.id||c.version!==q.change_version+(c.status==='confirmed'?1:0)||c.base_content_version!==o.content_version||snap.contentVersion!==o.content_version||orderHash(JSON.parse(c.input))!==snap.inputHash)return '草稿或已接单内容已变化，请重新保存并审阅。';
  const {party:p,occupancy,table,restaurant:r}=s.seated(a,o),pref=diningPreference(s.repo,p);
  if(p.version!==snap.partyVersion||p.access_version!==snap.partyAccessVersion||occupancy.id!==snap.occupancyId||table.id!==snap.tableId||table.version!==snap.tableVersion||r.version!==snap.restaurantVersion)return '就餐记录、归属或桌位已变化，请重新审阅。';
  if(r.menu_version!==snap.menuVersion)return '菜单、价格或库存已更新，请重新审阅。';
  if(!pref?.usable||pref.id!==snap.preferenceId||orderHash(pref)!==snap.preferenceHash)return '本次偏好或来源授权已变化，请重新核对。';
  const connection=s.connection(r);if(!connection.configured||connection.version!==snap.posConfigVersion)return '后厨连接已变化，请重新审阅。';
  for(const l of snap.lines)if(l.operation==='reduce'&&s.ticket(l.lineId).version!==l.ticketVersion)return '制作进度已变化，请重新核对待退数量。';
  return null;
 }catch(e){if(e instanceof AppError)return e.message;throw e;}
}
export function quoteView(s:OrderService,a:DiningActor,q:QuoteRow):OrderQuote {
 s.change(a,q.change_id);const snap=JSON.parse(q.payload) as QuoteSnapshot,reason=quoteReason(s,a,q),canConfirm=!reason&&s.rawChange(q.change_id).status==='awaiting_confirmation';
 return {id:q.id,changeId:q.change_id,changeVersion:q.change_version,hash:q.hash,expiresAt:q.expires_at,valid:!reason,invalidReason:reason,canConfirm,confirmationToken:canConfirm?orderToken(s.config,q):null,menuVersion:snap.menuVersion,partyVersion:snap.partyVersion,tableName:snap.tableName,oldTotalMinor:snap.oldTotalMinor,newTotalMinor:snap.newTotalMinor,deltaMinor:snap.newTotalMinor-snap.oldTotalMinor,lines:snap.lines.map(l=>quoteLineSchema.strip().parse(l)),warnings:snap.warnings,dietaryNotice:snap.dietaryNotice,createdAt:q.created_at};
}
