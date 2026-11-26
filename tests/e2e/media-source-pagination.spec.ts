import {randomUUID} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {syntheticPng} from '@digitalguide/media';
import type {Asset} from '@digitalguide/contracts';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {revealProcessingSource} from './processing-choices.js';

test('素材超过一页后明确加载原始素材下一页，仍可选择真实上传来源',async({page})=>{
 test.setTimeout(60000);await page.goto('/studio/processing');await page.getByRole('button',{name:/林知 · 管理员/}).click();await expect(page.getByRole('heading',{name:'媒体加工',exact:true})).toBeVisible();const me=(await(await page.request.get('/api/v1/me')).json()).data;
 async function post<T>(url:string,data:object):Promise<T>{const r=await page.request.post('/api/v1'+url,{data,headers:{'x-csrf-token':me.csrfToken,'idempotency-key':randomUUID()}});expect(r.ok(),await r.text()).toBe(true);return(await r.json()).data;}
 const assets:Asset[]=[];
 for(let i=0;i<35;i++){const upload=await post<{uploadId:string}>('/assets/uploads',{workspaceId:f.workspaceA,fileName:'pagination-original-'+i+'.png',contentBase64:syntheticPng().toString('base64')});assets.push(await post<Asset>('/assets',{uploadId:upload.uploadId,name:'素材分页验证 '+i,category:'reference'}));}
 const first=(await(await page.request.get('/api/v1/assets?workspaceId='+f.workspaceA+'&limit=30')).json()).data,ids=new Set(first.items.map((a:Asset)=>a.id)),target=assets.find(a=>!ids.has(a.id));expect(target).toBeTruthy();await page.reload();await expect(page.getByRole('button',{name:'加载更多原始素材',exact:true})).toBeVisible();await revealProcessingSource(page,target!.id);await page.getByLabel('原始素材',{exact:true}).selectOption(target!.id);await expect(page.getByLabel('原始素材',{exact:true})).toHaveValue(target!.id);expect((await(await page.request.get('/api/v1/assets/'+target!.id)).json()).data.sha256).toBe(target!.sha256);
});
