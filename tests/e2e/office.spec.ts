import { test, expect, type Page, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
const evidence = process.env.EVIDENCE_DIR || 'docs/evidence/latest';
async function login(page: Page, account = '林知 · 管理员') {
  await page.goto('/office'); await page.getByRole('button', { name: new RegExp(account) }).click();
  await expect(page.getByRole('heading', { name: '消息与日历', exact: true })).toBeVisible();
}
async function colleague(browser: Browser) { const context = await browser.newContext(); const page = await context.newPage(); await login(page, '陈墨 · 内容编辑'); return { context, page }; }
function toLocal(d: Date) { const pad = (v: number) => String(v).padStart(2, '0'); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

test('同事口信从草稿确认到独立收件、已读、本人确认和撤回，公共提示不泄露', async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await login(page);
  await page.getByRole('tab', { name: '我发出的口信', exact: true }).click();
  const form = page.getByRole('form', { name: '口信编辑' });
  await form.getByRole('combobox', { name: '收信同事', exact: true }).selectOption(f.editorA);
  await form.getByLabel('口信题目', { exact: true }).fill('口信浏览器验证');
  await form.getByLabel('口信正文', { exact: true }).fill('虚构私密口信：请核对演示讲稿。');
  await form.getByRole('combobox', { name: '转达渠道', exact: true }).selectOption('mock');
  await form.getByRole('button', { name: '保存口信草稿', exact: true }).click();
  const detail = page.getByRole('region', { name: '口信核对与回执', exact: true });
  await expect(detail.getByRole('button', { name: '确认转达此口信', exact: true })).toBeDisabled();
  await detail.getByRole('checkbox', { name: /我已核对收信人/ }).check();
  await detail.getByRole('button', { name: '确认转达此口信', exact: true }).click();
  await expect(detail.getByText('模拟渠道已接受', { exact: true })).toBeVisible();
  const receiver = await colleague(browser);
  try {
    const card = receiver.page.locator('.office-notification').filter({ hasText: '口信浏览器验证' });
    await expect(card).toContainText('虚构私密口信：请核对演示讲稿。');
    const publicBox = receiver.page.locator('.office-public-note'); await expect(publicBox).toContainText('您有待查看消息'); await expect(publicBox).not.toContainText('虚构私密口信');
    await card.getByRole('button', { name: '标记已读', exact: true }).click();
    await expect(detail.locator('.office-receipt')).toContainText('已读');
    await expect(detail.locator('.office-receipt')).not.toContainText('本人已确认');
    await card.getByRole('button', { name: '我已确认', exact: true }).click();
    await expect(detail.locator('.office-receipt')).toContainText('本人已确认');
    mkdirSync(evidence, { recursive: true }); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: evidence + '/office-desktop.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 }); await expect.poll(() => page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: evidence + '/office-mobile.png', fullPage: true, animations: 'disabled' });
    await detail.getByRole('button', { name: '撤回本地口信', exact: true }).click();
    await expect(detail.getByRole('heading', { name: '已撤回口信', exact: true })).toBeVisible();
    await expect(receiver.page.locator('.office-inbox')).not.toContainText('虚构私密口信');
    await expect(receiver.page.getByText('旧提醒已撤销', { exact: true })).toBeVisible();
    await receiver.page.reload(); await expect(receiver.page.locator('.office-inbox')).not.toContainText('虚构私密口信');
  } finally { await receiver.context.close(); }
  expect(errors).toEqual([]);
});
test('本地会议由参与者回应，组织者改期与取消，旧提醒失效且新状态持久', async ({ page, browser }) => {
  await login(page); await page.getByRole('tab', { name: '会议与提醒', exact: true }).click();
  const form = page.getByRole('form', { name: '本地会议编辑', exact: true });
  await form.getByLabel('会议题目', { exact: true }).fill('会议浏览器验证');
  await form.getByLabel('会议说明', { exact: true }).fill('仅参与同事可见的本地会议。');
  await form.getByLabel('会议地点', { exact: true }).fill('演示会议室 A');
  await form.getByRole('checkbox', { name: '陈墨 · 内容编辑', exact: true }).check();
  const review = form.getByRole('checkbox', { name: /我已核对时间/ });
  await review.check(); await form.getByLabel('会议地点', { exact: true }).fill('演示会议室 B');
  await expect(review).not.toBeChecked(); await expect(form.getByRole('button', { name: '确认创建本地会议', exact: true })).toBeDisabled();
  await review.check(); await form.getByRole('button', { name: '确认创建本地会议', exact: true }).click();
  const detail = page.getByRole('region', { name: '会议详情与回应', exact: true });
  await expect(detail.getByRole('heading', { name: '会议浏览器验证', exact: true })).toBeVisible();
  const receiver = await colleague(browser);
  try {
    await receiver.page.getByRole('tab', { name: '会议与提醒', exact: true }).click();
    await receiver.page.locator('.office-list-row').filter({ hasText: '会议浏览器验证' }).click();
    const theirs = receiver.page.getByRole('region', { name: '会议详情与回应', exact: true });
    await theirs.getByRole('button', { name: '本人同意参加', exact: true }).click();
    await expect(detail.locator('.office-attendee-list > span').filter({ hasText: '陈墨' })).toContainText('同意参加');
    await detail.getByRole('button', { name: '修改会议与提醒', exact: true }).click();
    await form.getByLabel('会议地点', { exact: true }).fill('改期后的新会议室');
    await form.getByLabel('开始时间', { exact: true }).fill(toLocal(new Date(Date.now() + 120 * 60000)));
    await form.getByLabel('结束时间', { exact: true }).fill(toLocal(new Date(Date.now() + 150 * 60000)));
    await review.check(); await form.getByRole('button', { name: '确认改期并替换旧提醒', exact: true }).click();
    await expect(theirs).toContainText('改期后的新会议室');
    await expect(theirs.locator('.office-attendee-list > span').filter({ hasText: '陈墨' })).toContainText('待本人回应');
    await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: evidence + '/calendar-desktop.png', fullPage: true, animations: 'disabled' });
    await detail.getByRole('checkbox', { name: /确认取消本次会议/ }).check();
    await detail.getByRole('button', { name: '取消此会议', exact: true }).click();
    await expect(theirs.getByText('会议已取消', { exact: true })).toBeVisible();
    await receiver.page.getByRole('tab', { name: '我的收件箱', exact: true }).click();
    await expect(receiver.page.locator('.office-notification').filter({ hasText: '会议已取消：会议浏览器验证' })).toContainText('组织者已取消会议');
    await page.reload(); await expect(page.getByRole('region', { name: '会议详情与回应' }).getByText('会议已取消', { exact: true })).toBeVisible();
  } finally { await receiver.context.close(); }
});

