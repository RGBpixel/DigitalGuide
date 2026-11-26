import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { DiningParty,DiningHoldPlan,Restaurant,RestaurantOrder,RestaurantTable,StaffMenu,ReceptionSession,GuestSessionView } from '@digitalguide/contracts';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';
import { runRestaurantDispatch } from '../../apps/worker/src/restaurant-dispatch.js';
export async function orderHarness(){
 const h=await harness();type Headers=Record<string,string>;
 const post=(url:string,body:unknown,headers:Headers=h.headers,key:string=randomUUID())=>h.app.inject({method:'POST',url:'/api/v1'+url,payload:body as Record<string,unknown>,headers:{...headers,'idempotency-key':key}});
 const get=(url:string,headers:Headers=h.headers)=>h.app.inject({url:'/api/v1'+url,headers});
 const good=async<T>(url:string,body:unknown,headers:Headers=h.headers,key:string=randomUUID()):Promise<T>=>{const r=await post(url,body,headers,key);expect(r.statusCode,r.body).toBe(200);return r.json().data;};
 const read=async<T>(url:string,headers:Headers=h.headers):Promise<T>=>{const r=await get(url,headers);expect(r.statusCode,r.body).toBe(200);return r.json().data;};
 const venue=h.repo.get<{id:string}>('SELECT id FROM venues WHERE workspace_id=?',f.workspaceA)!;
 const restaurant=await good<Restaurant>('/restaurant/restaurants',{venueId:venue.id,name:'订单合成餐厅'}),table=await good<RestaurantTable>('/restaurant/restaurants/'+restaurant.id+'/tables',{code:'A1',name:'一号桌',capacity:4});
 const itemFields={name:'番茄面',category:'主食',description:'合成菜单',ingredientTags:['番茄','小麦'],allergenTags:['小麦'],mayContainTags:[],allergenInfoComplete:true,flavorTags:['清淡'],spiceLevel:0,isNew:true,listed:true,skus:[{name:'标准份',priceMinor:1800,stockTracked:true,stockRemaining:10,onSale:true,portionPeople:1}]};
 const item=await good<StaffMenu['items'][number]>('/restaurant/restaurants/'+restaurant.id+'/menu-items',itemFields),sku=item.skus[0];
 const prefs={likes:['清淡'],avoids:[],allergens:[],allergyMode:'not_provided',maxSpice:0,budgetPerDishMinor:2500,note:''};
 async function guest(){const term=await good<{id:string}>('/restaurant/restaurants/'+restaurant.id+'/terminals',{name:'独立点单终端'}),session=await good<ReceptionSession>('/restaurant/terminals/'+term.id+'/session',{action:'open',confirmed:true}),access=await post('/restaurant/terminals/'+term.id+'/access',{}),cookie=access.headers['set-cookie']!.toString().split(';')[0],base='/guest/sessions/'+session.id,view=await read<GuestSessionView>(base,{cookie});return {base,session,headers:{cookie,'x-csrf-token':view.csrfToken} as Headers};}
 type Guest=Awaited<ReturnType<typeof guest>>;
 async function party(g?:Guest,seated=true,tableId=table.id){const prefix=g?g.base+'/dining':'/restaurant',headers=g?.headers,focus=g?{focusVersion:0}:{};let p=await good<DiningParty>(g?prefix+'/parties':'/restaurant/restaurants/'+restaurant.id+'/parties',{name:'私密昵称不可进后厨',size:2,visitMinutes:60,guestNote:'私密单位与备注',confirmed:true,...focus},headers);
  if(seated){const plan=await good<DiningHoldPlan>(g?prefix+'/table-plan':'/restaurant/restaurants/'+restaurant.id+'/table-plan',{partyId:p.id,version:p.version,tableId,...focus},headers);p=await good<DiningParty>(prefix+'/table-holds',{planId:plan.id,planHash:plan.hash,confirmed:true,...focus},headers);p=await good<DiningParty>(prefix+'/table-holds/'+p.occupancy!.id+'/seat',{version:p.occupancy!.version,partyVersion:p.version,confirmed:true,...focus},headers);}
  return preference(p,g);
 }
 async function preference(p:DiningParty,g?:Guest,extra:Record<string,unknown>={}){const base=(g?g.base+'/dining':'/restaurant')+'/parties/'+p.id,focus=g?{focusVersion:0}:{};p=await good<DiningParty>(base+'/preferences',{version:p.version,preferences:{...prefs,...extra},confirmed:true,...focus},g?.headers);return good<DiningParty>(base+'/preferences/confirm',{version:p.version,preferenceId:p.preference!.id,revision:p.preference!.revision,confirmed:true,...focus},g?.headers);}
 const config=async(scenario='normal',version=0)=>good('/restaurants/'+restaurant.id+'/pos',{version,providerId:'mock-pos',enabled:true,scenario,confirmed:true});
 const draft=(p:DiningParty,g?:Guest,extra:Record<string,unknown>={})=>good<RestaurantOrder>((g?g.base+'/dining':'/restaurant')+'/parties/'+p.id+'/orders',{orderVersion:0,kind:'initial',newLines:[{skuId:sku.id,quantity:2}],...(g?{focusVersion:0}:{}),...extra},g?.headers);
 const changePath=(o:RestaurantOrder,g?:Guest)=>g?g.base+'/dining/changes/'+o.pendingChangeId:'/restaurant/order-changes/'+o.pendingChangeId;
 async function review(o:RestaurantOrder,g?:Guest){return good<RestaurantOrder>(changePath(o,g)+'/review',{version:o.changes[0].version,...(g?{focusVersion:0}:{})},g?.headers);}
 async function confirm(o:RestaurantOrder,g?:Guest){const c=o.changes[0],q=c.currentQuote!;return good<RestaurantOrder>(changePath(o,g)+'/confirm',{version:c.version,quoteId:q.id,confirmationToken:q.confirmationToken,warningsAccepted:true,confirmed:true,...(g?{focusVersion:0}:{})},g?.headers);}
 async function submit(o:RestaurantOrder,g?:Guest,key:string=randomUUID()){const c=o.changes[0];return good<RestaurantOrder>(changePath(o,g)+'/submit',{version:c.version,quoteId:c.currentQuote!.id,confirmed:true,...(g?{focusVersion:0}:{})},g?.headers,key);}
 const order=(id:string,g?:Guest)=>read<RestaurantOrder>((g?g.base+'/dining':'/restaurant')+'/orders/'+id,g?.headers);
 const tick=()=>runRestaurantDispatch(h.repo,h.config);
 async function accept(o:RestaurantOrder){await tick();await tick();return order(o.id);}
 return {h,post,get,good,read,restaurant,table,item,sku,itemFields,prefs,guest,party,preference,config,draft,changePath,review,confirm,submit,order,tick,accept};
}
