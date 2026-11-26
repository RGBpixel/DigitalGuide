import { loadConfig } from '../apps/api/src/config.js';
import { Repository } from '../packages/database/src/index.js';
import { NativePostgresDatabase } from '../packages/postgres/src/runtime-database.js';
import { assertRecoveryWorkerDisabled } from '../packages/recovery/src/guard.js';
import { WebhookRuntime } from '../packages/enterprise/src/webhook-runtime.js';
import { WebhookQueue } from '../packages/enterprise/src/webhook-queue.js';
import { SqliteWebhookStore, NativeWebhookStore } from '../packages/enterprise/src/webhook-worker-store.js';
import { dispatchWebhook } from '../packages/enterprise/src/webhook-dispatcher.js';
const args = process.argv.slice(2);
const help = 'DigitalGuide Webhook dispatcher\n使用当前独立DATA_DIR、数据库配置及DEVELOPER_WEBHOOKS_CONFIG_FILE。--once处理一个可用回调，--watch持续轮询；默认不发送真实HTTPS回调。真实接收端另需已有业务授权并显式传入--confirm-external-delivery。此进程不执行媒体、支付、发布或其他任务。';
if (args.includes('--help')) console.log(help);
else {
  let db: NativePostgresDatabase | undefined, repo: Repository | undefined;
  try {
    if (new Set(args).size !== args.length || args.some(a => !['--once', '--watch', '--confirm-external-delivery'].includes(a)) || args.includes('--once') && args.includes('--watch')) throw new Error('WEBHOOK_ARGUMENT_INVALID');
    const config = loadConfig(); assertRecoveryWorkerDisabled(config.dataDir);
    if (args.includes('--confirm-external-delivery') && config.providerMode === 'mock') throw new Error('WEBHOOK_EXTERNAL_NOT_AUTHORIZED');
    if (config.nativePostgres) db = await NativePostgresDatabase.open(config.nativePostgres, 'worker', config.root); else repo = new Repository(config.dataDir, config.root, { environment: config.providerMode, appEnv: config.appEnv });
    const runtime = new WebhookRuntime(config), queue = new WebhookQueue(config, !!db), store = db ? new NativeWebhookStore(db) : new SqliteWebhookStore(repo!);
    const controller = new AbortController(); let stop = false;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stop = true; controller.abort(); });
    do { const result = await dispatchWebhook(store, queue, runtime, { allowExternal: args.includes('--confirm-external-delivery'), signal: controller.signal, onClaim: lease => { console.log(JSON.stringify({ result: 'claimed', deliveryId: lease.id, attempt: lease.attempt })); } }); if (result.result !== 'idle' || !args.includes('--watch')) console.log(JSON.stringify(result)); if (!args.includes('--watch') || stop) break; await new Promise(resolve => setTimeout(resolve, 500)); } while (!stop);
  } catch (error) { const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'WEBHOOK_DISPATCH_FAILED'; console.error(JSON.stringify({ error: { code, message: '回调派发未完成，请核对独立数据库、接收端私有配置与运行模式；不会回退模拟成功。' } })); process.exitCode = 1; }
  finally { await db?.close(); repo?.close(); }
}
