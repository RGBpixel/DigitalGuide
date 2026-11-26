import { loadConfig } from './config.js';
import { createApp } from './app.js';
const config = loadConfig(), app = await createApp(config);
process.on('SIGINT', () => void app.close()); process.on('SIGTERM', () => void app.close());
try { await app.listen({ port: config.apiPort, host: '127.0.0.1' }); console.log(`DigitalGuide API · http://127.0.0.1:${config.apiPort} · ${config.providerMode}`); }
catch (error) { console.error((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `端口 ${config.apiPort} 已被占用，请修改 API_PORT 后重试。` : 'API 启动失败，请先运行 pnpm setup:local 并检查配置。'); await app.close(); process.exitCode = 1; }
