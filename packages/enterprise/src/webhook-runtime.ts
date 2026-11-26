import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { AppError, canonical } from '../../domain/src/index.js';
import { assertNoLinks } from '../../recovery/src/files.js';
const id = z.uuid();
const destinationSchema = z.strictObject({ id, tenantId: id, workspaceId: id, name: z.string().trim().min(1).max(80), mode: z.enum(['local_test', 'https']), url: z.string().max(2048), secretFile: z.string().min(1) });
const registrySchema = z.strictObject({ version: z.literal(1), environment: z.enum(['mock', 'sandbox', 'live']), appEnv: z.enum(['development', 'sandbox', 'production']), destinations: z.array(destinationSchema).max(20) });
export interface WebhookHost { dataDir: string; providerMode: 'mock' | 'sandbox' | 'live'; appEnv: 'development' | 'sandbox' | 'production'; sessionSecret: string; developerWebhooksFile?: string; recoveryValidationOnly?: true }
export interface WebhookDestination extends z.infer<typeof destinationSchema> { secret: string; fingerprint: string; configurationToken: string }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class WebhookRuntime {
  constructor(readonly host: WebhookHost) {}
  private outside(file: string) { const relative = path.relative(path.resolve(this.host.dataDir), file); if (!path.isAbsolute(file) || !relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) throw new AppError('WEBHOOK_CONFIG_INVALID', '回调私有配置和签名密钥必须在DATA_DIR之外。', 503); }
  private definitions() {
    if (this.host.recoveryValidationOnly) throw new AppError('WEBHOOK_CONFIG_INVALID', '恢复隔离副本不能启用回调。', 503);
    const file = this.host.developerWebhooksFile;
    if (!file) throw new AppError('WEBHOOK_CONFIG_REQUIRED', '请由部署管理员配置私有接收端注册表和签名密钥。', 503);
    try {
      this.outside(file); assertNoLinks(file); if (fs.statSync(file).size > 65536) throw new Error();
      const parsed = registrySchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (parsed.environment !== this.host.providerMode || parsed.appEnv !== this.host.appEnv || new Set(parsed.destinations.map(d => d.id)).size !== parsed.destinations.length) throw new Error();
      for (const d of parsed.destinations) { this.outside(d.secretFile); const url = new URL(d.url); if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error(); if (d.mode === 'local_test' && (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || this.host.providerMode !== 'mock' || this.host.appEnv === 'production')) throw new Error(); if (d.mode === 'https' && url.protocol !== 'https:') throw new Error(); }
      return parsed.destinations;
    } catch { throw new AppError('WEBHOOK_CONFIG_INVALID', '回调私有配置的格式、环境或接收地址无效，请由部署管理员核对。', 503); }
  }
  current(id: string): WebhookDestination {
    const destination = this.definitions().find(d => d.id === id); if (!destination) throw new AppError('WEBHOOK_DESTINATION_UNAVAILABLE', '接收端未配置或已移除，请重新核对。', 409);
    let secret: string;
    try { assertNoLinks(destination.secretFile); if (fs.statSync(destination.secretFile).size > 512) throw new Error(); secret = fs.readFileSync(destination.secretFile, 'utf8').trim(); if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret)) throw new Error(); } catch { throw new AppError('WEBHOOK_SECRET_UNAVAILABLE', '回调签名密钥不可读取或格式无效，请由部署管理员核对私有文件。', 503); }
    const fingerprint = digest(canonical({ ...destination, secretFile: '', keySHA256: digest(secret), environment: this.host.providerMode, appEnv: this.host.appEnv }));
    const configurationToken = createHmac('sha256', this.host.sessionSecret).update(canonical(['developer-webhook-review-v1', destination.tenantId, destination.workspaceId, destination.id, fingerprint])).digest('hex');
    return { ...destination, secret, fingerprint, configurationToken };
  }
  catalog(tenantId: string, workspaceId: string) {
    try { const entries = this.definitions().filter(d => d.tenantId === tenantId && d.workspaceId === workspaceId).map(d => this.current(d.id)); return { entries, issue: null }; }
    catch (error) { return { entries: [], issue: error instanceof AppError ? error.message : '回调配置暂不可用，请联系部署管理员。' }; }
  }
}
