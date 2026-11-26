import {expect,type Page} from '@playwright/test';

export async function revealProcessingSource(page:Page,assetId:string){
 const picker=page.getByLabel('原始素材',{exact:true}),option=picker.locator('option[value="'+assetId+'"]'),more=page.getByRole('button',{name:'加载更多原始素材',exact:true});await expect(picker).toBeVisible();
 for(let n=0;n<100;n++){
  await expect.poll(async()=>Number(await option.count()===1)+Number(await more.isVisible()),{timeout:10000}).toBeGreaterThan(0);if(await option.count()===1)break;
  const previous=await picker.locator('option').count();await more.click();await expect.poll(()=>picker.locator('option').count()).toBeGreaterThan(previous);
 }
 await expect(option).toHaveCount(1);
}
