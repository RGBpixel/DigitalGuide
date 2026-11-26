import {randomUUID} from 'node:crypto';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeMediaProcessing} from '../packages/postgres/src/runtime-processing.js';
import {NativeProcessingWorker} from '../packages/postgres/src/runtime-processing-worker.js';
import {mediaProcessingCreateInput,mediaProcessingApplyInput} from '../packages/contracts/src/index.js';
const[mode,configFile,root,raw]=process.argv.slice(2),db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(configFile),mode==='finish'?'worker':'api',root),core=new NativeCoreRepository(db),s=new NativeMediaProcessing(core,root),key=randomUUID();
async function pause(data:object){console.log(JSON.stringify({phase:'native_processing_'+mode+'_staged',key,...data}));await new Promise<void>(()=>{});}
try{
 if(mode==='queue'){const input=mediaProcessingCreateInput.parse(JSON.parse(raw));await db.transaction(async()=>{const p=await core.principal('30000000-0000-4000-8000-000000000001');let planId='';const jobId=await core.idempotentResource(p,{action:'probe.processing.queue',key,body:input,code:200},async()=>{planId=await s.create(p,input);const plan=await s.planRow(p,planId,true),id=await s.run(p,plan,plan.version,plan.plan_hash);await core.audit(p,plan.workspace_id,'probe.processing.queue',id,key);await core.event(p.tenantId,plan.workspace_id,id,'media.processing.changed');return id;});await pause({planId,jobId});});
 }else if(mode==='finish'){if(!await new NativeProcessingWorker(core,root).runOne(undefined,undefined,pause))throw Error('No native media job reached staged completion');
 }else if(mode==='apply'){const input=JSON.parse(raw) as {jobId:string;body:unknown};await db.transaction(async()=>{const p=await core.principal('30000000-0000-4000-8000-000000000001'),job=await s.jobRow(p,input.jobId,true),body=mediaProcessingApplyInput.parse(input.body);const applicationId=await core.idempotentResource(p,{action:'probe.processing.apply',key,body,code:200},async()=>{const id=await s.apply(p,job,body,key);await core.audit(p,job.workspace_id,'probe.processing.apply',id,key);await core.event(p.tenantId,job.workspace_id,id,'media.processing.changed');return id;});const app=await s.application(p,job,applicationId);await pause({jobId:job.id,applicationId,projectId:app.project_id});});
 }else if(mode==='withdraw'){await db.transaction(async()=>{const p=await core.principal('30000000-0000-4000-8000-000000000001'),plan=await s.planRow(p,raw,true);await core.idempotentResource(p,{action:'probe.processing.withdraw',key,body:{version:plan.version},code:200},async()=>{await s.withdraw(p,plan,plan.version);await core.audit(p,plan.workspace_id,'probe.processing.withdraw',plan.id,key);await core.event(p.tenantId,plan.workspace_id,plan.id,'media.processing.changed');return plan.id;});await pause({planId:plan.id,planVersion:(await s.planRow(p,plan.id)).version});});
 }else throw Error('Unknown native media probe mode');
}finally{await db.close();}
