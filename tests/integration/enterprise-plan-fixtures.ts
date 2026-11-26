import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {harness} from './helpers.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {createApp} from '../../apps/api/src/app.js';
import {observeRecoveryClusters} from '../../scripts/native-recovery-owned.js';
const root='docs/evidence/T35/plan-entitlements';
export interface PlanFixture{app:FastifyInstance;second:FastifyInstance;login:(id:string)=>Promise<{cookie:string;'x-csrf-token':string}>;query:(sql:string,...args:(string|number|null)[])=>Promise<Record<string,unknown>[]>;restart:()=>Promise<void>;close:()=>Promise<void>;snapshot:()=>Promise<object>}
function committed(name:string,details:object){const file='migrations/'+name,sha256=createHash('sha256').update(fs.readFileSync(file)).digest('hex'),marker=root+'/'+path.basename(name).slice(0,3)+'-first-committed.json';if(fs.existsSync(marker)){const old=JSON.parse(fs.readFileSync(marker,'utf8'));if(old.sha256!==sha256)throw new Error('Previously committed migration changed');}else fs.writeFileSync(marker,JSON.stringify({checkedAt:new Date().toISOString(),file,sha256,committed:true,...details}),{flag:'wx'});}
export async function sqlitePlanFixture():Promise<PlanFixture>{
 const h=await harness();committed('sqlite/053-enterprise-plans.sql',{dataDir:h.config.dataDir});let current=h.app,originalClosed=false;
 const fixture:PlanFixture={app:current,second:current,login:h.login,query:async(sql,...args)=>{if(originalClosed)throw new Error('Old SQLite fixture already closed');if(/^SELECT/i.test(sql))return h.repo.all<Record<string,unknown>>(sql,...args);h.repo.run(sql,...args);return[];},snapshot:async()=>({database:'sqlite',directory:h.config.dataDir}),restart:async()=>{await h.close();originalClosed=true;current=await createApp(h.config);fixture.app=current;fixture.second=current;},close:async()=>{if(originalClosed)await current.close();else await h.close();}};
 return fixture;
}
export async function nativePlanFixture():Promise<PlanFixture>{
 const x=await nativeRuntimeFixture({onInitialized:async(result,cluster)=>{committed('postgres/130-native-enterprise-plans.sql',{root:cluster.root,schema:result.schema,runtime:127});await observeRecoveryClusters(root+'/observed-native-initial-'+path.basename(cluster.root)+'.json',cluster.observedPids,cluster.port);fs.writeFileSync(root+'/native-initialized-'+path.basename(cluster.root)+'.json',JSON.stringify({root:cluster.root,port:cluster.port,schema:result.schema,runtimeId:result.runtimeId}),{flag:'wx'});}}),second=await createApp(x.config);let current=x.app;
 const fixture:PlanFixture={app:current,second,login:x.login,query:(sql,...args)=>x.owner(async client=>{let i=0;return(await client.query(sql.replace(/\?/g,()=>'$'+(++i)),args)).rows;}),snapshot:async()=>({database:'postgres',root:x.cluster.root,tables:Number((await x.owner(c=>c.query('SELECT count(*) n FROM pg_tables WHERE schemaname=$1',[x.result.schema]))).rows[0].n),keys:['.session-secret','.provenance-secret'].map(file=>createHash('sha256').update(fs.readFileSync(path.join(x.result.api.dataDir,file))).digest('hex'))}),restart:async()=>{await current.close();await second.close();await x.workerDb.close();await x.cluster.stop();await x.cluster.start();await observeRecoveryClusters(root+'/observed-native-restart-'+path.basename(x.cluster.root)+'.json',x.cluster.observedPids,x.cluster.port);current=await createApp(x.config);fixture.app=current;fixture.second=current;},close:async()=>{await current.close();await second.close();await x.close();}};
 return fixture;
}
