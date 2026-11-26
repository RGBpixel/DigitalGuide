import fs from 'node:fs';
import path from 'node:path';
import type { PortableProject } from '@digitalguide/contracts';
import {mediaFileExtension} from '@digitalguide/contracts';
import { AppError,assertUsableAsset,type Principal } from '@digitalguide/domain';
import { documentAssetReferences,validatePortableProject } from '../../../packages/domain/src/portable-project.js';
import { ownedFile } from '../../../packages/media/src/files.js';
import type { StudioService,StudioProjectRow } from './studio-service.js';
export function studioPackageSnapshot(studio: StudioService,p: Principal,project: StudioProjectRow) {
  const doc = studio.validate(p,project.workspace_id,project.purpose,JSON.parse(project.document)),refs = documentAssetReferences(doc),assets: PortableProject['assets'] = [],nonPortable: PortableProject['nonPortable'] = [],files: Record<string,string> = {},versions: {id: string;version: number}[] = [];
  const objects = path.join(studio.dataDir,'objects');
  for (const id of [...refs.assets].sort()) {
    const a = studio.repo.asset(p,id);assertUsableAsset(a);if (a.workspaceId !== project.workspace_id) throw new AppError('ASSET_SCOPE_MISMATCH','工程包素材不属于当前工作空间。',409);
    if (!['image/png','audio/wav','video/mp4','video/quicktime'].includes(a.mediaType)) throw new AppError('UNSUPPORTED_MEDIA','此素材暂不能迁移，请替换后导出。',409);
    const key = studio.repo.get<{storage_key: string}>('SELECT u.storage_key FROM uploads u JOIN assets a ON a.upload_id=u.id WHERE a.id=?',id)!.storage_key,ext = mediaFileExtension(a.mediaType);
    files[id] = key;versions.push({ id,version: a.version });assets.push({ id,name: a.name,category: a.category as PortableProject['assets'][number]['category'],mediaType: a.mediaType as PortableProject['assets'][number]['mediaType'],file: 'assets/'+id+'.'+ext,size: a.size,sha256: a.sha256,specs: a.specs,expiresAt: a.expiresAt,synthetic:a.synthetic });
  }
  for (const id of [...refs.media].sort()) {
    if (files[id]) throw new AppError('DUPLICATE_OBJECT_ID','文档图片与素材编号冲突，请重新导入。',409);
    const m = studio.imports.media(p,id);if (m.workspace_id !== project.workspace_id) throw new AppError('ASSET_SCOPE_MISMATCH','文档图片不属于当前工作空间。',409);
    files[id] = m.storage_key;assets.push({ id,name: '导入文档图片',category: 'reference',mediaType: 'image/png',file: 'assets/'+id+'.png',size: fs.statSync(ownedFile(objects,m.storage_key)).size,sha256: m.sha256,specs: { width: m.width,height: m.height },expiresAt: null });
  }
  if(assets.some(a=>studio.repo.get('SELECT id FROM studio_media_outputs WHERE asset_id=?',a.id)))nonPortable.push({kind:'content_origin',reason:'媒体加工的服务端方案、用途凭据和上游撤回关系不随开放包迁移；保留文件与最短期限，导入者须独立确认目标用途，不能将素材下载视为模型或授权迁移。'});
  for (const s of doc.speakers) {
    for (const [key,kind,label] of [['profileId','profile','角色配置'],['avatarCloneId','avatar_clone','形象克隆模型'],['voiceCloneId','voice_clone','声音克隆模型']] as const) if (s[key]) { nonPortable.push({ kind,reason: s.name+'的'+label+'不包含在开放工程中；已保留原有参考素材，需要在目标空间重新接入。' });s[key] = null; }
  }
  for (const s of doc.segments) {
    if(s.contentOriginId){const source=studio.repo.get<{expires_at:string|null}>('SELECT expires_at FROM studio_content_origins WHERE id=?',s.contentOriginId)!;if(source.expires_at&&(!s.contentExpiresAt||s.contentExpiresAt>source.expires_at))s.contentExpiresAt=source.expires_at;nonPortable.push({kind:'content_origin',reason:s.title+'的来源授权、账号定位和草稿修订不自动转移；已保留来源到期约束，导入者须重新核对目标用途许可。'});delete s.contentOriginId;}
    if (s.source) { nonPortable.push({ kind: 'document_origin',reason: s.title+'的原PPT/PDF及其处理记录不随包迁移；保留可编辑对象与引用图片。' });s.source = null; }
    for (const e of s.elements) if (e.type === 'image' && e.importMediaId) { e.assetId = e.importMediaId;e.importMediaId = null; }
  }
  const portable = validatePortableProject({ format: 'digitalguide-project',version: 1,name: project.name,purpose: project.purpose,document: doc,assets,nonPortable,createdAt: project.updated_at,rightsNotice: '只迁移清单中的已授权源素材和开放工程；不转移模型、服务账号、克隆授权或第三方软件工程格式。导入者须确认拥有目标用途权限，素材有效期不会延长。' });
  return { portable,files,versions };
}
