import fs from 'node:fs';
import { chromium,expect } from '@playwright/test';
const folder='docs/evidence/T24/content-sources/runtime/screenshots',state=JSON.parse(fs.readFileSync('storage/content-source-preview-state.json','utf8')),origin='http://127.0.0.1:5174';
fs.mkdirSync(folder,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.getByRole('button',{name:/林知 · 管理员/}).click();await page.getByRole('heading',{name:'工作空间总览',exact:true}).waitFor();
  await page.goto(origin+'/studio/content');await expect(page.getByRole('heading',{name:'内容来源与定位',exact:true})).toBeVisible();
  for(const id of Object.values(state.sourceIds) as string[])await expect(page.getByLabel('选择来源',{exact:true}).locator('option[value="'+id+'"]')).toHaveCount(1);
  await page.getByLabel('选择来源',{exact:true}).selectOption(state.sourceIds.docx);
  await expect(page.getByLabel('已提取来源正文',{exact:true})).toContainText('表格中的讲解要点');
  await page.getByLabel('选择定位',{exact:true}).selectOption(state.briefId);
  await expect(page.getByLabel('账号定位',{exact:true})).toHaveValue('解释统一数字人平台的内容制作和现场服务');
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForFunction(()=>scrollY<=1);await page.screenshot({path:folder+'/content-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>{const side=document.querySelector('.sidebar');return !side||side.getBoundingClientRect().right<=1;});
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForFunction(()=>scrollY<=1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:folder+'/content-mobile.png',fullPage:true});
  await page.reload();await page.getByLabel('选择来源',{exact:true}).selectOption(state.sourceIds.text);await expect(page.getByLabel('已提取来源正文',{exact:true})).toContainText('欢迎来到数字导览展厅');
  await page.getByLabel('选择定位',{exact:true}).selectOption(state.briefId);await expect(page.getByRole('textbox',{name:'待制作选题（每行一条，最多20条）',exact:true})).toHaveValue(/前台与餐厅如何交接服务/);
  expect(errors).toEqual([]);
  const result={result:'PASS_READ_ONLY_MAIN_CONTENT_BROWSER',verifiedAt:new Date().toISOString(),desktop:[1440,1100],mobile:[390,844],sourceKinds:4,wordBodyActuallyParsed:true,briefReopened:true,refreshPersistence:true,noHorizontalOverflow:true,pageErrors:errors,actions:'合成账号登录及只读导航；未保存、撤回或采集设备。'};
  fs.writeFileSync(folder+'/verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
