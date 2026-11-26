// Read-only navigation of the owned synthetic T15 example. No business writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const state=JSON.parse(fs.readFileSync('storage/billing-preview-state.json','utf8')),folder=path.resolve(process.env.BILLING_EVIDENCE_DIR||'docs/evidence/T15/runtime/screenshots');fs.mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5174/');await page.getByRole('button',{name:/沈禾 · 餐饮管理员/}).click();await page.getByRole('heading',{name:'工作空间总览',exact:true}).waitFor();
 await page.goto('http://127.0.0.1:5174/restaurant?restaurant='+state.restaurantId);await page.locator('.dining-party-list button').filter({hasText:'合成同行 · 账单体验'}).click();
 const bill=page.getByLabel('本次账单',{exact:true}),order=page.getByLabel('本次点单',{exact:true});await bill.getByRole('heading',{name:'部分退款已核实',exact:true}).waitFor();const text=await bill.innerText();assert.ok(text.includes('¥78.00'));assert.ok(text.includes('¥10.00'));assert.ok(text.includes('¥0.00'));assert.ok((await order.innerText()).includes('制作中'));assert.equal(await page.locator('.dining-private[open]').count(),0);await bill.screenshot({path:path.join(folder,'preview-billing-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>{const sidebar=document.querySelector('.sidebar');return !sidebar||sidebar.getBoundingClientRect().right<=1;});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await bill.screenshot({path:path.join(folder,'preview-billing-mobile.png')});
 await page.goto('http://127.0.0.1:5174/restaurant?restaurant='+state.restaurantId+'&tab=services');const queue=page.locator('.dining-box').filter({has:page.getByRole('heading',{name:'店员服务队列',exact:true})}),service=queue.locator('.service-card').filter({hasText:'合成同行 · 账单体验'});await service.getByText('加水',{exact:true}).waitFor();await page.evaluate(()=>scrollTo(0,0));await page.waitForFunction(()=>scrollY===0&&document.documentElement.scrollHeight<2000);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(folder,'preview-services-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(folder,'preview-services-desktop.png'),fullPage:true});
 await page.reload();await service.waitFor();assert.deepEqual(errors,[]);
 const result={result:'PASS_LOCAL_BILLING_PREVIEW',desktop:[1440,1100],mobile:[390,844],acceptedTotalMinor:7800,paidMinor:7800,refundedMinor:1000,balanceMinor:0,paidDoesNotMeanServed:true,waterRequestPersisted:true,privateDetailsCollapsed:true,noHorizontalOverflow:true,realBusinessExecuted:false,actionsExecuted:'read-only navigation after synthetic login',pageErrors:errors,verifiedAt:new Date().toISOString()};fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
