import {randomUUID} from 'node:crypto';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
const db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(process.argv[2]),'api'),repo=new NativeCoreRepository(db);
try{await db.transaction(async()=>{const p=await repo.principal('30000000-0000-4000-8000-000000000001'),body={workspaceId:'20000000-0000-4000-8000-000000000001',kind:'provider.check' as const,simulate:'success' as const},value=await repo.idempotentJob(p,{action:'POST /api/v1/jobs',key:randomUUID(),body,code:202},()=>repo.createJob(p,body,randomUUID()));console.log(JSON.stringify({phase:'native_write_staged',jobId:value.jobId}));await new Promise<void>(()=>{/* The parent validation process actually kills this uncommitted writer. */});});}finally{await db.close();}
