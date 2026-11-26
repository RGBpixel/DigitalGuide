import type { PortableProject,StudioDocument } from '@digitalguide/contracts';
import { portableProjectSchema,isVideoMediaType,mediaFileExtension,storedPngMaximumBytes,storedWavMaximumBytes } from '@digitalguide/contracts';
import { AppError } from './index.js';
import { validateStudioDocument,remapStudioDocument } from './studio-project.js';
export const packageMaxBytes = 1024*1024*1024,packageManifestMaxBytes = 8*1024*1024;
export function documentAssetReferences(doc: StudioDocument) {
  const assets = new Set<string>(),media = new Set<string>();
  if (doc.brand.logoAssetId) assets.add(doc.brand.logoAssetId);
  for (const s of doc.speakers) { if (s.avatarAssetId) assets.add(s.avatarAssetId);if (s.voiceAssetId) assets.add(s.voiceAssetId); }
  for (const s of doc.segments) for (const e of s.elements) if (e.type === 'image') { if (e.assetId) assets.add(e.assetId);if (e.importMediaId) media.add(e.importMediaId); }
  for (const t of doc.timeline?.tracks || []) for (const c of t.clips) if (c.source.type === 'asset') assets.add(c.source.assetId);
  return { assets,media };
}
export function validatePortableProject(input: unknown): PortableProject {
  const p = portableProjectSchema.parse(input),doc = validateStudioDocument(p.document),refs = documentAssetReferences(doc);
  const invalid = (message: string) => new AppError('INVALID_PROJECT_PACKAGE',message,422);
  if (refs.media.size || doc.segments.some(s => s.source||s.contentOriginId) || doc.speakers.some(s => s.profileId || s.avatarCloneId || s.voiceCloneId)) throw invalid('工程包含不可迁移的来源、角色或克隆绑定，请重新导出开放工程。');
  if(doc.segments.some(s=>s.contentExpiresAt&&s.contentExpiresAt<=new Date().toISOString()))throw invalid('工程包中的脚本来源使用期限已到期，请重新核对授权。');
  if (new Set(p.assets.map(a => a.id)).size !== p.assets.length || new Set(p.assets.map(a => a.file.toLowerCase())).size !== p.assets.length) throw invalid('工程包素材编号或路径重复。');
  const ids = new Set(p.assets.map(a => a.id));if (ids.size !== refs.assets.size || [...refs.assets].some(id => !ids.has(id))) throw invalid('工程引用与包内素材清单不一致；不能引用工作空间已有编号。');
  for (const a of p.assets) {
    const ext = mediaFileExtension(a.mediaType);
    if (a.file !== 'assets/'+a.id+'.'+ext || (!isVideoMediaType(a.mediaType) && a.size > (a.mediaType==='image/png'?storedPngMaximumBytes:storedWavMaximumBytes))) throw invalid('工程包素材路径、类型或大小不受支持。');
    if (a.expiresAt && a.expiresAt <= new Date().toISOString()) throw invalid('工程包包含已过期的素材，请先核对使用权限。');
  }
  if (p.assets.reduce((n,a) => n+a.size,0)+Buffer.byteLength(JSON.stringify(p)) > packageMaxBytes) throw invalid('工程包展开后超过1 GB，请拆分工程。');
  return p;
}
export function remapPortableDocument(project: PortableProject,assetIds: Map<string,string>) {
  const doc = remapStudioDocument(project.document),asset = (id: string) => { const next = assetIds.get(id);if (!next) throw new AppError('INVALID_PROJECT_PACKAGE','包内素材映射缺失，未建立工程。',422);return next; };
  if (doc.brand.logoAssetId) doc.brand.logoAssetId = asset(doc.brand.logoAssetId);
  for (const s of doc.speakers) { if (s.avatarAssetId) s.avatarAssetId = asset(s.avatarAssetId);if (s.voiceAssetId) s.voiceAssetId = asset(s.voiceAssetId); }
  for (const s of doc.segments) for (const e of s.elements) if (e.type === 'image' && e.assetId) e.assetId = asset(e.assetId);
  for (const t of doc.timeline?.tracks || []) for (const c of t.clips) if (c.source.type === 'asset') c.source.assetId = asset(c.source.assetId);
  return validateStudioDocument(doc);
}
