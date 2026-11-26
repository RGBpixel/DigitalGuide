import {AppError,canonical,type Principal} from '../../domain/src/index.js';
import {isVideoMediaType} from '../../contracts/src/index.js';
import {NativeMediaProcessing} from './runtime-processing.js';
import type {NativeCoreRepository} from './runtime-repository.js';
import type {NativeVideoReceipt} from './runtime-assets.js';

export async function verifyNativeProcessingOrigin(core:NativeCoreRepository,p:Principal,row:{id:string;upload_id:string;workspaceId:string;sha256:string;size:string;specs:string;mediaType:string;storage_key:string;expiresAt:string|null;synthetic:string}){
 const binding=(await core.db.query<{job_id:string}>('SELECT job_id FROM studio_media_outputs WHERE asset_id=$1',[row.id])).rows[0];if(!binding)throw new AppError('MEDIA_SOURCE_UNAVAILABLE','处理素材缺少当前原生完成凭据。',409);
 const service=new NativeMediaProcessing(core),job=await service.jobRow(p,binding.job_id,false,true);await service.currentJob(p,job);const{files}=await service.completed(job),file=files.find(f=>f.assetId===row.id),payload=service.payload(job);
 if(job.status!=='succeeded'||payload.configuration.provider!=='local-media'||!file||file.uploadId!==row.upload_id||job.workspace_id!==row.workspaceId||file.mediaType!==row.mediaType||file.object.sha256!==row.sha256||Number(file.object.size)!==Number(row.size)||file.object.storage_key!==row.storage_key||canonical(file.specs)!==canonical(JSON.parse(row.specs))||!row.expiresAt||row.expiresAt>file.expiresAt||Boolean(Number(row.synthetic))!==payload.source.synthetic)throw new AppError('MEDIA_SOURCE_UNAVAILABLE','处理素材的实际来源、字节、规格或继承期限不一致。',409);
 let video:NativeVideoReceipt|null=null;if(isVideoMediaType(file.mediaType)){if(!file.poster||file.mediaType==='video/quicktime'&&!file.preview)throw new AppError('MEDIA_SOURCE_UNAVAILABLE','处理视频缺少实际封面或网页代理。',409);video={assetId:row.id,transferId:job.id,sourceKind:'media_processing',uploadId:row.upload_id,sha256:row.sha256,size:Number(row.size),status:'ready',transferKind:'processing',transferAssetId:row.id,transferSha:row.sha256,poster:file.poster,preview:file.preview};}return{file,video};
}
