import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
async function launch(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: /林知 · 管理员/ }).click();
  await page.getByRole('link', { name: '企业接待', exact: true }).click();
  await expect(page.getByRole('heading', { name: '企业接待', exact: true })).toBeVisible();
  await expect(page.getByText('正在加载终端…', { exact: true })).not.toBeVisible();
  if (!await page.getByRole('button', { name: '保存终端配置' }).isVisible()) await page.getByText('新增终端', { exact: true }).click();
  await page.getByRole('button', { name: '保存终端配置' }).click();
  await expect(page.getByRole('button', { name: '开始文字接待' })).toBeEnabled();
  await page.getByRole('button', { name: '开始文字接待' }).click();
  await expect(page.getByRole('heading', { name: '您好，欢迎来访', exact: true })).toBeVisible();
}
test('文字接待、停止旧回复、权限拒绝回退与人工接管可运行', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new DOMException('Test rejection', 'NotAllowedError'); } } }); });
  await launch(page);
  await page.getByRole('button', { name: '演示回复播放', exact: true }).click();
  await expect(page.getByText('正在演示回复播放状态，未合成声音')).toBeVisible();
  await page.getByRole('button', { name: '停止当前回复' }).click();
  await expect(page.getByText('此条未完成回复已停止，不会继续播放。')).toBeVisible();
  await page.getByRole('button', { name: '开启摄像头预览' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '设备权限已拒绝' })).toBeVisible();
  await page.getByLabel('输入您的问题').fill('您好，我想咨询接待流程');
  await page.getByRole('button', { name: '发送文字' }).click();
  await expect(page.getByText('您好，我想咨询接待流程', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText('您好，我想咨询接待流程', { exact: true })).toBeVisible();
  const evidence = process.env.EVIDENCE_DIR || 'docs/evidence/latest'; mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: evidence + '/guest-terminal-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '请求人工接待' }).click();
  await expect(page.getByText('自动回复已暂停', { exact: true })).toBeVisible();
  await page.getByLabel('输入您的问题').fill('请前台工作人员帮忙'); await page.getByRole('button', { name: '发送文字' }).click();
  await expect(page.getByText('请前台工作人员帮忙', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回接待台' }).click();
  await page.getByRole('button', { name: '释放人工接管' }).click();
  await expect(page.getByText('接待中', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '进入终端', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: evidence + '/guest-terminal-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '结束本次接待', exact: true }).click();
  await expect(page.getByText('本次会话已结束', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送文字' })).toBeDisabled();
});
test('取消或接管期间迟到的设备授权结果立即释放，不留下媒体轨道', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { stoppedTracks: number; resolveMedia: () => void };
    state.stoppedTracks = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise<MediaStream>(resolve => {
      const stream = new MediaStream();
      stream.getTracks = () => [{ stop: () => { state.stoppedTracks++; }, addEventListener: () => {} } as unknown as MediaStreamTrack];
      state.resolveMedia = () => resolve(stream);
    }) } });
  });
  await launch(page);
  await page.getByRole('button', { name: '开启摄像头预览' }).click();
  await page.getByRole('button', { name: '取消摄像头请求' }).click();
  await page.evaluate(() => (window as unknown as { resolveMedia: () => void }).resolveMedia());
  await expect.poll(() => page.evaluate(() => (window as unknown as { stoppedTracks: number }).stoppedTracks)).toBe(1);
  await expect(page.getByLabel('本机摄像头预览')).not.toBeVisible();
  await page.getByRole('button', { name: '检查麦克风权限' }).click();
  await page.getByRole('button', { name: '请求人工接待' }).click();
  await expect(page.getByText('自动回复已暂停', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { resolveMedia: () => void }).resolveMedia());
  await expect.poll(() => page.evaluate(() => (window as unknown as { stoppedTracks: number }).stoppedTracks)).toBe(2);
  await page.getByRole('button', { name: '结束本次接待' }).click();
});
