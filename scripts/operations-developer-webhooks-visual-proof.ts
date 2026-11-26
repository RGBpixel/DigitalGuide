import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { webhookViewSchema, webhookDeliveryPageSchema } from '../packages/contracts/src/developer-webhooks.js';
import { NativeContentProofRuntime, proofHash } from './postgres-content-proof-runtime.js';
import { MemoryProof } from './native-guest-memory-proof-helpers.js';
const base = 'docs/evidence/T35/developer-webhooks', previous = JSON.parse(fs.readFileSync(base + '/webhook-compiled/proof.json', 'utf8')); assert.equal(previous.result, 'PASS');
const state = JSON.parse(fs.readFileSync(path.join(previous.root, 'webhook-proof-state.private.json'), 'utf8')) as {subId: string;intents: Record<string, {data?: {view: unknown}}>};
const metadata = webhookViewSchema.parse(state.intents['gui-enable'].data!.view), receiver = JSON.parse(fs.readFileSync(base + '/webhook-compiled/receiver-observations.json', 'utf8')) as {requests: {deliveryId: string;eventId: string;receivedAt: string}[]}, observed = receiver.requests[0];
const deliveries = webhookDeliveryPageSchema.parse({items: [{id: observed.deliveryId, subscriptionId: state.subId, eventId: observed.eventId, type: 'webhook.test', sequence: 1, status: 'delivered', attempts: 1, maxAttempts: 5, availableAt: observed.receivedAt, code: 'HTTP_ACCEPTED', httpStatus: 204, createdAt: observed.receivedAt, updatedAt: observed.receivedAt, canRetry: false, recentAttempts: [{attempt: 1, outcome: 'accepted', code: 'HTTP_ACCEPTED', httpStatus: 204, startedAt: observed.receivedAt, finishedAt: observed.receivedAt, scopeWithdrawn: false}]}], nextCursor: null});
const c = await NativeContentProofRuntime.create(base + '/webhook-visual-compiled'), h = new MemoryProof(c); let finishing = false, mutationRequests = 0;
try {
  await c.prepare({contentModels: false}); await h.web(); const context = await h.context(c.cookie);
  await context.route('**/api/v1/enterprise/webhooks**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { mutationRequests++; await route.abort(); return; }
    const data = pathname.endsWith('/deliveries') ? deliveries : metadata;
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({data, requestId: 'synthetic-readonly-visual-check'})});
  });
  const page = await h.page(context); await page.goto(h.origin + '/enterprise/webhooks'); await expect(page.locator('[data-webhook-subscription-id="' + state.subId + '"]')).toBeVisible(); await expect(page.getByRole('button', {name: '创建订阅', exact: true})).toBeEnabled(); await h.shot(page, 'webhooks-desktop-current'); h.gui.push('current_desktop_readonly_synthetic_metadata_layout');
  await page.setViewportSize({width: 390, height: 844}); const refresh = page.getByRole('button', {name: '刷新状态', exact: true}); await expect(refresh).toBeVisible(); assert.equal(await refresh.evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap'); assert.ok((await refresh.boundingBox())!.height < 48); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path: path.join(c.out, 'webhooks-mobile-current.png'), fullPage: false, animations: 'disabled'}); await page.getByRole('button', {name: '发送测试', exact: true}).click(); const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', {name: '确认排队测试', exact: true})).toBeDisabled(); const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844); await page.screenshot({path: path.join(c.out, 'webhook-dialog-current.png'), fullPage: false, animations: 'disabled'}); await dialog.getByRole('button', {name: '取消', exact: true}).click(); h.gui.push('current_390px_buttons_and_unchecked_dialog_within_viewport');
  const oldManifest = JSON.parse(fs.readFileSync(base + '/webhook-compiled/compiled-after.json', 'utf8')) as {files: {file: string;sha256: string}[]}, server = oldManifest.files.filter(file => /^dist\/[^/]+$/.test(file.file)); assert.equal(server.length, 28); for (const item of server) assert.equal(proofHash(path.join(c.compiledRoot, item.file)), item.sha256);
  const walk = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]), files = walk(path.join(c.compiledRoot, 'dist')).map(file => ({file: path.relative(c.compiledRoot, file).replaceAll('\\', '/'), sha256: proofHash(file)}));
  c.save('compiled-before.json', {files, count: files.length}); c.save('compiled-after.json', {files, count: files.length}); assert.equal(mutationRequests, 0); assert.deepEqual(h.errors, []);
  c.save('gui.json', {result: 'PASS', checks: h.gui, fixture: 'synthetic_readonly_display_of_prior_verified_metadata', priorSuccessfulRootReopened: false, businessMutationRequests: mutationRequests, serverBundlesIdentical: server.length, deviceProbes: await h.devices(), browserErrors: h.errors});
  await h.close(); finishing = true; await c.finish();
} catch (error) { await h.close(); if (!finishing) { finishing = true; await c.finish(error); } throw error; }
