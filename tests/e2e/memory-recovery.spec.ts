import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
async function terminal(admin: Page) {
  await admin.goto('/reception'); await expect(admin.getByRole('heading', { name: '企业接待', exact: true })).toBeVisible();
  await expect(admin.getByText('正在加载终端…', { exact: true })).not.toBeVisible();
  if (!await admin.getByRole('button', { name: '保存终端配置' }).isVisible()) await admin.getByText('新增终端', { exact: true }).click();
  await admin.getByRole('button', { name: '保存终端配置', exact: true }).click(); await admin.getByRole('button', { name: '开始文字接待', exact: true }).click();
  await expect(admin.getByRole('heading', { name: '您好，欢迎来访', exact: true })).toBeVisible(); return admin.url();
}
async function copyGuest(from: BrowserContext, to: BrowserContext) { await to.addCookies((await from.cookies()).filter(c => c.name === 'dg_guest')); }
test('本人生成凭证并在下次独立会话恢复偏好，原凭证不能再次复用', async ({ page, context, browser }) => {
  await page.goto('/'); await page.getByRole('button', { name: /林知 · 管理员/ }).click();
  const url = await terminal(page), firstContext = await browser.newContext(), nextContext = await browser.newContext(), thirdContext = await browser.newContext();
  try {
    await copyGuest(context, firstContext); const first = await firstContext.newPage(); await first.goto(url);
    const mine = first.getByRole('region', { name: '我的接待偏好', exact: true });
    await mine.getByLabel('希望怎样称呼您', { exact: true }).fill('自愿恢复的演示来客');
    await mine.getByRole('checkbox', { name: /我同意保存本人资料/ }).check(); await mine.getByRole('button', { name: '自愿建立本人资料', exact: true }).click();
    await mine.getByLabel('本人声明', { exact: true }).fill('演示偏好：喜欢温水');
    await mine.getByRole('combobox', { name: '使用范围', exact: true }).selectOption('reception');
    await mine.getByRole('button', { name: '添加待确认记忆', exact: true }).click(); await mine.getByRole('button', { name: '核对并确认记忆', exact: true }).click();
    await mine.getByRole('checkbox', { name: '允许个性化接待', exact: true }).check(); await mine.getByRole('button', { name: '保存资料与交流设置', exact: true }).click();
    await mine.getByRole('checkbox', { name: /我需要恢复凭证/ }).check(); await mine.getByRole('button', { name: '生成本人恢复凭证', exact: true }).click();
    const codeInput = mine.getByLabel('恢复凭证（仅本次生成时显示）', { exact: true }); await expect(codeInput).toBeVisible(); await expect(codeInput).toHaveAttribute('type', 'password');
    const code = await codeInput.inputValue(); expect(code).toMatch(/^DG1\./);
    await first.getByRole('button', { name: '结束本次接待', exact: true }).click();
    const nextUrl = await terminal(page); await copyGuest(context, nextContext); const next = await nextContext.newPage(); await next.goto(nextUrl);
    const current = next.getByRole('region', { name: '我的接待偏好', exact: true });
    await current.getByText('恢复已有偏好', { exact: true }).click();
    await current.getByLabel('粘贴本人恢复凭证', { exact: true }).fill(code);
    await current.getByRole('checkbox', { name: /我同意在当前会话接续/ }).check();
    await current.getByRole('button', { name: '校验凭证并恢复偏好', exact: true }).click();
    await expect(current.getByLabel('显示称呼')).toHaveValue('自愿恢复的演示来客'); await expect(current.locator('.memory-fact')).toContainText('演示偏好：喜欢温水');
    await next.getByLabel('输入您的问题', { exact: true }).fill('记得我的偏好吗');
    await next.getByRole('button', { name: '发送文字', exact: true }).click();
    await expect(next.getByLabel('本次会话消息').getByText(/您已确认并允许本场所使用的资料/)).toContainText('演示偏好：喜欢温水');
    expect((await next.request.get('/api/v1/me')).status()).toBe(401);
    const evidence = process.env.EVIDENCE_DIR || 'docs/evidence/latest'; mkdirSync(evidence, { recursive: true });
    await current.screenshot({ path: evidence + '/restored-memory.png' });
    await next.reload(); await expect(current.getByLabel('显示称呼')).toHaveValue('自愿恢复的演示来客');
    await next.getByRole('button', { name: '结束本次接待', exact: true }).click();
    const thirdUrl = await terminal(page); await copyGuest(context, thirdContext); const third = await thirdContext.newPage(); await third.goto(thirdUrl);
    const blank = third.getByRole('region', { name: '我的接待偏好', exact: true }); await blank.getByText('恢复已有偏好', { exact: true }).click();
    await blank.getByLabel('粘贴本人恢复凭证', { exact: true }).fill(code); await blank.getByRole('checkbox', { name: /我同意在当前会话接续/ }).check();
    await blank.getByRole('button', { name: '校验凭证并恢复偏好', exact: true }).click(); await expect(blank.getByRole('alert')).toContainText('恢复凭证无效');
    await expect(blank.getByRole('button', { name: '自愿建立本人资料', exact: true })).toBeVisible();
    await third.getByRole('button', { name: '结束本次接待', exact: true }).click();
  } finally { await firstContext.close(); await nextContext.close(); await thirdContext.close(); }
});

