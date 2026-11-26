import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
if (existsSync('.env')) process.loadEnvFile('.env');
const ports = [Number(process.env.API_PORT || 4300), Number(process.env.WEB_PORT || 5173)];
try {
  for (const port of ports) await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', () => reject(new Error(`端口 ${port} 已被占用，请修改 API_PORT / WEB_PORT 后重试。`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
} catch (error) { console.error(error.message); process.exit(1); }
await import('./build-course-player.mjs');
await import('./build-share-player.mjs');
const commands = [['--import', 'tsx', 'apps/api/src/main.ts'], ['--import', 'tsx', 'apps/worker/src/main.ts'], ['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts']];
const children = commands.map(args => spawn(process.execPath, args, { stdio: 'inherit', env: process.env, windowsHide: true }));
let stopped = false;
function stop(code = 0) { if (stopped) return; stopped = true; for (const child of children) if (!child.killed) child.kill('SIGTERM'); process.exitCode = code; }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
for (const child of children) { child.on('error', () => stop(1)); child.on('exit', code => { if (!stopped) stop(code || 0); }); }
