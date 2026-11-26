import fs from 'node:fs';
import { chromium,expect } from '@playwright/test';
const folder='docs/evidence/T24/content-drafts/runtime/screenshots',state=JSON.parse(fs.readFileSync('storage/content-drafts-preview-state.json','utf8')),origin='http://127.0.0.1:5174';
fs.mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('button',{name:/林知 · 管理员/}).click();await page.getByRole('heading',{name:'工作空间总览',exact:true}).waitFor();
  await page.goto(origin+'/studio/drafts?draft='+state.draftId);await expect(page.getByRole('heading',{name:'脚本草稿与审阅计划',exact:true})).toBeVisible();
  const editor=page.getByRole('region',{name:'脚本草稿编辑',exact:true});await expect(editor.getByRole('textbox',{name:'草稿台词 1',exact:true})).toHaveValue('欢迎来到数字导览展厅。');await expect(editor.getByRole('textbox',{name:'草稿台词 2',exact:true})).toHaveValue('第一站介绍平台如何把内容制作和接待服务连接起来。');await expect(editor.getByRole('textbox',{name:'草稿台词 3',exact:true})).toHaveValue('您可以先了解展品，再选择适合自己的参观路线。');
  await editor.screenshot({path:folder+'/draft-desktop.png'});
  await page.getByRole('combobox',{name:'选择内容计划',exact:true}).selectOption(state.reviewPlanId);const review=page.getByRole('region',{name:'内容计划审阅',exact:true});await expect(review.getByRole('textbox',{name:'计划新文字 1',exact:true})).toHaveValue('欢迎参观。今天带您了解平台的制作与接待流程。');await expect(review.getByRole('button',{name:'确认应用当前计划',exact:true})).toBeDisabled();await review.screenshot({path:folder+'/review-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>{const side=document.querySelector('.sidebar');return !side||side.getBoundingClientRect().right<=1;});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await review.screenshot({path:folder+'/review-mobile.png'});
  await page.reload();await expect(editor.getByRole('textbox',{name:'草稿台词 1',exact:true})).toHaveValue('欢迎来到数字导览展厅。');await expect(page.getByRole('combobox',{name:'选择脚本草稿',exact:true})).toHaveValue(state.draftId);
  await page.getByRole('combobox',{name:'选择脚本草稿',exact:true}).selectOption(state.variantId);await expect(page.getByRole('textbox',{name:'草稿台词 3',exact:true})).toHaveValue('您可以先了解展品，再选择适合自己的参观路线。');
  expect(errors).toEqual([]);const result={result:'PASS_READ_ONLY_MAIN_DRAFTS_BROWSER',recordedAt:new Date().toISOString(),desktop:[1440,1100],mobile:[390,844],sections:3,originalOtherSectionsPreserved:true,reviewRequiresConfirmation:true,variantReopened:true,refreshPersistence:true,noHorizontalOverflow:true,pageErrors:errors,actions:'合成账号登录及只读查看，不保存/应用计划，不采集设备或对外操作。'};fs.writeFileSync(folder+'/verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
