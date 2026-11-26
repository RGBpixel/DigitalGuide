import type { Bill,RestaurantOrder } from '@digitalguide/contracts';
import { orderHarness } from './orders-helpers.js';
import { runFinancialOperation } from '../../apps/worker/src/financial-dispatch.js';
export async function billingHarness(){
 const x=await orderHarness();await x.config();const p=await x.party(),o=await x.accept(await x.submit(await x.confirm(await x.review(await x.draft(p)))));
 const configure=(scenario='normal',version=0)=>x.good('/restaurants/'+x.restaurant.id+'/payments',{version,providerId:'mock-payments',enabled:true,scenario,confirmed:true});
 const readBill=(id:string)=>x.read<Bill>('/restaurant/bills/'+id);
 const review=(order:RestaurantOrder=o,billVersion=0)=>x.good<Bill>('/restaurant/orders/'+order.id+'/billing/review',{orderVersion:order.version,billVersion});
 const confirm=(b:Bill,kind:'payment'|'refund'='payment')=>{const q=b.quotes.find(q=>q.kind===kind&&q.valid)!;return x.good<Bill>('/restaurant/billing/confirm',{quoteId:q.id,confirmationToken:q.confirmationToken,confirmed:true});};
 const tick=()=>runFinancialOperation(x.h.repo,x.h.config);
 const action=(b:Bill,action:'query'|'close'|'withdraw'|'simulate',op=b.operations[0])=>x.good<Bill>('/restaurant/financial-operations/'+op.id+'/actions',{version:op.version,action,confirmed:true});
 async function paid(){await configure();let b=await confirm(await review());await tick();b=await readBill(b.id);b=await action(b,'simulate');await tick();return readBill(b.id);}
 const refundReview=(b:Bill,amountMinor:number,paymentId=b.operations.find(o=>o.kind==='payment')!.id)=>x.good<Bill>('/restaurant/bills/'+b.id+'/refund-review',{billVersion:b.version,paymentId,amountMinor,reason:'本地核对的模拟退款',confirmed:true});
 return {...x,partyRow:p,orderRow:o,configure,readBill,reviewBill:review,confirmBill:confirm,financialTick:tick,financialAction:action,paid,refundReview};
}
