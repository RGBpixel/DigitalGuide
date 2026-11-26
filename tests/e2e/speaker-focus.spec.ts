import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
async function setup(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: /林知 · 管理员/ }).click(); await expect(page.getByRole('heading', { name: '工作空间总览', exact: true })).toBeVisible();
  const me = (await (await page.request.get('/api/v1/me')).json()).data;
  async function post(path: string, data: unknown) { const r = await page.request.post('/api/v1' + path, { data, headers: { 'x-csrf-token': me.csrfToken, 'idempotency-key': crypto.randomUUID() } }); expect(r.ok(), await r.text()).toBe(true); return (await r.json()).data; }
  const suffix = Date.now(), name = '专注对话场景' + suffix, profile = await post('/profiles', { workspaceId: f.workspaceA, name: '合成说话人角色' + suffix, avatarAssetId: f.avatarA, scenes: ['reception'] });
  const app = await post('/scene-apps', { workspaceId: f.workspaceA, profileId: profile.id, name, scene: 'reception', preset: 'office', channelKey: 'focus-' + suffix, welcomeText: '欢迎使用专注对话。', speakerProvider: 'mock-focus-final', targetSpeechProvider: 'mock-target-speech' });
  const venues = (await (await page.request.get('/api/v1/venues?workspaceId=' + f.workspaceA)).json()).data, terminal = await post('/terminals', { venueId: venues[0].id, name: '合成专注终端' }), session = await post('/sessions', { terminalId: terminal.id, sceneAppId: app.id }), access = await post('/sessions/' + session.id + '/access', {});
  return { post, name, session, access };
}
const evidence = process.env.EVIDENCE_DIR || 'docs/evidence/latest';
test('专注对话配置、partial 过滤、最终字幕、本人重锁及下一位交接，桌面手机均可操作', async ({ page, context, browser }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); const c = await setup(page);
  await page.goto('/knowledge'); await page.getByRole('button', { name: '场景应用配置', exact: true }).click(); await page.locator('.knowledge-doc-list button').filter({ hasText: c.name }).click();
  await expect(page.getByRole('combobox', { name: '目标说话人服务', exact: true })).toHaveValue('mock-focus-final'); await page.getByRole('combobox', { name: '目标说话人服务', exact: true }).selectOption('mock-focus-early'); await page.getByRole('button', { name: '保存场景配置', exact: true }).click(); await expect(page.getByRole('heading', { name: '编辑场景应用 · v2', exact: true })).toBeVisible();
  // Old session snapshot deliberately remains final-only; provider changes revoke old use.
  await page.getByRole('combobox', { name: '目标说话人服务', exact: true }).selectOption('mock-focus-final'); await page.getByRole('button', { name: '保存场景配置', exact: true }).click(); await expect(page.getByRole('heading', { name: '编辑场景应用 · v3', exact: true })).toBeVisible();
  const guestContext = await browser.newContext();
  await guestContext.addInitScript(() => { (window as unknown as { deviceCalls: number }).deviceCalls = 0; if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} }); Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { (window as unknown as { deviceCalls: number }).deviceCalls++; throw new DOMException('denied', 'NotAllowedError'); } }); });
  try {
    await guestContext.addCookies((await context.cookies()).filter(c => c.name === 'dg_guest')); const guest = await guestContext.newPage(); guest.on('pageerror', e => errors.push(e.message)); await guest.goto(c.access.terminalUrl);
    const panel = guest.getByRole('region', { name: '专注对话', exact: true }); await expect(panel.getByRole('button', { name: '开始专注对话', exact: true })).toBeDisabled();
    await panel.getByRole('checkbox', { name: /我确认本次服务对象是本人/ }).check(); await panel.getByRole('button', { name: '开始专注对话', exact: true }).click(); await expect(panel.getByRole('status')).toHaveText('正在确认合成参考');
    await page.goto('/speaker-lab/' + c.session.id); await page.getByRole('combobox', { name: '合成参考样例', exact: true }).selectOption('overlapping'); await page.getByRole('button', { name: '确认此合成参考样例', exact: true }).click(); await expect(panel.getByRole('status')).toHaveText('声音参考不确定'); await expect(panel).toContainText('请轮流发言');
    await panel.getByRole('button', { name: '使用清晰合成样例确认', exact: true }).click(); await expect(panel.getByRole('status')).toHaveText('已锁定合成样例');
    const conversation = guest.getByLabel('本次会话消息', { exact: true });
    await page.getByRole('combobox', { name: '模拟事件类型', exact: true }).selectOption('target_partial'); await page.getByRole('textbox', { name: '仅供测试的合成字幕', exact: true }).fill('尚未确认的片段'); await page.getByRole('button', { name: '发送模拟事件', exact: true }).click(); await expect(page.getByRole('status')).toContainText('仅缓冲'); await expect(conversation).not.toContainText('尚未确认的片段');
    await page.getByRole('combobox', { name: '模拟事件类型', exact: true }).selectOption('other_final'); await page.getByRole('textbox', { name: '仅供测试的合成字幕', exact: true }).fill('旁人更响也不该进入'); await page.getByRole('button', { name: '发送模拟事件', exact: true }).click(); await expect(page.getByRole('status')).toContainText('内容未进入对话'); await expect(conversation).not.toContainText('旁人更响也不该进入');
    await page.getByRole('button', { name: '开始新的合成片段', exact: true }).click(); await page.getByRole('combobox', { name: '模拟事件类型', exact: true }).selectOption('target_final'); await page.getByRole('textbox', { name: '仅供测试的合成字幕', exact: true }).fill('本人确认的合成问题'); await page.getByRole('button', { name: '发送模拟事件', exact: true }).click(); await expect(conversation).toContainText('本人确认的合成问题'); await expect(conversation).toContainText('已确认模拟目标字幕');
    mkdirSync(evidence, { recursive: true }); await guest.screenshot({ path: evidence + '/speaker-focus-desktop.png', fullPage: true }); await page.screenshot({ path: evidence + '/speaker-lab-desktop.png', fullPage: true });
    await guest.setViewportSize({ width: 390, height: 844 }); expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await guest.screenshot({ path: evidence + '/speaker-focus-mobile.png', fullPage: true });
    await panel.getByRole('checkbox', { name: /仍由本人继续/ }).check(); await panel.getByRole('button', { name: '本人重新确认声音', exact: true }).click(); await expect(panel.getByRole('status')).toHaveText('请重新确认本人参考'); await panel.getByRole('button', { name: '使用清晰合成样例确认', exact: true }).click(); await expect(panel.getByRole('status')).toHaveText('已锁定合成样例');
    await guest.getByLabel('输入您的问题', { exact: true }).fill('上一位未发送的草稿'); await panel.getByRole('checkbox', { name: /我确认结束本次接待/ }).check(); await panel.getByRole('button', { name: '交给下一位并开启新会话', exact: true }).click(); await expect(guest).not.toHaveURL(new RegExp(c.session.id)); await expect(guest.getByLabel('输入您的问题', { exact: true })).toHaveValue(''); await expect(conversation).not.toContainText('本人确认的合成问题'); await expect(panel.getByRole('status')).toHaveText('等待下一位确认');
    expect((await guest.request.get('/api/v1/me')).status()).toBe(401); expect(await guest.evaluate(() => (window as unknown as { deviceCalls: number }).deviceCalls)).toBe(0); await guest.getByRole('button', { name: '结束本次接待', exact: true }).click();
  } finally { await guestContext.close(); }
  expect(errors).toEqual([]);
});

