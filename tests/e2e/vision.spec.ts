import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
interface FakeDevices { screenPending: boolean; screenDenied: boolean; stopCount: number; resolveScreen: (() => void) | null }
async function fakeDevices(context: BrowserContext, pending = false) {
  await context.addInitScript(({ pending }) => {
    const state: FakeDevices = { screenPending: pending, screenDenied: false, stopCount: 0, resolveScreen: null };
    (window as unknown as { fakeVisionDevices: FakeDevices }).fakeVisionDevices = state;
    function stream(label: string) {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; const ctx = canvas.getContext('2d')!;
      function draw() { ctx.fillStyle = label === 'CAMERA' ? '#245e50' : '#42618c'; ctx.fillRect(0, 0, 640, 480); ctx.fillStyle = '#e6ecda'; ctx.font = '28px sans-serif'; ctx.fillText('SYNTHETIC ' + label, 100, 220); }
      draw(); const timer = setInterval(draw, 100), result = canvas.captureStream(10);
      for (const track of result.getTracks()) { const original = track.stop.bind(track); track.stop = () => { state.stopCount++; clearInterval(timer); original(); }; }
      return result;
    }
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => stream('CAMERA') });
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      if (state.screenDenied) throw new DOMException('synthetic denied', 'NotAllowedError');
      if (state.screenPending) return new Promise<MediaStream>(resolve => { state.resolveScreen = () => resolve(stream('SCREEN')); });
      return stream('SCREEN');
    } });
  }, { pending });
}
async function setup(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: /林知 · 管理员/ }).click(); await expect(page.getByRole('heading', { name: '工作空间总览', exact: true })).toBeVisible();
  const me = (await (await page.request.get('/api/v1/me')).json()).data;
  async function post(path: string, body: unknown) { const r = await page.request.post('/api/v1' + path, { headers: { 'x-csrf-token': me.csrfToken, 'idempotency-key': crypto.randomUUID() }, data: body }); expect(r.ok(), await r.text()).toBe(true); return (await r.json()).data; }
  const profile = await post('/profiles', { workspaceId: f.workspaceA, name: '画面演示角色', avatarAssetId: f.avatarA, scenes: ['reception'] });
  const name = '画面应用' + Date.now(), app = await post('/scene-apps', { workspaceId: f.workspaceA, profileId: profile.id, name, scene: 'reception', preset: 'office', channelKey: 'visual-' + Date.now(), welcomeText: '您好，您可主动选择本次画面。' });
  await page.goto('/knowledge'); await page.getByRole('button', { name: '场景应用配置', exact: true }).click(); await page.locator('.knowledge-doc-list button').filter({ hasText: name }).click();
  await page.getByRole('combobox', { name: '视觉服务', exact: true }).selectOption('mock-vision');
  await page.getByRole('checkbox', { name: '允许访客主动选择相机画面', exact: true }).check(); await page.getByRole('checkbox', { name: '允许访客主动选择共享屏幕', exact: true }).check();
  await page.getByRole('button', { name: '保存场景配置', exact: true }).click(); await expect(page.getByRole('heading', { name: '编辑场景应用 · v2', exact: true })).toBeVisible();
  const venues = (await (await page.request.get('/api/v1/venues?workspaceId=' + f.workspaceA)).json()).data;
  const terminal = await post('/terminals', { venueId: venues[0].id, name: '画面浏览器终端' }), session = await post('/sessions', { terminalId: terminal.id, sceneAppId: app.id });
  const access = await post('/sessions/' + session.id + '/access', {}); return access.terminalUrl as string;
}
test('相机与屏幕先本机预览再逐次授权单帧，撤回清理回复且从不自动认人', async ({ page, browser, context }) => {
  const url = await setup(page), guestContext = await browser.newContext(); await fakeDevices(guestContext);
  try {
    await guestContext.addCookies((await context.cookies()).filter(c => c.name === 'dg_guest')); const guest = await guestContext.newPage(), sent: string[] = [];
    guest.on('request', r => { if (r.method() === 'POST' && /\/vision\/(questions|grants)$/.test(r.url())) sent.push(r.url()); });
    await guest.goto(url); const panel = guest.getByRole('region', { name: '本次画面问答', exact: true });
    await guest.getByRole('button', { name: '开启摄像头预览', exact: true }).click(); await expect.poll(() => guest.getByLabel('本机摄像头预览').evaluate((e: HTMLVideoElement) => e.readyState)).toBeGreaterThanOrEqual(2);
    expect(sent).toHaveLength(0); await expect(panel.getByRole('button', { name: '允许本次画面问答', exact: true })).toBeDisabled();
    await panel.getByRole('checkbox', { name: /我允许将选中的画面/ }).check(); await panel.getByRole('button', { name: '允许本次画面问答', exact: true }).click(); await expect(panel).toContainText('已允许相机单帧提问'); expect(sent.filter(x => x.endsWith('/questions'))).toHaveLength(0);
    await panel.getByRole('textbox', { name: '针对当前画面提问', exact: true }).fill('请介绍我选中的画面'); await panel.getByRole('button', { name: '发送当前画面并提问', exact: true }).click();
    const messages = guest.getByLabel('本次会话消息', { exact: true }); await expect(messages).toContainText('无法判断画面中的人物'); await expect(messages).toContainText('不作为身份确认'); expect(sent.filter(x => x.endsWith('/questions'))).toHaveLength(1);
    const evidence = process.env.EVIDENCE_DIR || 'docs/evidence/latest'; mkdirSync(evidence, { recursive: true }); await panel.screenshot({ path: evidence + '/vision-camera-authorized.png' });
    await panel.getByRole('button', { name: '关闭来源并撤回授权', exact: true }).click(); await expect(panel.getByRole('button', { name: '允许本次画面问答', exact: true })).toBeVisible(); await expect(messages).not.toContainText('无法判断画面中的人物');
    await panel.getByRole('button', { name: '共享屏幕预览', exact: true }).click(); await expect.poll(() => guest.getByLabel('本机共享屏幕预览').evaluate((e: HTMLVideoElement) => e.readyState)).toBeGreaterThanOrEqual(2);
    await panel.getByRole('combobox', { name: '选择本次发送来源', exact: true }).selectOption('screen'); await panel.getByRole('checkbox', { name: /我允许将选中的画面/ }).check();
    await panel.getByRole('button', { name: '允许本次画面问答', exact: true }).click(); await expect(panel).toContainText('已允许选定屏幕单帧提问');
    await panel.getByRole('textbox', { name: '针对当前画面提问', exact: true }).fill('请查看当前共享窗口'); await panel.getByRole('button', { name: '发送当前画面并提问', exact: true }).click(); await expect(messages).toContainText('本次选定屏幕');
    await panel.screenshot({ path: evidence + '/vision-screen-authorized.png' }); expect((await guest.request.get('/api/v1/me')).status()).toBe(401);
    await guest.setViewportSize({ width: 390, height: 844 }); expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await panel.screenshot({ path: evidence + '/vision-mobile.png' });
    await guest.getByRole('button', { name: '结束本次接待', exact: true }).click(); await expect(guest.getByLabel('本机共享屏幕预览')).not.toBeVisible();
    expect(await guest.evaluate(() => (window as unknown as { fakeVisionDevices: FakeDevices }).fakeVisionDevices.stopCount)).toBe(2);
  } finally { await guestContext.close(); }
});
test('取消后迟到的屏幕授权立即释放，拒绝共享仍可文字交流且不会上传', async ({ page, browser, context }) => {
  const url = await setup(page), guestContext = await browser.newContext(); await fakeDevices(guestContext, true);
  try {
    await guestContext.addCookies((await context.cookies()).filter(c => c.name === 'dg_guest')); const guest = await guestContext.newPage(), uploads: string[] = [];
    guest.on('request', r => { if (r.method() === 'POST' && r.url().includes('/vision/')) uploads.push(r.url()); }); await guest.goto(url);
    const panel = guest.getByRole('region', { name: '本次画面问答', exact: true }); await panel.getByRole('button', { name: '共享屏幕预览', exact: true }).click();
    await panel.getByRole('button', { name: '取消屏幕共享请求', exact: true }).click(); await guest.evaluate(() => (window as unknown as { fakeVisionDevices: FakeDevices }).fakeVisionDevices.resolveScreen!());
    await expect.poll(() => guest.evaluate(() => (window as unknown as { fakeVisionDevices: FakeDevices }).fakeVisionDevices.stopCount)).toBe(1);
    await guest.evaluate(() => { const state = (window as unknown as { fakeVisionDevices: FakeDevices }).fakeVisionDevices; state.screenPending = false; state.screenDenied = true; });
    await panel.getByRole('button', { name: '共享屏幕预览', exact: true }).click(); await expect(guest.getByRole('alert')).toContainText('设备权限已拒绝');
    await guest.getByLabel('输入您的问题', { exact: true }).fill('仍可文字交流吗'); await guest.getByRole('button', { name: '发送文字', exact: true }).click(); await expect(guest.getByLabel('本次会话消息')).toContainText('未找到'); expect(uploads).toHaveLength(0);
    await guest.getByRole('button', { name: '结束本次接待', exact: true }).click();
  } finally { await guestContext.close(); }
});
