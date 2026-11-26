import {randomUUID} from 'node:crypto';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeRecordings} from '../packages/postgres/src/runtime-recordings.js';
import {NativeRecordingWorker} from '../packages/postgres/src/runtime-recording-worker.js';
import {recordingCreateInput,recordingUploadInput,recordingApplyInput} from '../packages/contracts/src/index.js';
const[mode,configFile,root,raw]=process.argv.slice(2),db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(configFile),mode==='finish'?'worker':'api',root),core=new NativeCoreRepository(db),s=new NativeRecordings(core),key=randomUUID();
async function pause(data:object){console.log(JSON.stringify({phase:'native_recording_'+mode+'_staged',key,...data}));await new Promise<void>(()=>{});}
try{
 if(mode==='upload'){const input=JSON.parse(raw) as {plan:unknown;upload:unknown},plan=recordingCreateInput.parse(input.plan),upload=recordingUploadInput.parse(input.upload);await db.transaction(async()=>{const p=await core.principal('30000000-0000-4000-8000-000000000001'),id=await core.idempotentResource(p,{action:'probe.recording.upload',key,body:input,code:200},async()=>{const id=await s.create(p,plan);await s.upload(p,await s.row(p,id,true),upload,key);await core.audit(p,plan.workspaceId,'probe.recording.upload',id,key);await core.event(p.tenantId,plan.workspaceId,id,'recording.changed');return id;});const r=await s.row(p,id);await pause({recordingId:id,transferId:r.transfer_id,version:r.version});});
 }else if(mode==='finish'){if(!await new NativeRecordingWorker(core,root).runOne(undefined,undefined,pause))throw Error('No actual recording reached completion staging');
 }else if(mode==='apply'){const input=JSON.parse(raw) as {recordingId:string;body:unknown},body=recordingApplyInput.parse(input.body);await db.transaction(async()=>{const p=await core.principal('30000000-0000-4000-8000-000000000001'),r=await s.row(p,input.recordingId,true),id=await core.idempotentResource(p,{action:'probe.recording.apply',key,body,code:200},async()=>{const id=await s.apply(p,r,body,key);await core.audit(p,r.workspace_id,'probe.recording.apply',id,key);await core.event(p.tenantId,r.workspace_id,id,'recording.changed');return id;});await pause({recordingId:r.id,projectId:id});});
 }else if(mode==='withdraw'){await db.transaction(async()=>{const p=await core.principal('30000000-0000-4000-8000-000000000001'),r=await s.row(p,raw,true);await core.idempotentResource(p,{action:'probe.recording.withdraw',key,body:{version:r.version},code:200},async()=>{await s.withdraw(p,r,r.version);await core.audit(p,r.workspace_id,'probe.recording.withdraw',r.id,key);await core.event(p.tenantId,r.workspace_id,r.id,'recording.changed');return r.id;});await pause({recordingId:r.id,version:(await s.row(p,r.id)).version});});
 }else throw Error('Unknown native recording probe mode');
}finally{await db.close();}