test('本人独立登记、一次性授权使用和撤回，参考匹配不成为登录身份', async ({ page, context, browser }) => {
  const c = await setup(page); await page.goto('/speaker-references'); await page.getByRole('checkbox', { name: /我同意仅为专注对话登记本人合成参考/ }).check(); await page.getByRole('button', { name: '登记合成参考', exact: true }).click();
  await page.getByLabel('接待会话编号', { exact: true }).fill(c.session.id); await page.getByRole('checkbox', { name: /我确认仅供本人在上述会话中使用一次/ }).check(); await page.getByRole('button', { name: '签发本次使用码', exact: true }).click(); const code = page.getByLabel('本次使用码', { exact: true }); await expect(code).toHaveAttribute('type', 'password'); await expect(code).toHaveValue(/^SF1\./);
  const guestContext = await browser.newContext();
  try {
    await guestContext.addCookies((await context.cookies()).filter(c => c.name === 'dg_guest')); const guest = await guestContext.newPage(); await guest.goto(c.access.terminalUrl); const panel = guest.getByRole('region', { name: '专注对话', exact: true });
    await panel.getByRole('combobox', { name: '本次声音参考方式', exact: true }).selectOption('enrolled'); await panel.getByLabel('粘贴本人参考使用码', { exact: true }).fill(await code.inputValue()); await panel.getByRole('checkbox', { name: /我确认本次服务对象是本人/ }).check(); await panel.getByRole('button', { name: '开始专注对话', exact: true }).click(); await expect(panel.getByRole('status')).toHaveText('正在确认合成参考'); await panel.getByRole('button', { name: '使用清晰合成样例确认', exact: true }).click(); await expect(panel.getByRole('status')).toHaveText('已锁定合成样例'); expect((await guest.request.get('/api/v1/me')).status()).toBe(401);
    mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: evidence + '/speaker-reference-owner.png', fullPage: true });
    await page.getByRole('checkbox', { name: /我确认撤回本参考/ }).check(); await page.getByRole('button', { name: '撤回并清理本参考', exact: true }).click(); await expect(page.getByRole('combobox', { name: '选择本人参考', exact: true })).toContainText('已撤回'); await expect(page.getByText('模拟服务清理完成', { exact: false })).toBeVisible(); await expect(panel.getByRole('status')).toHaveText('本次专注对话已关闭'); expect((await guest.request.get('/api/v1/me')).status()).toBe(401);
    await guest.getByRole('button', { name: '结束本次接待', exact: true }).click();
  } finally { await guestContext.close(); }
});
