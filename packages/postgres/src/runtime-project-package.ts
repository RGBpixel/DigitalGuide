import {mediaFileExtension} from '../../contracts/src/index.js';
import {createHash} from 'node:crypto';
import type {PortableProject,StudioDocument} from '../../contracts/src/index.js';
import {AppError} from '../../domain/src/index.js';
import {validatePortableProject} from '../../domain/src/portable-project.js';
import type {NativeProject} from './runtime-studio.js';
import type {NativeStudioResources} from './runtime-studio-resources.js';

export function nativePortableProject(project:NativeProject,source:Awaited<ReturnType<NativeStudioResources['inspect']>>):PortableProject{
 const document:StudioDocument=structuredClone(source.doc),nonPortable:PortableProject['nonPortable']=[];
 for(const speaker of document.speakers)for(const[key,kind,label]of [['profileId','profile','角色配置'],['avatarCloneId','avatar_clone','形象克隆模型'],['voiceCloneId','voice_clone','声音克隆模型']] as const)if(speaker[key]){nonPortable.push({kind,reason:speaker.name+'的'+label+'不随开放包迁移；保留原参考文件，目标空间须独立确认用途并重新接入。'});speaker[key]=null;}
 for(const segment of document.segments){if(segment.contentOriginId){nonPortable.push({kind:'content_origin',reason:segment.title+'的内容来源、定位、模型候选与审阅历史不随开放包迁移；保留已审阅文字和最短期限，目标空间须独立确认用途。'});delete segment.contentOriginId;}if(segment.source){nonPortable.push({kind:'document_origin',reason:segment.title+'的原PPT/PDF及其处理记录不随开放包迁移，保留可编辑对象与引用图片。'});segment.source=null;}for(const element of segment.elements)if(element.type==='image'&&element.importMediaId){element.assetId=element.importMediaId;element.importMediaId=null;}}
 if(source.importMedia.length&&!nonPortable.some(n=>n.kind==='document_origin'))nonPortable.push({kind:'document_origin',reason:'引用图片的原PPT/PDF处理与用途确认记录不随开放包迁移，保留实际PNG，目标空间须独立确认用途。'});
 if(source.speechOrigins.length)nonPortable.push({kind:'content_origin',reason:'系统配音任务、控制与词典历史不随开放包迁移；保留实际合成WAV、合成标识和最短来源期限，目标空间须独立确认用途，不代表克隆模型迁移。'});
 // The shortest current asset/content/clone authorization deadline survives detached service bindings.
 if(source.notAfter)for(const segment of document.segments)if(!segment.contentExpiresAt||segment.contentExpiresAt>source.notAfter)segment.contentExpiresAt=source.notAfter;
 const assets=source.assets.map(a=>{if(!['image/png','audio/wav','video/mp4','video/quicktime'].includes(a.mediaType))throw new AppError('PG_PACKAGE_ORIGIN_NOT_MIGRATED','此原件类型的原生工程迁移尚未接通，请使用完整工作台；不会丢弃素材后生成替代包。',503);return{id:a.id,name:a.name,category:a.category as PortableProject['assets'][number]['category'],file:'assets/'+a.id+'.'+mediaFileExtension(a.mediaType),mediaType:a.mediaType as PortableProject['assets'][number]['mediaType'],size:a.size,sha256:a.sha256,specs:a.specs,expiresAt:[a.expiresAt,source.notAfter].filter((s):s is string=>!!s).sort()[0]??null,synthetic:a.synthetic};});
 for(const m of source.importMedia)assets.push({id:m.id,name:'导入图片 '+m.id,category:'reference',file:'assets/'+m.id+'.png',mediaType:'image/png',size:Number(m.size),sha256:m.sha256,specs:{width:m.width,height:m.height},expiresAt:source.notAfter,synthetic:false});
 return validatePortableProject({format:'digitalguide-project',version:1,name:project.name,purpose:project.purpose,document,assets,nonPortable,createdAt:project.updated_at,rightsNotice:'开放工程与固定源文件可迁移；账号、模型和专项授权不转移。导入者须独立确认目标用途，最短来源期限保留。已下载文件不能远程收回。'});
}
export const nativePackageDigest=(portable:PortableProject)=>createHash('sha256').update(JSON.stringify(portable)).digest('hex');
