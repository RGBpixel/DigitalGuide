import {randomUUID} from 'node:crypto';
import {expect,type Page,type Locator} from '@playwright/test';
import type {Restaurant,RestaurantGrant,DiningParty,DiningServiceRequest} from '../packages/contracts/src/index.js';
import type {NativeContentProofRuntime} from './postgres-content-proof-runtime.js';
import {uiPost} from './native-order-ui-proof-helpers.js';

export const serviceCard=(page:Page,id:string)=>page.locator('[data-service-id="'+id+'"]');
export async function seedServiceUi(c:NativeContentProofRuntime){
 const me=await c.get<{tenantId:string;workspaces:{id:string}[]}>('/me'),venueId=randomUUID();
 await c.owner(db=>db.query('INSERT INTO venues VALUES($1,$2,$3,$4,$5)',[venueId,me.tenantId,me.workspaces[0].id,'原创服务界面场所','Asia/Shanghai']));
 const restaurant=await c.good<Restaurant>('/restaurant/restaurants',{venueId,name:'原创餐中服务界面餐厅'});
 await c.good('/restaurant/restaurants/'+restaurant.id+'/tables',{code:'G1',name:'原创服务一号桌',capacity:4});
 const party=await c.good<DiningParty>('/restaurant/restaurants/'+restaurant.id+'/parties',{name:'原创员工服务核对组',size:2,visitMinutes:60,guestNote:'',confirmed:true});
 const user=randomUUID();await c.owner(async db=>{await db.query('INSERT INTO users VALUES($1,$2)',[user,'原创服务核验迎宾']);await db.query('INSERT INTO memberships VALUES($1,$2,$3,$4)',[user,me.tenantId,'viewer',JSON.stringify([me.workspaces[0].id])]);});
 const grants=await c.good<RestaurantGrant[]>('/restaurant/restaurants/'+restaurant.id+'/staff',{userId:user,role:'host',enabled:true,version:0,expiresAt:null}),grant=grants.find(g=>g.userId===user)!,login=await c.http('/api/v1/auth/login',{accountId:user},c.apiA,{});
 if(login.status!==200)throw new Error('Original synthetic host login failed');const cookie=login.cookie!.split(';')[0];c.secrets.push(cookie);
 return{restaurant,party,user,grant,cookie};
}
export async function submitServiceUi(page:Page,partyId:string,kind:DiningServiceRequest['kind'],note:string,base='/restaurant'){
 const form=page.getByRole('form',{name:'本次服务请求',exact:true});await form.getByRole('combobox',{name:'需要的帮助',exact:true}).selectOption(kind);await form.getByRole('textbox',{name:'本次服务说明',exact:true}).fill(note);await form.getByLabel('确认将本次请求交给店员',{exact:true}).check();return uiPost<DiningServiceRequest>(page,base+'/parties/'+partyId+'/services',()=>form.getByRole('button',{name:'提交本次服务请求',exact:true}).click());
}
export async function serviceActionUi(page:Page,request:DiningServiceRequest,action:'acknowledge'|'resolve'|'cancel',base='/restaurant'){
 const card=serviceCard(page,request.id);await expect(card).toHaveAttribute('data-service-version',String(request.version));await card.getByRole('combobox',{name:'本次服务处理方式',exact:true}).selectOption(action);await card.getByLabel('已核对本组和本次服务处理',{exact:true}).check();const names={acknowledge:'店员接收请求',resolve:'确认已处理',cancel:'取消本次请求'};return uiPost<DiningServiceRequest>(page,base+'/services/'+request.id+'/actions',()=>card.getByRole('button',{name:names[action],exact:true}).click());
}
export async function currentServiceUi(card:Locator,request:DiningServiceRequest){await expect(card).toHaveAttribute('data-service-version',String(request.version));if(request.partyVersion!==undefined)await expect(card).toHaveAttribute('data-party-version',String(request.partyVersion));}
export async function settleServiceRead(page:Page,path:string,requestId?:string,minimumPartyVersion=0){const response=await page.waitForResponse(async r=>{if(r.request().method()!=='GET'||r.status()!==200||new URL(r.url()).pathname!=='/api/v1'+path)return false;const data=(await r.json()).data as DiningServiceRequest[];return!requestId||data.some(s=>s.id===requestId&&(s.partyVersion??0)>=minimumPartyVersion);});await response.finished();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));}
