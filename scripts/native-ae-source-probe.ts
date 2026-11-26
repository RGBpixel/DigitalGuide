import {randomUUID} from 'node:crypto';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeAeTemplates} from '../packages/postgres/src/runtime-ae-templates.js';
import {NativeAeSources} from '../packages/postgres/src/runtime-ae-source.js';
import {NativeAeSourceWorker} from '../packages/postgres/src/runtime-ae-source-worker.js';
const mode=process.argv[2],config=loadNativeRuntimeConfig(process.argv[3]),host={aeConfigFile:process.argv[4],appEnv:config.appEnv,providerMode:'mock' as const},payload=JSON.parse(process.argv[5]),db=await NativePostgresDatabase.open(config,mode==='complete'?'worker':'api'),repo=new NativeCoreRepository(db),templates=new NativeAeTemplates(repo,host),sources=new NativeAeSources(repo,host),key=randomUUID();
async function stage(value:object){console.log(JSON.stringify({phase:'native_ae_source_'+mode+'_staged',key,...value}));await new Promise<void>(()=>{});}
try{
 if(mode==='complete')await new NativeAeSourceWorker(repo,host).runOne(undefined,undefined,stage);
 else await db.transaction(async()=>{const p=await repo.principal('30000000-0000-4000-8000-000000000001'),workspace='20000000-0000-4000-8000-000000000001';let id:string;
  if(mode==='register')id=await repo.idempotentResource(p,{action:'proof.ae.register',key,body:payload,code:200},async()=>templates.register(p,workspace,await templates.entry(p,workspace,payload.catalogId,payload.catalogRevision)));
  else if(mode==='queue')id=await repo.idempotentResource(p,{action:'proof.ae.queue',key,body:payload,code:200},async()=>sources.create(p,await sources.prepare(p,payload)));
  else if(mode==='withdraw')id=await repo.idempotentResource(p,{action:'proof.ae.withdraw',key,body:payload,code:200},async()=>{const r=await sources.row(p,payload.id,true);return sources.control(p,r,r.control_version,'withdraw');});
  else throw new Error('Unknown AE source probe mode');
  await repo.audit(p,workspace,'proof.ae.'+mode,id,key);await repo.event(p.tenantId,workspace,id,'proof.ae.'+mode);await stage({id});
 });
}finally{await db.close();}
