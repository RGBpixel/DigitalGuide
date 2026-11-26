import fs from 'node:fs';
import path from 'node:path';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {AeTemplate,AeSourcePlan,AeSourceJob} from '@digitalguide/contracts';
import {aeSourceFixture} from '../../packages/test-fixtures/src/ae-source.js';
import {NativeAeSourceWorker} from '../../packages/postgres/src/runtime-ae-source-worker.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeLibraryHelpers} from './postgres-library-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
describe.skipIf(!nativePostgresAvailable)('R-058/R-081 AE源包重试与活动额度',()=>{
 let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>;
 beforeAll(async()=>{x=await nativeRuntimeFixture();},120000);
 afterAll(async()=>{await x?.close();},45000);
 it('实际失败恢复后重试不能绕过组织三项活动额度，取消一项后重试同一任务',async()=>{const h=nativeLibraryHelpers(x),p=await h.person(),dir=path.join(x.config.dataDir,'quota-'+randomUUID());fs.mkdirSync(dir);const a=aeSourceFixture(dir);a.runtime.catalog[0].tenantId=p.tenant;a.runtime.catalog[0].workspaceId=p.workspace;fs.writeFileSync(a.configFile,JSON.stringify(a.runtime));x.config.aeConfigFile=a.configFile;const base='/studio/ae-source-exports',t=await h.good<AeTemplate>(p,'/studio/ae-templates',{workspaceId:p.workspace,catalogId:a.manifest.catalogId,catalogRevision:1,confirmed:true,rightsConfirmed:true});
  async function queue(name:string){const input={workspaceId:p.workspace,templateId:t.id,templateVersion:t.version,name},plan=await h.good<AeSourcePlan>(p,base+'/plan',input);return h.good<AeSourceJob>(p,base,{...input,planHash:plan.hash,expectedMode:plan.mode,confirmed:true,rightsConfirmed:true});}
  const first=await queue('实际失败后待重试'),originalFile=path.join(a.folder,'project.aep'),original=fs.readFileSync(originalFile);fs.writeFileSync(originalFile,'changed original');await new NativeAeSourceWorker(x.repo,x.config).runOne();const failed=await h.get<AeSourceJob>(p,base+'/'+first.id);expect(failed).toMatchObject({status:'failed',attempts:1});fs.writeFileSync(originalFile,original);const queued=[];for(let n=0;n<3;n++)queued.push(await queue('占用额度-'+n));const alternate={...p,headers:await x.login(p.user)},body={controlVersion:failed.controlVersion,confirmed:true,rightsConfirmed:true},blocked=await h.post(alternate,base+'/'+failed.id+'/retry',body);expect(blocked.statusCode,blocked.payload).toBe(409);expect(blocked.json().error.code).toBe('AE_SOURCE_QUEUE_LIMIT');expect((await h.get<AeSourceJob>(p,base+'/'+failed.id)).status).toBe('failed');await h.good(p,base+'/'+queued[0].id+'/cancel',{controlVersion:queued[0].controlVersion,confirmed:true});const retried=await h.good<AeSourceJob>(p,base+'/'+failed.id+'/retry',body);expect(retried).toMatchObject({id:failed.id,status:'queued',attempts:1});expect(await x.owner(async c=>Number((await c.query("SELECT count(*) AS n FROM ae_source_exports WHERE tenant_id=$1 AND status IN('queued','processing')",[p.tenant])).rows[0].n))).toBe(3);
 },45000);
});
