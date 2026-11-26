import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ resolve: { alias: Object.fromEntries(['contracts', 'domain', 'database', 'media', 'providers'].map(name => ['@digitalguide/' + name, path.resolve('packages/' + name + '/src/index.ts')])) }, test: { include:['tests/unit/**/*.test.ts','tests/integration/**/*.test.ts'], environment: 'node', fileParallelism: false, testTimeout: 15000, hookTimeout:60000 } });
