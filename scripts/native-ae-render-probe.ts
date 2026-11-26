import {randomUUID} from 'node:crypto';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeAeRenders} from '../packages/postgres/src/runtime-ae-render.js';
import {NativeAeMedia} from '../packages/postgres/src/runtime-ae-media.js';
import {NativeAeRenderWorker} from '../packages/postgres/src/runtime-ae-render-worker.js';
import {NativeAeMediaWorker} from '../packages/postgres/src/runtime-ae-media-worker.js';
const mode=process.argv[2],config=loadNativeRuntimeConfig(process.argv[3]),host={aeConfigFile:process.argv[4],appEnv:config.appEnv,providerMode:'mock' as const},payload=JSON.parse(process.argv[5]),worker=mode.endsWith('complete'),db=await NativePostgresDatabase.open(config,worker?'worker':'api'),repo=new NativeCoreRepository(db),renders=new NativeAeRenders(repo,host),media=new NativeAeMedia(repo,host),key=randomUUID();
async function stage(value:object){console.log(JSON.stringify({phase:'native_ae_'+mode+'_staged',key,...value}));await new Promise<void>(()=>{});}
try{
 if(mode==='render-complete')await new NativeAeRenderWorker(repo,host).runOne(undefined,undefined,stage);
 else if(mode==='media-complete')await new NativeAeMediaWorker(repo,host).runOne(undefined,undefined,stage);
 else await db.transaction(async()=>{const p=await repo.principal('30000000-0000-4000-8000-000000000001'),workspace='20000000-0000-4000-8000-000000000001';let id:string;
  if(mode==='render-queue')id=await repo.idempotentResource(p,{action:'proof.ae.render.queue',key,body:payload,code:200},async()=>renders.create(p,await renders.plan(p,payload)));
  else if(mode==='media-queue')id=await repo.idempotentResource(p,{action:'proof.ae.media.queue',key,body:payload,code:200},async()=>media.create(p,await media.prepare(p,payload.artifactId,payload.input)));
  else if(mode==='media-withdraw')id=await repo.idempotentResource(p,{action:'proof.ae.media.withdraw',key,body:payload,code:200},async()=>{const r=await media.row(p,payload.id,true);return media.control(p,r,r.control_version,'withdraw');});
  else throw new Error('Unknown native AE probe mode');
  await repo.audit(p,workspace,'proof.ae.'+mode,id,key);await repo.event(p.tenantId,workspace,id,'proof.ae.'+mode);await stage({id});
 });
}finally{await db.close();}
