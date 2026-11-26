import type { RuntimeAdapters } from '@digitalguide/providers';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Repository } from '@digitalguide/database';
import { createApp } from '../../apps/api/src/app.js';
import type { Config } from '../../apps/api/src/config.js';
import { seed, fixtureIds } from '../../packages/test-fixtures/src/seed.js';
export async function harness(options: Partial<Config> = {}, adapters: RuntimeAdapters = {}) {
  const config: Config = { root: process.cwd(), dataDir: path.resolve('storage/test-runs/' + randomUUID()), appEnv: 'development', providerMode: 'mock', apiPort: 4300, webOrigin: 'http://127.0.0.1:5173', sessionSecret: randomBytes(48).toString('hex'), ...options };
  const repo = new Repository(config.dataDir, config.root,{environment:config.providerMode,appEnv:config.appEnv}); seed(repo);
  const app = await createApp(config, repo, adapters);
  async function login(accountId: string = fixtureIds.adminA) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { accountId } });
    if (response.statusCode !== 200) throw new Error(response.body);
    const cookie = response.headers['set-cookie']!.toString().split(';')[0];
    const me = await app.inject({ url: '/api/v1/me', headers: { cookie } });
    const csrf = me.json().data.csrfToken as string;
    return { cookie, 'x-csrf-token': csrf };
  }
  const headers = await login();
  return { config, repo, app, login, headers, async close() { await app.close(); repo.close(); } };
}
