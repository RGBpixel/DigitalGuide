import {randomUUID} from 'node:crypto';
import {syntheticPng} from '../packages/media/src/index.js';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeAssetLibrary} from '../packages/postgres/src/runtime-library.js';
import {NativeStudioClones} from '../packages/postgres/src/runtime-clones.js';
const db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(process.argv[2]),'api'),repo=new NativeCoreRepository(db),library=new NativeAssetLibrary(repo),clones=new NativeStudioClones(repo);
try{await db.transaction(async()=>{
 const p=await repo.principal('30000000-0000-4000-8000-000000000001'),workspaceId='20000000-0000-4000-8000-000000000001';
 await db.query("SELECT set_config('digitalguide.actor_id',$1,true)",[p.userId]);
 const uploadId=await repo.assets.upload(p,{workspaceId,contentBase64:syntheticPng().toString('base64')},randomUUID()),assetId=await repo.assets.create(p,{uploadId,name:'未提交的素材库原件',category:'avatar',expiresAt:null},randomUUID()),consentId=await repo.assets.grant(p,assetId,{purpose:'train_avatar',subject:'虚构授权人',proof:'事务中断验证用虚构专项证明',noticeVersion:'local-v1',expiresAt:new Date(Date.now()+3600_000).toISOString()},randomUUID()),profileId=await repo.assets.createProfile(p,{workspaceId,name:'未提交角色',avatarAssetId:assetId,scenes:['video']},randomUUID());
 const folderId=await library.createFolder(p,{workspaceId,name:'未提交分类',parentId:null});await library.save(p,assetId,{version:1,name:'未提交整理',folderId,tags:['synthetic']});
 const cloneId=await repo.idempotentResource(p,{action:'POST /api/v1/studio/clones',key:randomUUID(),body:{workspaceId,assetId,consentId},code:200},()=>clones.create(p,{workspaceId,name:'未提交模拟参考',kind:'avatar',assetId,consentId,simulate:'success'},randomUUID())),clone=await clones.get(p,cloneId);
 console.log(JSON.stringify({phase:'native_library_staged',uploadId,assetId,consentId,profileId,folderId,cloneId,jobId:clone.jobId}));
 await new Promise<void>(()=>{/* Parent SIGKILL occurs after all twenty-table writes, before COMMIT. */});
});}finally{await db.close();}
