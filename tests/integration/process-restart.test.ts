import { it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import net from 'node:net';
import { mkdirSync } from 'node:fs';
import { Repository } from '@digitalguide/database';
import { fixtureIds as f, seed } from '../../packages/test-fixtures/src/seed.js';

it('真实 API/worker 进程退出重启后保留会话与 20 项任务，恢复执行不重复用量', async () => {
  const dataDir = path.resolve('storage/process-tests/' + randomUUID()), repo = new Repository(dataDir); seed(repo);
  const port = await new Promise<number>(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const value = (server.address() as net.AddressInfo).port; server.close(() => resolve(value)); }); });
  const env = { ...process.env, DATA_DIR: dataDir, API_PORT: String(port), APP_ENV: 'development', PROVIDER_MODE: 'mock', SESSION_SECRET: randomBytes(48).toString('hex') };
  const children: ChildProcess[] = [];
  const start = (file: string) => { const child = spawn(process.execPath, ['--import', 'tsx', file], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child); return child; };
  const stop = async (child: ChildProcess) => { if (child.exitCode === null && child.signalCode === null) { const done = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await done; } };
  const base = `http://127.0.0.1:${port}/api/v1`;
  async function ready() { for (let i = 0; i < 70; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch { /* startup */ } await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('API startup timeout'); }
  try {
    let server = start('apps/api/src/main.ts'); await ready();
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: f.adminA }) });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const me = await (await fetch(base + '/me', { headers: { cookie } })).json();
    for (let i = 0; i < 20; i++) {
      const response = await fetch(base + '/jobs', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': me.data.csrfToken, 'Idempotency-Key': 'recovery-' + i }, body: JSON.stringify({ workspaceId: f.workspaceA, kind: 'provider.check' }) }); expect(response.status).toBe(202);
    }
    await stop(server); server = start('apps/api/src/main.ts'); await ready();
    expect((await fetch(base + '/me', { headers: { cookie } })).status).toBe(200);
    const queue = await (await fetch(base + '/jobs', { headers: { cookie } })).json(); expect(queue.data.items).toHaveLength(20);
    const worker = start('apps/worker/src/main.ts');
    for (let i = 0; i < 100; i++) { const count = repo.get<{ n: number }>("SELECT count(*) AS n FROM jobs WHERE status='succeeded'")!.n; if (count > 0) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    await stop(worker);
    repo.run("UPDATE jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE status='running'");
    const restartedWorker = start('apps/worker/src/main.ts');
    for (let i = 0; i < 230; i++) { if (repo.get<{ n: number }>("SELECT count(*) AS n FROM jobs WHERE status='succeeded'")!.n === 20) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    await stop(restartedWorker);
    expect(repo.get<{ n: number }>("SELECT count(*) AS n FROM jobs WHERE status='succeeded'")!.n).toBe(20);
    expect(repo.get<{ n: number }>('SELECT count(*) AS n FROM provider_usage')!.n).toBe(20);
    expect(repo.get<{ n: number }>('SELECT count(DISTINCT job_id) AS n FROM provider_usage')!.n).toBe(20);
    await stop(server);
  } finally { for (const child of children) await stop(child); repo.close(); }
}, 45000);

it('仓库启动等待另一进程持有的短暂排他锁，不在设置超时前退出', async () => {
  const dataDir=path.resolve('storage/process-tests/startup-lock-'+randomUUID());mkdirSync(dataDir,{recursive:true});
  const helper=spawn(process.execPath,['--input-type=module','-e',"import { DatabaseSync } from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('CREATE TABLE startup_lock_probe (id INTEGER); BEGIN EXCLUSIVE; INSERT INTO startup_lock_probe VALUES (1)');process.stdout.write('LOCKED\\n');setTimeout(()=>{db.exec('COMMIT');db.close();},1200);",path.join(dataDir,'digitalguide.sqlite')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const done=new Promise<void>((resolve,reject)=>{helper.once('error',reject);helper.once('close',code=>code===0?resolve():reject(new Error('Lock helper failed: '+code)));});let repository:Repository|undefined;
  try{await new Promise<void>((resolve,reject)=>{helper.stdout!.once('data',data=>String(data).includes('LOCKED')?resolve():reject(new Error('Missing lock receipt')));helper.once('error',reject);helper.once('exit',code=>{if(code)reject(new Error('Lock helper startup failed'));});});
    repository=new Repository(dataDir);expect(repository.get<{id:number}>('SELECT id FROM startup_lock_probe')!.id).toBe(1);expect(repository.get('SELECT name FROM schema_migrations WHERE name=?','029-transcriptions.sql')).toBeTruthy();
  }finally{repository?.close();await done;}
},10000);
