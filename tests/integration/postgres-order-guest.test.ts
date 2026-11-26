import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {Bill,PartyBilling,PartyOrderHistory,RestaurantOrder} from '@digitalguide/contracts';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeFinancialFixture} from './postgres-financial-helpers.js';
let x:Awaited<ReturnType<typeof nativeFinancialFixture>>;
describe.skipIf(!nativePostgresAvailable)('原生完整订单账单历史与访客依赖',()=>{
 beforeAll(async()=>{x=await nativeFinancialFixture({evidenceRoot:'docs/evidence/T20/postgres-order-ui/guest',firstMigration:115});},120000);afterAll(async()=>{await x?.close();},60000);
 it('同组第51份实际模拟账单仍能列出并读取最早收据，厨房和跨租户仍无权读取',async()=>{
  const originalPost=x.h.post;let rateWaits=0;const started=Date.now();x.h.post=async(...args)=>{for(;;){const response=await originalPost(...args);if(response.statusCode!==429||response.json().error?.code!=='RATE_LIMITED')return response;if(Date.now()-started>480000)throw new Error('Natural rate window did not reopen within observation deadline');rateWaits++;await new Promise(resolve=>setTimeout(resolve,15000));}};
  const p=await x.h.person(),f=await x.ready(p,{skus:[{name:'历史核验份',priceMinor:1800,stockRemaining:100}]});await x.configure(p,f.r);const ids:string[]=[],orders:string[]=[];
  for(let i=0;i<51;i++){
   let order=await x.submit(p,await x.confirm(p,await x.review(p,await x.draft(p,f.a,f.sku.id))));expect(await x.worker.runOne()).toBe(true);order=await x.order(p,order.id);const change=order.changes.find(c=>c.id===order.pendingChangeId)!;expect(change.dispatch!.attempts).toBe(1);await x.change(p,order,'query',{version:change.dispatch!.version});expect(await x.worker.runOne()).toBe(true);order=await x.order(p,order.id);expect(order.status).toBe('accepted');let bill=await x.confirmBill(p,await x.reviewBill(p,order));expect(await x.tick()).toBe(true);bill=await x.bill(p,bill.id);expect(bill.paidMinor).toBe(0);bill=await x.action(p,bill,'simulate');expect(await x.tick()).toBe(true);bill=await x.bill(p,bill.id);expect(bill.paidMinor).toBe(1800);ids.push(bill.id);orders.push(order.id);if(ids.length%10===0||ids.length===51)console.log(JSON.stringify({stage:'original_party_history_business_created',completedBills:ids.length,rateWaits,elapsedMs:Date.now()-started,originalClockNotChanged:true}));
  }
  const result=await x.h.get<PartyBilling>(p,'/restaurant/parties/'+f.a.id+'/billing'),history=await x.h.get<PartyOrderHistory>(p,'/restaurant/parties/'+f.a.id+'/order-history');expect(result.bills).toHaveLength(51);expect(new Set(result.bills.map(b=>b.id))).toEqual(new Set(ids));expect(new Set(history.orders.map(o=>o.id))).toEqual(new Set(orders));expect(result.bills.at(-1)!.id).toBe(ids[0]);const oldest=await x.h.get<Bill>(p,'/restaurant/bills/'+ids[0]);expect(oldest.paidMinor).toBe(1800);const receipt=await x.h.get<{paidMinor:number}>(p,'/restaurant/bills/'+ids[0]+'/receipt');expect(receipt.paidMinor).toBe(1800);expect(await x.funds(ids[0])).toBe(1);const original=await x.order(p,orders[0]);expect(original).toMatchObject({status:'accepted',settlementStatus:'settled'} satisfies Partial<RestaurantOrder>);expect(original.lines[0].kitchen.servedQuantity).toBe(0);
  for(const person of [await x.role(p,f.r.id,'kitchen'),await x.h.person()])expect((await x.app.inject({url:'/api/v1/restaurant/parties/'+f.a.id+'/billing',headers:person.headers})).statusCode).toBe(404);
 },600000);
});
