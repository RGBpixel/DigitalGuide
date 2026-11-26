import fs from 'node:fs';
import {expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Bill,RestaurantOrder,RestaurantGrant,PaymentConfig,Restaurant} from '@digitalguide/contracts';
import {NativeBilling,type NativeBillingKind} from '../../packages/postgres/src/runtime-billing.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {NativeOrderWorker} from '../../packages/postgres/src/runtime-order-worker.js';
import {nativeOrderFixture} from './postgres-order-helpers.js';
import {createApp} from '../../apps/api/src/app.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
export const billingEvidence='docs/evidence/T20/postgres-billing';
export async function nativeBillingFixture(options:{evidenceRoot?:string;firstMigration?:number}={}){
 const latest=JSON.parse(fs.readFileSync('migrations/postgres/runtime.json','utf8')).migrations.at(-1).name as string,currentTransport=parseInt(latest)>=110;
 const x=await nativeOrderFixture({evidenceRoot:options.evidenceRoot??(currentTransport?billingEvidence+'/transport':billingEvidence),firstMigration:options.firstMigration??(currentTransport?110:108)}).catch(error=>{const e=error as{code?:string;position?:string;internalPosition?:string;where?:string};console.log(JSON.stringify({stage:'native_billing_initialize_diagnostic',code:e.code,position:e.position,internalPosition:e.internalPosition,where:e.where?.slice(0,1200),credentialsLogged:false}));throw error;}),appB=await createApp(x.config),worker=new NativeOrderWorker(x.repo,x.config.sessionSecret),service=new NativeBilling(new NativeCoreRepository(x.apiDb),x.config.sessionSecret);
 const order=(p:NativeTestPerson,id:string)=>x.h.get<RestaurantOrder>(p,'/restaurant/orders/'+id);
 async function accepted(p:NativeTestPerson,quantity=2){const f=await x.ready(p),o=await x.submit(p,await x.confirm(p,await x.review(p,await x.draft(p,f.a,f.sku.id,{newLines:[{skuId:f.sku.id,quantity}]}))));let current=await order(p,o.id);for(let i=0;i<40&&current.changes[0].dispatch!.attempts===0;i++){expect(await worker.runOne()).toBe(true);current=await order(p,o.id);}expect(current.changes[0].dispatch!.attempts).toBe(1);await x.change(p,current,'query',{version:current.changes[0].dispatch!.version});await worker.runOne();current=await order(p,o.id);expect(current.status).toBe('accepted');return{...f,order:current};}
 async function role(p:NativeTestPerson,restaurantId:string,role:'host'|'kitchen'|'manager'){const colleague=await x.h.colleague(p),grants=await x.h.good<RestaurantGrant[]>(p,'/restaurant/restaurants/'+restaurantId+'/staff',{userId:colleague.user,role,enabled:true,version:0,expiresAt:null});return{...colleague,grant:grants.find(g=>g.userId===colleague.user)!};}
 async function write<T=Bill>(p:NativeTestPerson,url:string,input:Record<string,unknown>,kind:NativeBillingKind,target:string,action:Parameters<NativeBilling['applyBilling']>[2],key=randomUUID()):Promise<T>{const response=await x.h.post(p,url,input,key);
  if(response.statusCode===503)await x.apiDb.transaction(async()=>{await x.apiDb.query("SELECT set_config('digitalguide.actor_id',$1,true)",[p.user]);try{const operation=await service.applyBilling(kind,target,action,input);await service.billingResult(operation);await x.apiDb.query('SET CONSTRAINTS ALL IMMEDIATE');}catch(error){const e=error as{code?:string;message?:string;where?:string};console.log(JSON.stringify({stage:'native_billing_diagnostic',code:e.code,message:e.message,where:e.where?.slice(0,1800),rawInputOrCredentialsLogged:false}));throw error;}throw new Error('Diagnostic transaction must roll back');});expect(response.statusCode,response.payload).toBe(200);return response.json().data as T;}
 const configure=(p:NativeTestPerson,r:Restaurant,version=0,extra:object={})=>write<PaymentConfig>(p,'/restaurants/'+r.id+'/payments',{version,providerId:'mock-payments',enabled:true,scenario:'normal',confirmed:true,...extra},'restaurant',r.id,'config');
 const reviewBill=(p:NativeTestPerson,o:RestaurantOrder,b?:Bill,key=randomUUID())=>write(p,'/restaurant/orders/'+o.id+'/billing/review',{orderVersion:o.version,billVersion:b?.version??0},'order',o.id,'review',key);
 const confirmBill=(p:NativeTestPerson,b:Bill,key=randomUUID())=>{const q=b.quotes.find(q=>q.valid)!;return write(p,'/restaurant/billing/confirm',{quoteId:q.id,confirmationToken:q.confirmationToken!,confirmed:true},'quote',q.id,'confirm',key);};
 const withdraw=(p:NativeTestPerson,b:Bill,key=randomUUID())=>{const op=b.operations.find(o=>o.canWithdraw)!;return write(p,'/restaurant/financial-operations/'+op.id+'/actions',{version:op.version,action:'withdraw',confirmed:true},'operation',op.id,'withdraw',key);};
 const bill=(p:NativeTestPerson,id:string)=>x.h.get<Bill>(p,'/restaurant/bills/'+id);
 const funds=(billId:string)=>x.owner(async db=>(await db.query('SELECT count(*)::int count FROM restaurant_financial_postings WHERE bill_id=$1',[billId])).rows[0].count as number);
 return{...x,appB,worker,service,order,accepted,role,billingWrite:write,configure,reviewBill,confirmBill,withdraw,bill,funds,close:async()=>{await appB.close();await x.close();}};
}
