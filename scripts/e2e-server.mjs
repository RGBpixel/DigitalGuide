import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
process.env.API_PORT = process.env.E2E_API_PORT || '4311';
process.env.WEB_PORT = process.env.E2E_WEB_PORT || '5179';
process.env.WEB_ORIGIN = `http://127.0.0.1:${process.env.WEB_PORT}`;
process.env.DATA_DIR = 'storage/e2e-runs/' + randomUUID();
process.env.APP_ENV = 'development'; process.env.PROVIDER_MODE = 'mock';
const setup = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/setup-local.ts'], { stdio: 'inherit', env: process.env, windowsHide: true });
if (setup.status !== 0) process.exit(setup.status || 1);
if(process.env.E2E_AE_CONTRACT==='1'){
 const fixture=spawnSync(process.execPath,['--import','tsx','scripts/setup-ae-contract.ts',process.env.DATA_DIR],{env:process.env,windowsHide:true,encoding:'utf8'});
 if(fixture.status!==0){process.stderr.write('Isolated AE contract fixture setup failed.\n');process.exit(1);}
 process.env.AE_RUNTIME_CONFIG=fixture.stdout.trim();
}
if(process.env.E2E_AE_SOURCE==='1'){
 const fixture=spawnSync(process.execPath,['--import','tsx','scripts/setup-ae-source.ts',process.env.DATA_DIR,...(process.env.AE_RUNTIME_CONFIG?[process.env.AE_RUNTIME_CONFIG]:[])],{env:process.env,windowsHide:true,encoding:'utf8'});
 if(fixture.status!==0){process.stderr.write('Isolated AE source fixture setup failed.\n');process.exit(1);}
 process.env.AE_RUNTIME_CONFIG=fixture.stdout.trim();
}
await import('./dev.mjs');
