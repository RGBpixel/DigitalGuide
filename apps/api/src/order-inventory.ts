import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError } from '@digitalguide/domain';
import type { QuoteSnapshot,ChangeRow,InventoryReservation,KitchenRow,LineRow } from './order-types.js';
import type { MenuSkuRow } from './restaurant-service.js';
import { diningMenuChanged } from './restaurant-state.js';
const now=()=>new Date().toISOString();
export class OrderInventory {
 constructor(public repo:Repository){}
 private move(restaurantId:string,changeId:string,skuId:string,before:number,after:number,kind:'reserve'|'release'|'cancel_return'){
  this.repo.run('INSERT INTO restaurant_stock_movements VALUES (?,?,?,?,?,?,?,?)',randomUUID(),restaurantId,skuId,changeId,kind,before,after,now());
  this.repo.run('UPDATE restaurant_menu_skus SET stock_remaining=?,version=version+1 WHERE id=?',after,skuId);
  this.repo.run('UPDATE restaurant_menu_items SET version=version+1 WHERE id=(SELECT item_id FROM restaurant_menu_skus WHERE id=?)',skuId);
 }
 reserve(change:ChangeRow,s:QuoteSnapshot){
  const totals=new Map<string,{quantity:number;tracked:boolean;version:number}>();
  for(const l of s.lines.filter(l=>l.operation==='add')){const old=totals.get(l.skuId);totals.set(l.skuId,{quantity:(old?.quantity||0)+l.quantity,tracked:l.tracked,version:l.skuVersion});}
  let changed=false;
  for(const [skuId,total] of totals){
   const sku=this.repo.get<MenuSkuRow>('SELECT * FROM restaurant_menu_skus WHERE id=? AND restaurant_id=? AND archived=0',skuId,s.restaurantId);
   if(!sku||sku.version!==total.version||!sku.on_sale||(total.tracked&&sku.stock_remaining<total.quantity))throw new AppError('ORDER_STOCK_CHANGED','可供库存或规格已变化，请重新审阅后确认。',409);
   this.repo.run('INSERT INTO restaurant_inventory_reservations(id,change_id,sku_id,quantity,tracked,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',randomUUID(),change.id,skuId,total.quantity,+total.tracked,now(),now());
   if(total.tracked){this.move(s.restaurantId,change.id,skuId,sku.stock_remaining,sku.stock_remaining-total.quantity,'reserve');changed=true;}
  }
  for(const l of s.lines.filter(l=>l.operation==='reduce')){
   const row=this.repo.get<KitchenRow&{quantity:number;cancelled_quantity:number}>('SELECT t.*,l.quantity,l.cancelled_quantity FROM restaurant_kitchen_tickets t JOIN restaurant_order_lines l ON l.id=t.line_id WHERE t.line_id=? AND t.order_id=?',l.lineId,s.orderId);
   if(!row||row.version!==l.ticketVersion||row.quantity-row.cancelled_quantity-row.started_quantity-row.pending_cancel_quantity<l.quantity)throw new AppError('KITCHEN_QUANTITY_CHANGED','菜品已开始制作或待退数量已变化，请重新核对。',409);
   this.repo.run('UPDATE restaurant_kitchen_tickets SET pending_cancel_quantity=pending_cancel_quantity+?,version=version+1,updated_at=? WHERE id=?',l.quantity,now(),row.id);
  }
  if(changed)diningMenuChanged(this.repo,s.restaurantId);
 }
 release(change:ChangeRow,s:QuoteSnapshot){
  let changed=false;
  for(const hold of this.repo.all<InventoryReservation>("SELECT * FROM restaurant_inventory_reservations WHERE change_id=? AND status='reserved'",change.id)){
   if(hold.tracked){const sku=this.repo.get<MenuSkuRow>('SELECT * FROM restaurant_menu_skus WHERE id=?',hold.sku_id);if(!sku)throw new AppError('ORDER_INVENTORY_MISSING','预占规格记录缺失，请由管理员核对，不会静默忽略。',409);this.move(s.restaurantId,change.id,sku.id,sku.stock_remaining,sku.stock_remaining+hold.quantity,'release');changed=true;}
   this.repo.run("UPDATE restaurant_inventory_reservations SET status='released',updated_at=? WHERE id=?",now(),hold.id);
  }
  for(const l of s.lines.filter(l=>l.operation==='reduce')){const t=this.repo.get<KitchenRow>('SELECT * FROM restaurant_kitchen_tickets WHERE line_id=?',l.lineId);if(!t||t.pending_cancel_quantity<l.quantity)throw new AppError('ORDER_CANCEL_LOCK_MISSING','待退数量记录不完整，请联系管理员核对。',409);this.repo.run('UPDATE restaurant_kitchen_tickets SET pending_cancel_quantity=pending_cancel_quantity-?,version=version+1,updated_at=? WHERE id=?',l.quantity,now(),t.id);}
  if(changed)diningMenuChanged(this.repo,s.restaurantId);
 }
 accept(change:ChangeRow,s:QuoteSnapshot){
  this.repo.run("UPDATE restaurant_inventory_reservations SET status='committed',updated_at=? WHERE change_id=? AND status='reserved'",now(),change.id);
  const returns=new Map<string,number>();
  for(const l of s.lines.filter(l=>l.operation==='reduce')){
   const line=this.repo.get<LineRow>('SELECT * FROM restaurant_order_lines WHERE id=? AND order_id=?',l.lineId,s.orderId),ticket=this.repo.get<KitchenRow>('SELECT * FROM restaurant_kitchen_tickets WHERE line_id=?',l.lineId);
   if(!line||!ticket||ticket.pending_cancel_quantity<l.quantity||line.quantity-line.cancelled_quantity-ticket.started_quantity<l.quantity)throw new AppError('ORDER_CANCEL_CONFLICT','已接单退菜与当前制作状态冲突，须人工核对。',409);
   this.repo.run('UPDATE restaurant_order_lines SET cancelled_quantity=cancelled_quantity+? WHERE id=?',l.quantity,line.id);
   this.repo.run('UPDATE restaurant_kitchen_tickets SET pending_cancel_quantity=pending_cancel_quantity-?,version=version+1,updated_at=? WHERE id=?',l.quantity,now(),ticket.id);
   const sku=this.repo.get<MenuSkuRow>('SELECT * FROM restaurant_menu_skus WHERE id=?',line.sku_id);if(sku&&line.stock_tracked)returns.set(sku.id,(returns.get(sku.id)||0)+l.quantity);
  }
  for(const [skuId,quantity] of returns){const sku=this.repo.get<MenuSkuRow>('SELECT * FROM restaurant_menu_skus WHERE id=?',skuId)!;this.move(s.restaurantId,change.id,skuId,sku.stock_remaining,sku.stock_remaining+quantity,'cancel_return');}
  if(returns.size)diningMenuChanged(this.repo,s.restaurantId);
 }
}
