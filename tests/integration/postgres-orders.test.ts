import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {canonical} from '@digitalguide/domain';
import type {DiningParty,StaffMenu} from '@digitalguide/contracts';
import {nativeOrderFixture,orderEvidence} from './postgres-order-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
let x:Awaited<ReturnType<typeof nativeOrderFixture>>,p:NativeTestPerson;
describe.skipIf(!nativePostgresAvailable)('原生订单草稿、限时报价与原子未发送库存',()=>{
 beforeAll(async()=>{x=await nativeOrderFixture();},60000);beforeEach(async()=>{p=await x.h.person();});afterAll(async()=>{await x?.close();});
 it('落座前只保存草稿，原键回放不重复订单号、变更或库存效果',async()=>{
  const r=await x.store(p),dish=await x.item(p,r),a=await x.party(p,r),key=randomUUID(),o=await x.draft(p,a,dish.skus[0].id,{},key),again=await x.draft(p,a,dish.skus[0].id,{},key);expect(again.id).toBe(o.id);expect(again.changes).toHaveLength(1);expect(again.changes[0].version).toBe(1);expect(again.status).toBe('draft');expect(again.number).toBe('O-000001');expect(await x.stock(dish.skus[0].id)).toBe(5);expect((await x.raw(p,o,'review')).json().error.code).toBe('ORDER_SEATING_REQUIRED');
  await x.owner(async db=>{expect(Number((await db.query('SELECT order_counter value FROM restaurants WHERE id=$1',[r.id])).rows[0].value)).toBe(1);expect(Number((await db.query('SELECT count(*) value FROM restaurant_order_dispatches WHERE restaurant_id=$1',[r.id])).rows[0].value)).toBe(0);});
 });
 it('已落座仍须确认本次偏好和明确后厨连接后才可审阅',async()=>{
  const r=await x.store(p),dish=await x.item(p,r);let a=await x.seat(p,r,await x.party(p,r));const o=await x.draft(p,a,dish.skus[0].id);expect((await x.raw(p,o,'review')).json().error.code).toBe('PREFERENCE_CONFIRMATION_REQUIRED');a=await x.preference(p,a);expect((await x.raw(p,o,'review')).json().error.code).toBe('POS_NOT_CONFIGURED');await x.configured(p,r);const reviewed=await x.review(p,o);expect(reviewed.changes[0].currentQuote?.valid).toBe(true);expect(a.preference?.usable).toBe(true);
 });
 it('审阅只使用服务器价格并保留固定120秒、当前人令牌及原输入',async()=>{
  const f=await x.ready(p),o=await x.review(p,await x.draft(p,f.a,f.sku.id)),q=o.changes[0].currentQuote!;expect(q.newTotalMinor).toBe(1800);expect(q.lines[0].unitPriceMinor).toBe(1800);expect(Date.parse(q.expiresAt)-Date.parse(q.createdAt)).toBe(120000);expect(q.confirmationToken).toHaveLength(43);expect(q).not.toHaveProperty('_confirmation');expect(o.status).toBe('awaiting_confirmation');expect(await x.stock(f.sku.id)).toBe(5);
  const bad=await x.raw(p,o,'confirm',{quoteId:q.id,confirmationToken:'x'.repeat(43),warningsAccepted:true,confirmed:true});expect(bad.json().error.code).toBe('ORDER_CONFIRMATION_INVALID');expect((await x.confirm(p,o)).status).toBe('confirmed');
 });
 it('过敏冲突、可能接触成分和未知配料阻止审阅且不预占库存',async()=>{
  for(const extra of [{ingredientTags:['花生']},{mayContainTags:['花生']},{allergenInfoComplete:false}]){const f=await x.ready(p,extra),a=await x.preference(p,f.a,{allergyMode:'specified',allergens:['花生']}),o=await x.draft(p,a,f.sku.id,{shareDietary:true});expect((await x.raw(p,o,'review')).json().error.code).toBe('ORDER_DIETARY_CHECK');expect(await x.stock(f.sku.id)).toBe(5);}
 });
 it('必要避让须明确同意分享，预算辣度警示须当前明确接受',async()=>{
  const f=await x.ready(p,{spiceLevel:2}),a=await x.preference(p,f.a,{allergyMode:'specified',allergens:['花生'],maxSpice:0,budgetPerDishMinor:500}),o=await x.draft(p,a,f.sku.id);expect((await x.raw(p,o,'review')).json().error.code).toBe('ORDER_DIETARY_SHARING_REQUIRED');const edited=await x.change(p,o,'update',{...o.changes[0].input,shareDietary:true}),reviewed=await x.review(p,edited),q=reviewed.changes[0].currentQuote!;expect(q.warnings).toHaveLength(2);expect(q.lines[0].dietaryTags).toEqual(['花生']);expect((await x.raw(p,reviewed,'confirm',{quoteId:q.id,confirmationToken:q.confirmationToken,warningsAccepted:false,confirmed:true})).json().error.code).toBe('ORDER_WARNING_CONFIRMATION');expect((await x.confirm(p,reviewed)).status).toBe('confirmed');
 });
 it('更新草稿使旧报价和确认失效，原期限不修改',async()=>{
  const f=await x.ready(p),reviewed=await x.review(p,await x.draft(p,f.a,f.sku.id)),q=reviewed.changes[0].currentQuote!,updated=await x.change(p,reviewed,'update',{...reviewed.changes[0].input,newLines:[{skuId:f.sku.id,quantity:2}]});expect(updated.changes[0].currentQuote).toBeNull();expect(updated.changes[0].confirmedAt).toBeNull();expect((await x.raw(p,updated,'confirm',{quoteId:q.id,confirmationToken:q.confirmationToken,warningsAccepted:true,confirmed:true})).statusCode).toBe(409);await x.owner(async db=>{const row=(await db.query('SELECT status,expires_at FROM restaurant_order_quotes WHERE id=$1',[q.id])).rows[0];expect(row.status).toBe('superseded');expect(row.expires_at).toBe(q.expiresAt);});
 });
 it('菜单或库存新版本使原确认失效，客户端不能提交自报价格',async()=>{
  const f=await x.ready(p),confirmed=await x.confirm(p,await x.review(p,await x.draft(p,f.a,f.sku.id)));expect((await x.raw(p,confirmed,'submit',{quoteId:confirmed.changes[0].currentQuote!.id,confirmed:true,unitPriceMinor:1})).statusCode).toBe(400);await x.h.good(p,'/restaurant/skus/'+f.sku.id+'/stock',{version:f.sku.version,quantity:4,reason:'原创盘点'});expect((await x.raw(p,confirmed,'submit',{quoteId:confirmed.changes[0].currentQuote!.id,confirmed:true})).json().error.code).toBe('ORDER_QUOTE_CHANGED');expect(await x.stock(f.sku.id)).toBe(4);
 });
 it('提交原子保存同一派单摘要、库存及审计，重复提交不重复预占',async()=>{
  const f=await x.ready(p),confirmed=await x.confirm(p,await x.review(p,await x.draft(p,f.a,f.sku.id))),key=randomUUID(),queued=await x.submit(p,confirmed,key),again=await x.submit(p,confirmed,key);expect(queued.status).toBe('queued');expect(again.id).toBe(queued.id);expect(queued.lines).toEqual([]);expect(queued.changes[0].dispatch).toMatchObject({status:'queued',attempts:0,simulated:true,remoteOrderId:null});expect(await x.stock(f.sku.id)).toBe(4);
  await x.owner(async db=>{const d=(await db.query('SELECT * FROM restaurant_order_dispatches WHERE change_id=$1',[queued.changes[0].id])).rows[0],payload=JSON.parse(d.request_payload);expect(d.request_hash).toBe(createHash('sha256').update(canonical(payload)).digest('hex'));expect(payload).not.toHaveProperty('guestName');expect(payload).not.toHaveProperty('memory');expect(payload.adds[0].dietaryTags).toEqual([]);expect(Number((await db.query('SELECT count(*) value FROM restaurant_stock_movements WHERE change_id=$1',[queued.changes[0].id])).rows[0].value)).toBe(1);});
 });
 it('重复SKU聚合预占且未发送撤回只释放一次，历史保留后可结束空单就餐',async()=>{
  const f=await x.ready(p),queued=await x.submit(p,await x.confirm(p,await x.review(p,await x.draft(p,f.a,f.sku.id,{newLines:[{skuId:f.sku.id,quantity:2},{skuId:f.sku.id,quantity:3}]}))));expect(await x.stock(f.sku.id)).toBe(0);const key=randomUUID(),body={version:queued.changes[0].version,confirmed:true},url='/restaurant/order-changes/'+queued.changes[0].id+'/withdraw',withdrawn=await x.write(p,url,body,key),again=await x.write(p,url,body,key);expect(withdrawn.status).toBe('cancelled');expect(again.changes[0].status).toBe('withdrawn');expect(await x.stock(f.sku.id)).toBe(5);expect(withdrawn.changes[0].dispatch?.attempts).toBe(0);await x.owner(async db=>expect(Number((await db.query('SELECT count(*) value FROM restaurant_inventory_reservations WHERE change_id=$1',[queued.changes[0].id])).rows[0].value)).toBe(1));const current=await x.h.get<DiningParty>(p,'/restaurant/parties/'+f.a.id);expect((await x.h.good<DiningParty>(p,'/restaurant/parties/'+f.a.id+'/finish',{version:current.version,confirmed:true})).status).toBe('completed');
 });
 it('并发提交最后库存只允许一个，另一单保持未提交且库存不超卖',async()=>{
  const f=await x.ready(p,{skus:[{name:'限量份',priceMinor:1800,stockRemaining:1}]}),b=await x.preference(p,await x.seat(p,f.r,await x.party(p,f.r),'B2')),left=await x.confirm(p,await x.review(p,await x.draft(p,f.a,f.sku.id))),right=await x.confirm(p,await x.review(p,await x.draft(p,b,f.sku.id))),results=await Promise.all([left,right].map(o=>x.raw(p,o,'submit',{quoteId:o.changes[0].currentQuote!.id,confirmed:true})));expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);expect(await x.stock(f.sku.id)).toBe(0);await x.owner(async db=>expect(Number((await db.query('SELECT count(*) value FROM restaurant_inventory_reservations reservation JOIN restaurant_order_changes c ON c.id=reservation.change_id JOIN restaurant_orders o ON o.id=c.order_id WHERE o.restaurant_id=$1',[f.r.id])).rows[0].value)).toBe(1));
 });
 it('多菜数量超限在审阅阻断，不产生部分报价、预占或待发送记录',async()=>{
  const f=await x.ready(p),second=await x.item(p,f.r,{name:'原创限量第二道',skus:[{name:'限量份',priceMinor:1200,stockRemaining:1}]}),o=await x.draft(p,f.a,f.sku.id,{newLines:[{skuId:f.sku.id,quantity:2},{skuId:second.skus[0].id,quantity:2}]});expect((await x.raw(p,o,'review')).json().error.code).toBe('ORDER_OUT_OF_STOCK');expect(await x.stock(f.sku.id)).toBe(5);expect(await x.stock(second.skus[0].id)).toBe(1);await x.owner(async db=>expect(Number((await db.query('SELECT count(*) value FROM restaurant_order_quotes WHERE change_id=$1',[o.changes[0].id])).rows[0].value)).toBe(0));
 });
 it('外部POS启用明确失败，不能静默回退到模拟成功',async()=>{
  const r=await x.store(p),response=await x.h.post(p,'/restaurants/'+r.id+'/pos',{version:0,providerId:'external-pos',enabled:true,scenario:'normal',confirmed:true});expect(response.statusCode).toBe(409);expect(response.json().error.code).toBe('POS_PROVIDER_UNAVAILABLE');const config=await x.h.get<{configured:boolean;simulated:boolean;providerId:string|null}>(p,'/restaurants/'+r.id+'/pos');expect(config).toMatchObject({configured:false,simulated:false,providerId:null});
 });
 it('API与worker无订单原始写权及私有账本执行权，数据库拒绝伪造远端事实',async()=>{
  const f=await x.ready(p),o=await x.draft(p,f.a,f.sku.id);for(const db of [x.apiDb,x.workerDb]){for(const[sql,values]of [['UPDATE restaurant_orders SET remote_order_id=$1 WHERE id=$2',['fabricated',o.id]],['SELECT dg_native_dining_effect($1,$2,$3)',[randomUUID(),'restaurant_orders',o.id]]] as const){let code:string|undefined;await expect(db.transaction(async()=>{try{await db.query(sql,[...values]);}catch(error){code=(error as{code:string}).code;throw error;}})).rejects.toBeDefined();expect(code).toBe('42501');}}await expect(x.owner(db=>db.query("UPDATE restaurant_orders SET status='accepted',remote_order_id='fabricated' WHERE id=$1",[o.id]))).rejects.toMatchObject({code:'23514'});
 });
 it('新建订单阶段仍保持完整点单与支付界面关闭',async()=>{
  const f=await x.ready(p),r=await x.h.get<{capabilities:{ordering:boolean;payments:boolean;preferences:boolean}}>(p,'/restaurant/restaurants/'+f.r.id);expect(r.capabilities).toMatchObject({ordering:false,payments:false,preferences:true});const menu=await x.h.get<StaffMenu>(p,'/restaurant/restaurants/'+f.r.id+'/menu');expect(menu.items[0].skus[0].stockRemaining).toBe(5);fs.mkdirSync(orderEvidence+'/stages',{recursive:true});fs.writeFileSync(orderEvidence+'/stages/'+x.result.runtimeId+'.json',JSON.stringify({result:'ASSERTED_STAGE_BOUNDARY',runtimeId:x.result.runtimeId,root:x.cluster.root,orderingUI:false,paymentsUI:false,actualPosSend:false,realAcceptanceClaimed:false})+'\n',{flag:'wx'});
 });
});
