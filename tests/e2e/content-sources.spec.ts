import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test,expect,type Page } from '@playwright/test';
import { originalWordContentFixture } from '../../packages/test-fixtures/src/content.js';
import type { ContentBrief } from '@digitalguide/contracts';
const folder=process.env.EVIDENCE_DIR||'docs/evidence/latest';fs.mkdirSync(folder,{recursive:true});
async function login(page:Page,viewer=false){
  await page.goto('/');await page.getByRole('button',{name:viewer?/许宁 · 只读成员/:/林知 · 管理员/}).click();await page.getByRole('heading',{name:'工作空间总览',exact:true}).waitFor();
}
async function rights(page:Page){await page.getByLabel('内容授权主体',{exact:true}).fill('虚构原创作者');await page.getByLabel('来源与使用依据',{exact:true}).fill('本项目原创合成文字，仅供本地来源测试');await page.getByRole('checkbox',{name:'我已核对内容来源、授权及本次创作用途',exact:true}).check();}
async function top(page:Page){await page.evaluate(()=>window.scrollTo(0,0));await page.waitForFunction(()=>scrollY<=1);}
async function mobile(page:Page){await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>{const side=document.querySelector('.sidebar');return !side||side.getBoundingClientRect().right<=1;});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await top(page);}
test('页面实际读取Word及网页快照，刷新仍在；撤回隐藏正文，只读账号可查看记录',async({page})=>{
  test.setTimeout(60000);await login(page);await page.goto('/studio/content');
  await page.getByLabel('来源名称',{exact:true}).fill('浏览器原创Word讲稿');
  await page.getByLabel('来源类型',{exact:true}).selectOption('docx');
  await page.getByLabel('Word文件',{exact:true}).setInputFiles({name:'原创来源.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:await originalWordContentFixture()});
  await rights(page);await page.getByRole('button',{name:'读取并保存来源',exact:true}).click();
  await expect(page.getByLabel('已提取来源正文',{exact:true})).toContainText('表格中的讲解要点');
  const wordId=await page.getByLabel('选择来源',{exact:true}).inputValue();expect(wordId).not.toBe('');
  await page.reload();await page.getByLabel('选择来源',{exact:true}).selectOption(wordId);await expect(page.getByLabel('已提取来源正文',{exact:true})).toContainText('原创合成讲稿');
  await page.getByLabel('来源名称',{exact:true}).fill('浏览器原创网页快照');
  await page.getByLabel('来源类型',{exact:true}).selectOption('web');await page.getByLabel('公开网页地址',{exact:true}).fill('https://example.com/original');
  await page.getByLabel('网页读取方式',{exact:true}).selectOption('snapshot');await page.getByLabel('网页HTML快照',{exact:true}).fill('<html><head><script>不会执行的内容</script></head><body><p>原创网页 &amp; 讲解正文</p></body></html>');
  await rights(page);await page.getByRole('button',{name:'读取并保存来源',exact:true}).click();await expect(page.getByLabel('已提取来源正文',{exact:true})).toHaveText('原创网页 & 讲解正文');
  const webId=await page.getByLabel('选择来源',{exact:true}).inputValue();
  await top(page);await page.screenshot({path:folder+'/sources-desktop.png',fullPage:true});
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'撤回此来源',exact:true}).click();
  await expect(page.getByText('内容来源已撤回，不能再读取正文或用于新草稿。',{exact:true})).toBeVisible();await expect(page.getByLabel('已提取来源正文',{exact:true})).toHaveCount(0);
  await mobile(page);await page.screenshot({path:folder+'/sources-mobile.png',fullPage:true});
  await page.context().clearCookies();await login(page,true);await page.goto('/studio/content');await expect(page.getByRole('heading',{name:'添加内容来源',exact:true})).toHaveCount(0);
  await page.getByLabel('选择来源',{exact:true}).selectOption(webId);await expect(page.getByText('内容来源已撤回，不能再读取正文或用于新草稿。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'撤回此来源',exact:true})).toHaveCount(0);
});
test('账号定位和选题保存修订；另一窗口更新时保留人工输入并明确载入当前版本',async({page})=>{
  test.setTimeout(60000);await login(page);await page.goto('/studio/content');
  for(const [name,value] of Object.entries({'定位名称':'浏览器原创展厅定位','账号定位':'面向首次访客的原创讲解','目标受众':'首次访客','内容目标':'说明展厅路线','传播渠道':'官网与展厅','表达方式':'清楚亲切'}))await page.getByLabel(name,{exact:true}).fill(value);
  await page.getByLabel('待制作选题（每行一条，最多20条）',{exact:true}).fill('如何开始参观\n第一件展品的故事');await page.getByRole('button',{name:'保存定位与选题',exact:true}).click();
  await expect(page.getByLabel('选择定位',{exact:true})).not.toHaveValue('');
  const id=await page.getByLabel('选择定位',{exact:true}).inputValue(),me=(await(await page.request.get('/api/v1/me')).json()).data,b=(await(await page.request.get('/api/v1/studio/content/briefs/'+id)).json()).data as ContentBrief;
  await page.getByLabel('账号定位',{exact:true}).fill('我的未保存定位输入');
  const response=await page.request.post('/api/v1/studio/content/briefs/'+id+'/save',{headers:{'x-csrf-token':me.csrfToken,'idempotency-key':randomUUID()},data:{version:b.version,name:b.name,position:'另一窗口已核对的新定位',audience:b.audience,objective:b.objective,channel:b.channel,tone:b.tone,topics:b.topics}});expect(response.ok(),await response.text()).toBe(true);
  await expect(page.getByText('另一窗口已保存新版本，当前输入保留。',{exact:false})).toBeVisible();await expect(page.getByLabel('账号定位',{exact:true})).toHaveValue('我的未保存定位输入');await expect(page.getByRole('button',{name:'保存定位与选题',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'放弃输入并载入当前定位',exact:true}).click();await expect(page.getByLabel('账号定位',{exact:true})).toHaveValue('另一窗口已核对的新定位');
  await page.getByLabel('表达方式',{exact:true}).fill('简洁但保留事实');await page.getByRole('button',{name:'保存定位与选题',exact:true}).click();await expect(page.getByText('有未保存输入。',{exact:true})).toHaveCount(0);
  await page.getByText('定位修订历史',{exact:true}).click();await expect(page.locator('.content-history')).toHaveCount(3);await page.reload();await page.getByLabel('选择定位',{exact:true}).selectOption(id);await expect(page.getByLabel('表达方式',{exact:true})).toHaveValue('简洁但保留事实');await mobile(page);await page.screenshot({path:folder+'/brief-mobile.png',fullPage:true});
});
