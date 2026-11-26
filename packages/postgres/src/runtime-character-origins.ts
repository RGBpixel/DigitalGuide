import {AppError,canonical,type Principal} from '../../domain/src/index.js';
import type {NativeCoreRepository} from './runtime-repository.js';
import {NativeCharacterProduction} from './runtime-character-production.js';
import type {NativeVideoReceipt} from './runtime-assets.js';

export async function verifyNativeCharacterOrigin(core:NativeCoreRepository,p:Principal,row:{id:string;upload_id:string;workspaceId:string;sha256:string;size:string;specs:string;mediaType:string;storage_key:string;expiresAt:string|null;synthetic:string}){
 const binding=(await core.db.query<{job_id:string;expires_at:string;synthetic:string}>('SELECT job_id,expires_at,synthetic FROM _dg_native_character_assets WHERE asset_id=$1',[row.id])).rows[0];
 if(!binding)throw new AppError('CHARACTER_SOURCE_UNAVAILABLE','派生形象缺少本次实际媒体与应用凭据。',409);
 const service=new NativeCharacterProduction(core),job=await service.row(p,binding.job_id);await service.current(p,job,true);
 const receipt=await service.receipt(job),output=receipt.outputs[0];
 if(job.status!=='succeeded'||receipt.outputs.length!==1||!output||job.workspace_id!==row.workspaceId||output.mediaType!==row.mediaType||output.storageKey!==row.storage_key||output.sha256!==row.sha256||output.size!==Number(row.size)||canonical(output.specs)!==canonical(JSON.parse(row.specs))||!row.expiresAt||Date.parse(row.expiresAt)>Date.parse(binding.expires_at)||Number(row.synthetic)!==Number(binding.synthetic))throw new AppError('CHARACTER_SOURCE_UNAVAILABLE','形象派生文件与实际处理凭据或继承权益不符。',409);
 let video:NativeVideoReceipt|null=null;
 if(output.mediaType==='video/mp4'){if(!output.poster)throw new AppError('CHARACTER_SOURCE_UNAVAILABLE','动作视频缺少实际检查封面。',409);video={assetId:row.id,transferId:job.id,sourceKind:'character_render',uploadId:row.upload_id,sha256:row.sha256,size:Number(row.size),status:'ready',transferKind:'character',transferAssetId:row.id,transferSha:row.sha256,poster:{storage_key:output.poster.storageKey,sha256:output.poster.sha256,size:output.poster.size},preview:null};}
 return{output,video};
}
