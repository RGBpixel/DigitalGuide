import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { Repository } from '../../packages/database/src/index.js';
import { seed } from '../../packages/test-fixtures/src/seed.js';
import { createApp } from '../../apps/api/src/app.js';
import type { Config } from '../../apps/api/src/config.js';
import { runStudioExport } from '../../apps/worker/src/studio-exports.js';
import { NativeMediaWorker } from '../../packages/postgres/src/runtime-media-worker.js';
import { NativePostgresDatabase } from '../../packages/postgres/src/runtime-database.js';
import { NativeCoreRepository } from '../../packages/postgres/src/runtime-repository.js';
import { createPostgresClient } from '../../packages/postgres/src/config.js';
import { observeRecoveryClusters } from '../../scripts/native-recovery-owned.js';
import { nativeRuntimeFixture } from './postgres-runtime-helpers.js';

const evidence='docs/evidence/T35/developer-studio';
export type StudioAppHeaders={cookie:string;'x-csrf-token':string};
export interface StudioAppFixture {
  app:FastifyInstance;root:string;config:Config;
  query:(sql:string,...args:SQLInputValue[])=>Promise<Record<string,unknown>[]>;
  login:(id:string)=>Promise<StudioAppHeaders>;
  render:()=>Promise<unknown>;restart:()=>Promise<void>;close:()=>Promise<void>;
  roleQuery?:(role:'api'|'worker',sql:string,args?:unknown[])=>Promise<unknown>;
}
function committed(file:string,details:object){const sha256=createHash('sha256').update(fs.readFileSync(file)).digest('hex'),marker=evidence+'/'+path.basename(file).slice(0,3)+'-first-committed.json';if(fs.existsSync(marker)){if(JSON.parse(fs.readFileSync(marker,'utf8')).sha256!==sha256)throw new Error('Committed studio migration changed');}else fs.writeFileSync(marker,JSON.stringify({checkedAt:new Date().toISOString(),file,sha256,...details},null,2)+'\n',{flag:'wx'});}
async function login(app:FastifyInstance,id:string){const response=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{accountId:id}});if(response.statusCode!==200)throw new Error('Synthetic studio fixture login failed');const cookie=response.headers['set-cookie']!.toString().split(';')[0],me=await app.inject({url:'/api/v1/me',headers:{cookie}});if(me.statusCode!==200)throw new Error('Synthetic studio fixture identity failed');return{cookie,'x-csrf-token':me.json().data.csrfToken as string};}
export async function sqliteStudioAppFixture():Promise<StudioAppFixture>{
  const root=path.resolve('storage/test-runs/studio-app-'+randomUUID()),config:Config={root:process.cwd(),dataDir:root,providerMode:'mock',appEnv:'development',apiPort:4308,webOrigin:'http://127.0.0.1:5178',sessionSecret:randomBytes(48).toString('hex')};
  let repo=new Repository(root,config.root,{environment:'mock',appEnv:'development'});committed('migrations/sqlite/062-developer-studio.sql',{root});fs.writeFileSync(evidence+'/sqlite-'+path.basename(root)+'.json',JSON.stringify({root,migration:'062-developer-studio.sql'}),{flag:'wx'});seed(repo);fs.writeFileSync(path.join(root,'studio-fixture-config.private.json'),JSON.stringify({config}),{mode:0o600});
  const query=async(sql:string,...args:SQLInputValue[])=>{if(/^SELECT\b/i.test(sql))return repo.all<Record<string,unknown>>(sql,...args);repo.run(sql,...args);return[];};
  const x:StudioAppFixture={app:await createApp(config,repo),root,config,query,login:id=>login(x.app,id),render:()=>runStudioExport(repo,config),restart:async()=>{await x.app.close();repo.close();repo=new Repository(root,config.root,{environment:'mock',appEnv:'development'});x.app=await createApp(config,repo);},close:async()=>{try{await x.app.close();}finally{repo.close();}}};return x;
}
export async function nativeStudioAppFixture():Promise<StudioAppFixture>{
  const h=await nativeRuntimeFixture({onInitialized:async(result,cluster)=>{committed('migrations/postgres/141-native-developer-studio.sql',{root:cluster.root,schema:result.schema,runtime:138});await observeRecoveryClusters(evidence+'/observed-studio-native-'+path.basename(cluster.root)+'.json',cluster.observedPids,cluster.port);fs.writeFileSync(evidence+'/native-'+path.basename(cluster.root)+'.json',JSON.stringify({root:cluster.root,port:cluster.port,schema:result.schema}),{flag:'wx'});}});
  let worker=h.workerDb,repo=h.repo;fs.writeFileSync(path.join(h.cluster.root,'studio-fixture-config.private.json'),JSON.stringify({config:h.config,worker:h.result.worker}),{mode:0o600});
  const roleQuery=async(role:'api'|'worker',sql:string,args:unknown[]=[])=>{const db=createPostgresClient(h.result[role].connection);await db.connect();try{await db.query('SET search_path TO "'+h.result.schema+'",pg_catalog,pg_temp');return(await db.query(sql,args)).rows;}finally{await db.end();}};
  const x:StudioAppFixture={app:h.app,root:h.cluster.root,config:h.config,query:(sql,...args)=>h.owner(async db=>{let i=0;return(await db.query(sql.replace(/\?/g,()=>'$'+(++i)),args)).rows;}),roleQuery,login:id=>login(x.app,id),render:()=>new NativeMediaWorker(repo,process.cwd()).runOne(),restart:async()=>{await x.app.close();await worker.close();worker=await NativePostgresDatabase.open(h.result.worker,'worker');repo=new NativeCoreRepository(worker);x.app=await createApp(h.config);},close:async()=>{try{await x.app.close();await worker.close();}finally{await h.close();}}};return x;
}
