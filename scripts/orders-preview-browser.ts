import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const state=JSON.parse(fs.readFileSync('storage/orders-preview-state.json','utf8')),folder=path.resolve('docs/evidence/T14/runtime/screenshots');fs.mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5174/');await page.getByRole('button',{name:/沈禾 · 餐饮管理员/}).click();await page.getByRole('heading',{name:'工作空间总览',exact:true}).waitFor();
 await page.goto('http://127.0.0.1:5174/restaurant?restaurant='+state.restaurantId);await page.locator('.dining-party-list button').filter({hasText:'合成同行 · 点单体验'}).click();const order=page.getByLabel('本次点单',{exact:true});await order.getByLabel('已接单明细',{exact:true}).getByText('青禾菌菇饭 · 标准份',{exact:true}).waitFor();assert.ok((await order.innerText()).includes('¥78.00'));assert.ok((await order.innerText()).includes('制作中'));assert.equal(await page.locator('.dining-private[open]').count(),0);await order.screenshot({path:path.join(folder,'preview-order-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>{const sidebar=document.querySelector('.sidebar');return !!sidebar&&sidebar.getBoundingClientRect().right<=1;});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await order.screenshot({path:path.join(folder,'preview-order-mobile.png')});
 await page.goto('http://127.0.0.1:5174/kitchen?restaurant='+state.restaurantId);const cards=page.locator('.kitchen-card');await cards.first().waitFor();assert.equal(await cards.count(),2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(folder,'preview-kitchen-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(folder,'preview-kitchen-desktop.png'),fullPage:true});
 await page.goto('http://127.0.0.1:5174/roadmap');await page.getByText('本地桌台、菜单、点单确认、库存预占与模拟后厨已验证；模拟支付、餐后服务、角色训练及完整平台本地验收继续建设。',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);const result={result:'PASS_LOCAL_ORDER_PREVIEW',desktop:[1440,1100],mobile:[390,844],orderPersisted:true,acceptedTotalMinor:7800,unsettled:true,kitchenCards:2,privateTicketsCollapsed:true,noHorizontalOverflow:true,currentRoadmapVerified:true,realAvatarOrVoiceClaim:false,realBusinessExecuted:false,actionsExecuted:'read-only UI navigation after synthetic login',pageErrors:errors,verifiedAt:new Date().toISOString()};fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
