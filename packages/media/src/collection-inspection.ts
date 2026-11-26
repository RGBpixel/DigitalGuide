import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {collectionMediaType,puppetConfiguration,type CollectionMediaType} from '@digitalguide/contracts';
import {AppError} from '@digitalguide/domain';
import {inspectMedia} from './index.js';
import {inspectVideoSource} from './video-source.js';
import {inspectAlphaVideoSource,createAlphaBrowserPreview} from './alpha-video-source.js';
import {inspectStaticGlb,renderStaticGlb} from './character-glb.js';
import {drawPuppetThumbnail} from './character-puppet.js';
export const collectionInspectionOutput=z.strictObject({mediaType:collectionMediaType,specs:z.record(z.string(),z.number()),posterFile:z.string().nullable(),previewFile:z.string().nullable(),warnings:z.array(z.string().max(500)).max(20)});
export interface CollectionInspectionInput{file:string;directory:string;root:string;mediaType:CollectionMediaType}
export async function inspectCollectionFile(input:CollectionInspectionInput,signal:AbortSignal,progress:(v:number)=>void){
  signal.throwIfAborted();let specs:Record<string,number>,posterFile:string|null=null,previewFile:string|null=null;const warnings=['完成格式/完整解码检查；未执行病毒扫描，不代表人物授权、身份或模型训练许可。'];
  if(input.mediaType==='video/mp4'||input.mediaType==='video/quicktime'){
    const video=input.mediaType==='video/quicktime'?await inspectAlphaVideoSource(input.file,input.directory,input.root,signal,v=>progress(v*.65)):await inspectVideoSource(input.file,input.directory,input.root,signal,v=>progress(v*.9));specs=video.specs;posterFile=video.posterFile;warnings.push(...video.warnings);
    if(input.mediaType==='video/quicktime'){previewFile=path.join(input.directory,'preview.mp4');await createAlphaBrowserPreview(input.file,previewFile,input.root,signal);await inspectVideoSource(previewFile,path.join(input.directory,'preview-check'),input.root,signal,v=>progress(.65+v*.3));warnings.push('保留透明ProRes MOV原件；浏览器副本使用浅底，不能作为Alpha交付。');}
  }else{
    const bytes=fs.readFileSync(input.file);if(bytes.length>8388608)throw new AppError('COLLECTION_FILE_LIMIT','图片、音频、静态GLB和二维配置最多8 MB。',422);
    if(input.mediaType==='model/gltf-binary'){const model=inspectStaticGlb(bytes);specs=model.metrics;posterFile=path.join(input.directory,'poster.png');fs.writeFileSync(posterFile,renderStaticGlb(model),{flag:'wx'});warnings.push('静态内嵌GLB实际预览；不支持纹理、外部资源、扩展、骨骼或动画，不代表可驱动数字人。');}
    else if(input.mediaType==='application/vnd.digitalguide.puppet+json'){const configuration=puppetConfiguration.parse(JSON.parse(bytes.toString('utf8')));specs={width:512,height:768,rigVersion:1};posterFile=path.join(input.directory,'poster.png');fs.writeFileSync(posterFile,drawPuppetThumbnail(configuration),{flag:'wx'});warnings.push('仅本平台严格格式的二维参数配置，不执行代码或外部资源。');}
    else{const inspected=inspectMedia(bytes);if(inspected.mediaType!==input.mediaType)throw new AppError('COLLECTION_TYPE_MISMATCH','实际文件内容与登记的媒体类型不一致。',422);specs=inspected.specs;}
    progress(.95);
  }
  signal.throwIfAborted();return collectionInspectionOutput.parse({mediaType:input.mediaType,specs,posterFile,previewFile,warnings});
}
