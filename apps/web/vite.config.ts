import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import {liveGuestHeaders} from './live-guest-headers.js';
export default defineConfig({
  root: 'apps/web', plugins: [react(),liveGuestHeaders()], resolve: { alias: { '@digitalguide/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)) } },
  server: { host: '127.0.0.1', port: Number(process.env.WEB_PORT || 5173), strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT || 4300}` } },
  build: { outDir: '../../dist/web', emptyOutDir: true }
});
