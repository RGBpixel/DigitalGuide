import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';

test('配置并检查模拟语音链路，模型的人工接待建议需本人确认才执行', async ({ page, context, browser }) => {
  await page.addInitScript(() => {
    (window as unknown as { microphoneChecks: number }).microphoneChecks = 0;
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { (window as unknown as { microphoneChecks: number }).microphoneChecks++; throw new DOMException('not needed', 'NotAllowedError'); } });
  });
  await page.goto('/'); await page.getByRole('button', { name: /林知 · 管理员/ }).click(); await expect(page.getByRole('heading', { name: '工作空间总览', exact: true })).toBeVisible();
  const me = (await (await page.request.get('/api/v1/me')).json()).data;
  async function post(path: string, body: unknown) { const r = await page.request.post('/api/v1' + path, { headers: { 'x-csrf-token': me.csrfToken, 'idempotency-key': crypto.randomUUID() }, data: body }); expect(r.ok(), await r.text()).toBe(true); return (await r.json()).data; }
  const profile = await post('/profiles', { workspaceId: f.workspaceA, name: '工具确认演示角色', avatarAssetId: f.avatarA, scenes: ['reception'] }), name = '语音契约应用' + Date.now();
  const app = await post('/scene-apps', { workspaceId: f.workspaceA, profileId: profile.id, name, scene: 'reception', preset: 'office', channelKey: 'contract-' + Date.now(), welcomeText: '您好，您可核对后请求人工接待。' });
  await page.goto('/knowledge'); await page.getByRole('button', { name: '场景应用配置', exact: true }).click(); await page.locator('.knowledge-doc-list button').filter({ hasText: name }).click();
  await page.getByRole('combobox', { name: 'ASR 适配器', exact: true }).selectOption('mock-asr'); await page.getByRole('combobox', { name: 'TTS 适配器', exact: true }).selectOption('mock-tone');
  await page.getByRole('checkbox', { name: '允许查询本场所公开接待人', exact: true }).check(); await page.getByRole('checkbox', { name: '允许提出人工接待请求（访客确认后执行）', exact: true }).check();
  await page.getByRole('button', { name: '保存场景配置', exact: true }).click(); await expect(page.getByRole('heading', { name: '编辑场景应用 · v2', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '合成检查样例', exact: true }).selectOption('handoff');
  await page.getByRole('button', { name: '运行模拟 ASR → 模型 → TTS 检查', exact: true }).click();
  const result = page.getByLabel('模拟语音检查结果', { exact: true }); await expect(result).toContainText('模拟字幕：请转人工接待'); await expect(result).toContainText('未采集麦克风、未执行业务工具');
  await expect(page.getByLabel('模拟提示音试听', { exact: true })).toHaveAttribute('src', /^data:audio\/wav;base64,/); await expect(page.getByLabel('模拟提示音试听', { exact: true })).toHaveAttribute('preload', 'none'); expect(await page.evaluate(() => (window as unknown as { microphoneChecks: number }).microphoneChecks)).toBe(0);
  const evidence = process.env.EVIDENCE_DIR || 'docs/evidence/latest'; mkdirSync(evidence, { recursive: true }); await result.screenshot({ path: evidence + '/runtime-contract-check.png' });
  const venues = (await (await page.request.get('/api/v1/venues?workspaceId=' + f.workspaceA)).json()).data, terminal = await post('/terminals', { venueId: venues[0].id, name: '工具浏览器终端' }), session = await post('/sessions', { terminalId: terminal.id, sceneAppId: app.id }), access = await post('/sessions/' + session.id + '/access', {});
  const guestContext = await browser.newContext();
  try {
    await guestContext.addCookies((await context.cookies()).filter(c => c.name === 'dg_guest')); const guest = await guestContext.newPage(); await guest.goto(access.terminalUrl);
    await guest.getByLabel('输入您的问题', { exact: true }).fill('请转人工接待'); await guest.getByRole('button', { name: '发送文字', exact: true }).click();
    const pending = guest.getByLabel('待确认的接待操作', { exact: true }); await expect(pending).toContainText('建议操作：请求工作人员接待'); await expect(pending.getByRole('button', { name: '确认请求人工接待', exact: true })).toBeDisabled();
    await expect(guest.locator('.guest-stage-top')).toContainText('文字接待中'); await pending.screenshot({ path: evidence + '/tool-pending-confirmation.png' });
    await pending.getByRole('checkbox', { name: '我确认请求工作人员接待，自动接待将暂停', exact: true }).check(); await pending.getByRole('button', { name: '确认请求人工接待', exact: true }).click();
    await expect(guest.locator('.guest-stage-top')).toContainText('等待工作人员接待'); await expect(guest.getByLabel('本次会话消息')).toContainText('已按您的明确确认转为人工接待'); expect((await guest.request.get('/api/v1/me')).status()).toBe(401);
    await guest.getByRole('button', { name: '结束本次接待', exact: true }).click();
  } finally { await guestContext.close(); }
});
