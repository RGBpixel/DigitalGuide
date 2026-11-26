import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
async function openTerminal(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: /林知 · 管理员/ }).click();
  await page.getByRole('link', { name: '企业接待', exact: true }).click();
  await expect(page.getByRole('heading', { name: '企业接待', exact: true })).toBeVisible();
  await expect(page.getByText('此工作空间还没有终端，先为场所创建一个。',{exact:true}).or(page.getByLabel('当前终端',{exact:true}))).toBeVisible();
  if (!await page.getByRole('button', { name: '保存终端配置' }).isVisible()) await page.getByText('新增终端', { exact: true }).click();
  const [created] = await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/v1/terminals')&&r.request().method()==='POST'),page.getByRole('button', { name: '保存终端配置' }).click()]);
  expect(created.status()).toBe(201);const terminal=(await created.json()).data;
  await expect(page.getByLabel('当前终端',{exact:true})).toHaveValue(terminal.id);
  await page.getByRole('button', { name: '开始文字接待' }).click();
  await expect(page.getByRole('heading', { name: '您好，欢迎来访' })).toBeVisible();
  return page.url();
}
async function register(page: Page, name: string) {
  const panel = page.getByRole('region', { name: '来访登记' });
  await panel.getByLabel('姓名或昵称', { exact: true }).fill(name);
  await panel.getByLabel('单位（可选）', { exact: true }).fill('合成演示公司');
  await panel.getByLabel('受访人姓名', { exact: true }).fill('林知');
  await panel.getByLabel('来访事由', { exact: true }).fill('讨论数字人演示');
  await panel.getByRole('button', { name: '保存并核对登记' }).click();
  await panel.getByRole('checkbox', { name: /资料仅用于本次来访接待/ }).check();
  await panel.getByRole('button', { name: '确认登记并发送模拟通知' }).click();
  await expect(panel.getByText('模拟渠道已接受通知请求，正在等待接待人回复。', { exact: true })).toBeVisible();
  return panel;
}
async function copyGuestCookies(from: BrowserContext, to: BrowserContext) { await to.addCookies((await from.cookies()).filter(cookie => cookie.name === 'dg_guest')); }

test('独立匿名浏览器登记，指定员工回复后公开引导并结束，内部备注不泄露', async ({ page, context, browser }) => {
  const terminalUrl = await openTerminal(page), guestContext = await browser.newContext();
  try {
    await copyGuestCookies(context, guestContext); const guest = await guestContext.newPage(); await guest.goto(terminalUrl);
    const name = '虚构访客 · 完整登记'; const panel = await register(guest, name);
    await expect(panel.getByText('接待人已明确同意本次来访，请按指引行动。')).toHaveCount(0);
    await page.goto('/visit-inbox');
    const row = page.getByRole('row').filter({ hasText: name }); await row.getByRole('button', { name: /查看 \/ 处理/ }).click();
    const detail = page.getByRole('region', { name: '来访处理详情' });
    await detail.getByLabel('公开接待位置').selectOption('waiting_area');
    await detail.getByLabel('内部备注（不公开给访客）').fill('虚构内部备注：请由演示前台安排。');
    await detail.getByRole('button', { name: '同意接待', exact: true }).click();
    await expect(panel.getByText('请前往一层访客等候区，接待人会到现场迎接。', { exact: true })).toBeVisible();
    await expect(guest.getByText('虚构内部备注：请由演示前台安排。', { exact: true })).toHaveCount(0);
    await guest.reload(); await expect(guest.getByText('请前往一层访客等候区，接待人会到现场迎接。', { exact: true })).toBeVisible();
    const evidence = process.env.EVIDENCE_DIR || 'docs/evidence/latest'; mkdirSync(evidence, { recursive: true });
    await guest.screenshot({ path: evidence + '/visit-guest-desktop.png', fullPage: true });
    await guest.setViewportSize({ width: 390, height: 844 }); expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guest.screenshot({ path: evidence + '/visit-guest-mobile.png', fullPage: true });
    await guest.getByRole('button', { name: '已到达，结束本次来访' }).click();
    await expect(guest.getByText('本次来访处理已结束。感谢您的配合。', { exact: true })).toBeVisible();
    await page.goto('/visits'); await expect(page.getByRole('row').filter({ hasText: name }).getByText('已结束', { exact: true })).toBeVisible();
    await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: /查看 \/ 处理/ }).click();
    await page.screenshot({ path: evidence + '/visits-management-desktop.png', fullPage: true });
    await guest.getByRole('button', { name: '结束本次接待', exact: true }).click();
  } finally { await guestContext.close(); }
});
test('模拟回执未知会转人工，前台结束处理不伪造接待人同意', async ({ page, context, browser }) => {
  const terminalUrl = await openTerminal(page), guestContext = await browser.newContext();
  try {
    await copyGuestCookies(context, guestContext); const guest = await guestContext.newPage(); await guest.goto(terminalUrl);
    const name = '虚构访客 · 未知回执'; const panel = await register(guest, name);
    await page.goto('/visits'); await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: /查看 \/ 处理/ }).click();
    await page.getByRole('region', { name: '来访处理详情' }).getByRole('button', { name: '模拟结果未知', exact: true }).click();
    await expect(panel.getByText('本次接待需要工作人员协助，系统没有代替接待人表示同意。', { exact: true })).toBeVisible();
    await expect(panel.getByText('接待人已明确同意本次来访，请按指引行动。')).toHaveCount(0);
    await page.getByRole('button', { name: '结束处理记录' }).click();
    await expect(panel.getByText('本次来访处理已结束。感谢您的配合。', { exact: true })).toBeVisible();
    await guest.getByRole('button', { name: '结束本次接待', exact: true }).click();
  } finally { await guestContext.close(); }
});
