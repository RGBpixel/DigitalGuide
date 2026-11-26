import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Repository } from '@digitalguide/database';
import { seed } from '../packages/test-fixtures/src/seed.js';
import { loadConfig } from '../apps/api/src/config.js';
if (process.env.APP_ENV === 'production') throw new Error('生产环境禁止写入演示资料。');
if (process.getBuiltinModule('node:fs').existsSync('.env')) process.loadEnvFile('.env');
if (process.env.APP_ENV === 'production') throw new Error('生产环境禁止写入演示资料。');
mkdirSync(path.resolve(process.env.DATA_DIR || 'storage'), { recursive: true });
const config = loadConfig(), repo = new Repository(config.dataDir, config.root);
try { seed(repo); console.log('本地数据库、私有会话密钥及虚构演示资料已准备。重复运行不会覆盖已有记录。'); } finally { repo.close(); }
