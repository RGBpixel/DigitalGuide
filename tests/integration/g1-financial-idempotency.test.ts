import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import type {Bill,RestaurantOrder} from '@digitalguide/contracts';
import {financialSignature} from '../../apps/api/src/billing-routes.js';
import {orderHarness} from './orders-helpers.js';
import {billingHarness} from './billing-helpers.js';

async function hundred<T>(fn:(i:number)=>Promise<T>){const results:T[]=[];for(let i=0;i<100;i+=10)results.push(...await Promise.all(Array.from({length:10},(_,j)=>fn(i+j))));return results;}
function evidence(name:string,data:object){if(process.env.EVIDENCE_DIR){const folder=path.join(process.env.EVIDENCE_DIR,'financial-100');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,name+'.json'),JSON.stringify({result:'PASS',...data,inProcessApiConcurrency:10,realPosOrCharge:false},null,2)+'\n',{flag:'wx'});}}

it('100次并发重复确认及派单各只保留一个订单和请求；100个过时新操作均拒绝',async()=>{
 const x=await orderHarness();try{
  await x.config();const original=await x.review(await x.draft(await x.party())),c=original.changes[0],q=c.currentQuote!,body={version:c.version,quoteId:q.id,confirmationToken:q.confirmationToken,confirmed:true},key=randomUUID();
  const confirmations=await hundred(()=>x.post(x.changePath(original)+'/confirm',body,undefined,key));expect(confirmations.every(r=>r.statusCode===200)).toBe(true);const confirmed=confirmations[0].json().data as RestaurantOrder;expect(new Set(confirmations.map(r=>(r.json().data as RestaurantOrder).id)).size).toBe(1);
  const stale=await hundred(()=>x.post(x.changePath(original)+'/confirm',body));expect(stale.every(r=>r.statusCode===409)).toBe(true);
  const submitKey=randomUUID(),submissions=await hundred(()=>x.submit(confirmed,undefined,submitKey));expect(new Set(submissions.map(r=>r.id)).size).toBe(1);const accepted=await x.accept(submissions[0]);expect(accepted.status).toBe('accepted');
  expect(x.h.repo.get<{n:number}>('SELECT count(*) n FROM restaurant_orders')!.n).toBe(1);expect(x.h.repo.get<{n:number}>('SELECT count(*) n FROM restaurant_order_changes')!.n).toBe(1);expect(x.h.repo.get<{n:number}>('SELECT count(*) n FROM restaurant_order_dispatches')!.n).toBe(1);expect(x.h.repo.get<{stock_remaining:number}>('SELECT stock_remaining FROM restaurant_menu_skus WHERE id=?',x.sku.id)!.stock_remaining).toBe(8);
  evidence('orders',{confirmRequests:100,staleDifferentKeyRequests:100,submitRequests:100,orders:1,dispatches:1,stockBefore:10,stockAfter:8});
 }finally{await x.h.close();}
},60000);

it('100次并发支付确认和100次重复/乱序签名回调不会重复收款或降低成功状态',async()=>{
 const x=await billingHarness();try{
  await x.configure();const initial=await x.reviewBill(),q=initial.quotes[0],body={quoteId:q.id,confirmationToken:q.confirmationToken,confirmed:true},key=randomUUID(),confirmations=await hundred(()=>x.post('/restaurant/billing/confirm',body,undefined,key));expect(confirmations.every(r=>r.statusCode===200)).toBe(true);expect(x.h.repo.get<{n:number}>('SELECT count(*) n FROM restaurant_financial_operations')!.n).toBe(1);await x.financialTick();const pending=await x.readBill(initial.id),op=pending.operations[0],fixed=x.h.repo.get<{request_hash:string;merchant_id:string}>('SELECT request_hash,merchant_id FROM restaurant_financial_operations WHERE id=?',op.id)!;
  const event={eventId:randomUUID(),receipt:{operationId:op.id,kind:'payment',requestHash:fixed.request_hash,restaurantId:x.restaurant.id,billId:initial.id,merchantId:fixed.merchant_id,amountMinor:op.amountMinor,currency:'CNY',remoteOperationId:'mock-pay:'+op.id,remoteTransactionId:'mock-charge:'+op.id,status:'succeeded',sequence:2,simulated:true}};
  const callback=(v:typeof event)=>{const timestamp=new Date().toISOString();return x.h.app.inject({method:'POST',url:'/api/v1/webhooks/mock-payments',payload:v,headers:{'x-payment-timestamp':timestamp,'x-payment-signature':financialSignature(x.h.config,timestamp,v)}});};expect((await callback(event)).statusCode).toBe(200);
  const callbacks=await hundred(i=>callback(i<80?event:{...event,eventId:randomUUID(),receipt:{...event.receipt,status:i%2?'pending':'failed',sequence:1}}));expect(callbacks.every(r=>r.statusCode===200)).toBe(true);const b=await x.readBill(initial.id);expect(b.status).toBe('paid');expect(b.paidMinor).toBe(3600);expect(b.operations[0].status).toBe('succeeded');expect(b.operations[0].sendAttempts).toBe(1);expect(x.h.repo.get<{n:number}>('SELECT count(*) n FROM restaurant_financial_postings')!.n).toBe(1);expect(x.h.repo.get<{n:number}>('SELECT count(*) n FROM restaurant_orders')!.n).toBe(1);expect(b as Bill).toMatchObject({totalMinor:3600,paidMinor:3600});
  evidence('payments',{confirmRequests:100,initialSignedSuccess:1,duplicateSuccessCallbacks:80,outOfOrderPendingOrFailureCallbacks:20,paymentOperations:1,providerSendAttempts:1,postings:1,paidMinor:3600});
 }finally{await x.h.close();}
},60000);
