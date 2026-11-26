import {randomUUID} from 'node:crypto';
import {syntheticPng} from '../packages/media/src/index.js';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';

const db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(process.argv[2]),'api'),repo=new NativeCoreRepository(db);
try{
 await db.transaction(async()=>{
  const p=await repo.principal('30000000-0000-4000-8000-000000000001'),workspaceId='20000000-0000-4000-8000-000000000001';
  const uploadId=await repo.assets.upload(p,{workspaceId,contentBase64:syntheticPng().toString('base64')},randomUUID());
  const assetId=await repo.assets.create(p,{uploadId,name:'未提交的原创合成参考',category:'avatar',expiresAt:null},randomUUID());
  const consentId=await repo.assets.grant(p,assetId,{purpose:'train_avatar',subject:'虚构授权人',proof:'开发故障验证用虚构授权凭据',noticeVersion:'local-v1',expiresAt:new Date(Date.now()+3600_000).toISOString()},randomUUID());
  const profileId=await repo.assets.createProfile(p,{workspaceId,name:'未提交的虚构角色',avatarAssetId:assetId,scenes:['video']},randomUUID());
  const body={workspaceId,kind:'training.avatar' as const,assetId,consentId,simulate:'success' as const},made=await repo.idempotentJob(p,{action:'POST /api/v1/jobs',key:randomUUID(),body,code:202},()=>repo.createJob(p,body,randomUUID()));
  console.log(JSON.stringify({phase:'native_assets_staged',uploadId,assetId,consentId,profileId,jobId:made.jobId}));
  await new Promise<void>(()=>{/* Parent actually kills this writer after all database writes and before COMMIT. */});
 });
}finally{await db.close();}
