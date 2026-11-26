import {sqliteShelfTemplateSelection,claimSqliteShelfSelection} from './resource-shelf-origin.js';
import {inspectCaptionRendering} from '../../../packages/media/src/caption-layout.js';
import { randomUUID, createHash } from 'node:crypto';
import {isVideoMediaType} from '@digitalguide/contracts';
import { contentOriginReferences } from './content-dependencies.js';
import { invalidateStudioReviews } from './studio-review-state.js';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, assertUsableAsset, canonical, requireWorkspace, type Principal } from '@digitalguide/domain';
import { studioTracks, validateStudioDocument, applyStudioTemplate, studioFingerprint,remapStudioDocument,studioCaptionPaginationNotice } from '../../../packages/domain/src/studio-project.js';
import {normalizeTemplateParameters} from '../../../packages/domain/src/template-controls.js';
import {studioSourceSnapshot} from './studio-source-snapshot.js';
import type {TemplateParameters,TemplateInstantiationPlan} from '@digitalguide/contracts';
import { blankStudioDocument, builtinStudioTemplates, studioCreateInput, studioTemplateInput, studioBrandInput,studioDocumentInput, type StudioDocument, type StudioProject, type StudioTemplate, type StudioBrand, type StudioFrame, type StudioPlan } from '@digitalguide/contracts';
import { StudioImports } from './studio-import-service.js';
import { StudioClones } from './studio-clone-service.js';
import { reconcileTimeline,timelineDependencies,timelineDuration,segmentTimelineStart } from '../../../packages/domain/src/timeline.js';
export interface StudioProjectRow { id: string; tenant_id: string; workspace_id: string; name: string; purpose: 'video' | 'presentation'; document: string; version: number; archived: number; updated_at: string }
interface TemplateRow { id: string; tenant_id: string; workspace_id: string; name: string; description: string; purpose: 'video' | 'presentation'; document: string; variables: string; license_note: string; version: number;controls:string|null }
interface BrandRow { id: string; tenant_id: string; workspace_id: string; name: string; style: string; license_note: string; version: number }
export interface FrameRow { id: string; project_id: string; segment_id: string; fingerprint: string; storage_key: string; status: StudioFrame['status']; width: number; height: number; created_at: string }
const at = () => new Date().toISOString();
export class StudioService {
  imports: StudioImports; clones: StudioClones;
  constructor(public repo: Repository, public environment: string, public appEnv: string, public dataDir: string) { this.imports = new StudioImports(repo, environment, appEnv, dataDir); this.clones = new StudioClones(repo, environment, appEnv); }
  project(p: Principal, id: string) { const r = this.repo.get<StudioProjectRow>('SELECT * FROM studio_projects WHERE id=? AND tenant_id=? AND environment=? AND app_env=?', id, p.tenantId, this.environment, this.appEnv); if (!r) throw new AppError('NOT_FOUND', '工程不存在或不在当前环境。', 404); requireWorkspace(p, r.workspace_id); return r; }
  version(r: { version: number }, version: number) { if (r.version !== version) throw new AppError('VERSION_CONFLICT', '内容已被另一窗口修改，请先载入最新版本或保留草稿副本。', 409); }
  editable(r: StudioProjectRow) { if (r.archived) throw new AppError('PROJECT_ARCHIVED', '工程已归档，请先恢复再编辑。', 409); }
  asset(p: Principal, workspaceId: string, id: string, type: 'image/png' | 'audio/wav') { const a = this.repo.asset(p, id); assertUsableAsset(a); if (a.workspaceId !== workspaceId || a.mediaType !== type) throw new AppError('ASSET_SCOPE_MISMATCH', '工程素材不在当前工作空间或类型不兼容。', 409); return a; }
  timelineAsset(p: Principal,workspaceId: string,id: string,audio: boolean) {
    const a = this.repo.asset(p,id);assertUsableAsset(a);if (a.workspaceId !== workspaceId || ![audio ? 'audio/wav' : 'image/png','video/mp4','video/quicktime'].includes(a.mediaType) || (audio && isVideoMediaType(a.mediaType) && !a.specs.hasAudio)) throw new AppError('ASSET_SCOPE_MISMATCH','素材不在当前空间、类型不适用，或视频没有可提取原声。',409);
    if (isVideoMediaType(a.mediaType) && !this.repo.get('SELECT asset_id FROM video_sources WHERE asset_id=?',a.id)) throw new AppError('VIDEO_NOT_READY','视频尚未完成实际检查，请等待素材就绪。',409);return a;
  }
  segmentResources(p: Principal, workspaceId: string, purpose: 'video' | 'presentation', doc: StudioDocument, segmentId: string) {
    const segment = doc.segments.find(s => s.id === segmentId)!; if (!segment) throw new AppError('NOT_FOUND', '分镜已移除。', 404);
    if(segment.contentExpiresAt&&segment.contentExpiresAt<=new Date().toISOString())throw new AppError('CONTENT_SOURCE_EXPIRED','脚本来源使用期限已到期，请以当前授权来源重新建立计划。',409);
    if(segment.contentOriginId)contentOriginReferences(this.repo,p,workspaceId,this.environment,this.appEnv,segment.contentOriginId);
    const assets = new Map<string, { id: string; version: number; sha256: string }>(), media = new Map<string, { id: string; hash: string }>(), clones: { id: string; version: number }[] = [];
    const image = (id: string) => { const a = this.asset(p, workspaceId, id, 'image/png'); assets.set(id, { id, version: a.version, sha256: a.sha256 }); return a; };
    if (doc.brand.logoAssetId) image(doc.brand.logoAssetId);
    const speaker = doc.speakers.find(s => s.id === segment.speakerId);
    if (speaker) {
      if (speaker.profileId) { const profile = this.repo.profile(p, speaker.profileId); if (profile.workspaceId !== workspaceId || !profile.scenes.includes(purpose) || profile.avatarAssetId !== speaker.avatarAssetId || profile.voiceAssetId !== speaker.voiceAssetId) throw new AppError('PROFILE_CHANGED', '角色配置已变化或未开放此制作场景，请重新选择角色。', 409); }
      if (speaker.avatarAssetId) image(speaker.avatarAssetId);
      if (speaker.voiceAssetId) { const a = this.asset(p, workspaceId, speaker.voiceAssetId, 'audio/wav'); assets.set(a.id, { id: a.id, version: a.version, sha256: a.sha256 }); }
      for (const [id, kind, assetId] of [[speaker.avatarCloneId, 'avatar', speaker.avatarAssetId], [speaker.voiceCloneId, 'voice', speaker.voiceAssetId]] as const) if (id) { const c = this.clones.row(p, id); if (c.workspace_id !== workspaceId || c.kind !== kind || c.asset_id !== assetId || c.status !== 'accepted') throw new AppError('CLONE_NOT_ACCEPTED', '模拟参考尚未验收、已失效或与当前素材不一致。', 409); clones.push({ id: c.id, version: c.version }); }
    }
    if (segment.source) { const source = this.imports.import(p, segment.source.importId); if (source.workspace_id !== workspaceId || source.status !== 'review' || !this.imports.view(source).pages.some(page => page.id === segment.source!.pageId)) throw new AppError('SOURCE_UNAVAILABLE', '分镜引用的导入页不存在或已取消，请重新选择来源。', 409); }
    let pixels = 0;
    for (const element of segment.elements) if (element.type === 'image') {
      if (element.assetId) { const a = image(element.assetId); pixels += (a.specs.width || 0) * (a.specs.height || 0); }
      else { const m = this.imports.media(p, element.importMediaId!); if (m.workspace_id !== workspaceId) throw new AppError('ASSET_SCOPE_MISMATCH', '导入图片不属于当前工作空间。', 409); media.set(m.id, { id: m.id, hash: m.sha256 }); pixels += m.width * m.height; }
    }
    if (pixels > 32_000_000) throw new AppError('PREVIEW_TOO_LARGE', '单个分镜图片总像素过大，请压缩或拆分后预览。', 409);
    return { assets: [...assets.values()].sort((a, b) => a.id.localeCompare(b.id)), media: [...media.values()].sort((a, b) => a.id.localeCompare(b.id)), clones };
  }
  timelineResources(p: Principal,workspaceId: string,purpose: 'video'|'presentation',doc: StudioDocument,segmentId?: string) {
    const assets = new Map<string,{ id: string;version: number;sha256: string }>(),media = new Map<string,{ id: string;hash: string }>(),clones = new Map<string,{ id: string;version: number }>();
    if (doc.brand.logoAssetId) { const a = this.asset(p,workspaceId,doc.brand.logoAssetId,'image/png');assets.set(a.id,{ id: a.id,version: a.version,sha256: a.sha256 }); }
    const tracks = segmentId ? timelineDependencies(doc,segmentId)?.tracks || [] : doc.timeline?.tracks || [],segments = new Set<string>(),speakers = new Set<string>();
    const videoEvents: {time: number;delta: number}[] = [];
    for (const track of tracks) for (const clip of track.clips) {
      if (clip.segmentId) segments.add(clip.segmentId);if (clip.speakerId) speakers.add(clip.speakerId);
      if (clip.source.type === 'asset') { const audio = ['voice','music'].includes(track.type),a = this.timelineAsset(p,workspaceId,clip.source.assetId,audio);assets.set(a.id,{ id: a.id,version: a.version,sha256: a.sha256 });if (!audio && !track.muted && !clip.muted && isVideoMediaType(a.mediaType)) videoEvents.push({ time: clip.startMs,delta: 1 },{ time: clip.startMs+clip.durationMs,delta: -1 }); }
    }
    let activeVideo = 0;for (const e of videoEvents.sort((a,b) => a.time-b.time || a.delta-b.delta)) { activeVideo += e.delta;if (activeVideo > 4) throw new AppError('VIDEO_OVERLAP_LIMIT','本地同一时刻最多四条视频画面，请减少同屏视频或错开时间。',409); }
    for (const id of segments) { const r = this.segmentResources(p,workspaceId,purpose,doc,id);for (const a of r.assets) assets.set(a.id,a);for (const m of r.media) media.set(m.id,m);for (const c of r.clones) clones.set(c.id,c); }
    for (const id of speakers) { const s = doc.speakers.find(s => s.id === id)!;
      if (s.profileId) { const profile = this.repo.profile(p,s.profileId);if (profile.workspaceId !== workspaceId || !profile.scenes.includes(purpose) || profile.avatarAssetId !== s.avatarAssetId || profile.voiceAssetId !== s.voiceAssetId) throw new AppError('PROFILE_CHANGED','时间线角色配置已变化，请重新选择。',409); }
      for (const [assetId,type] of [[s.avatarAssetId,'image/png'],[s.voiceAssetId,'audio/wav']] as const) if (assetId) { const a = this.asset(p,workspaceId,assetId,type);assets.set(a.id,{ id: a.id,version: a.version,sha256: a.sha256 }); }
      for (const [cloneId,kind,assetId] of [[s.avatarCloneId,'avatar',s.avatarAssetId],[s.voiceCloneId,'voice',s.voiceAssetId]] as const) if (cloneId) { const c = this.clones.row(p,cloneId);if (c.workspace_id !== workspaceId || c.kind !== kind || c.asset_id !== assetId || c.status !== 'accepted') throw new AppError('CLONE_NOT_ACCEPTED','时间线模拟参考未验收、已失效或与素材不一致。',409);clones.set(c.id,{ id: c.id,version: c.version }); }
    }
    return { assets: [...assets.values()].sort((a,b) => a.id.localeCompare(b.id)),media: [...media.values()].sort((a,b) => a.id.localeCompare(b.id)),clones: [...clones.values()].sort((a,b) => a.id.localeCompare(b.id)) };
  }
  resources(p: Principal,workspaceId: string,purpose: 'video'|'presentation',doc: StudioDocument,segmentId: string) {
    const base = this.segmentResources(p,workspaceId,purpose,doc,segmentId);if (!doc.timeline) return base;const extra = this.timelineResources(p,workspaceId,purpose,doc,segmentId);
    return { assets: [...new Map([...base.assets,...extra.assets].map(a => [a.id,a])).values()].sort((a,b) => a.id.localeCompare(b.id)),media: [...new Map([...base.media,...extra.media].map(a => [a.id,a])).values()].sort((a,b) => a.id.localeCompare(b.id)),clones: [...new Map([...base.clones,...extra.clones].map(a => [a.id,a])).values()].sort((a,b) => a.id.localeCompare(b.id)) };
  }
  validate(p: Principal, workspaceId: string, purpose: 'video' | 'presentation', document: unknown) { const doc = validateStudioDocument(document); for (const segment of doc.segments) this.resources(p, workspaceId, purpose, doc, segment.id);if (doc.timeline) this.timelineResources(p,workspaceId,purpose,doc); return doc; }
  fingerprint(p: Principal, r: StudioProjectRow, doc: StudioDocument, segmentId: string) { return studioFingerprint(doc, segmentId, this.resources(p, r.workspace_id, r.purpose, doc, segmentId)); }
  view(p: Principal, r: StudioProjectRow): StudioProject {
    const doc = validateStudioDocument(JSON.parse(r.document)), problems: string[] = [], fingerprints = new Map<string, string>();
    for (const segment of doc.segments) { try { fingerprints.set(segment.id, this.fingerprint(p, r, doc, segment.id)); } catch (e) { if (!(e instanceof AppError)) throw e; problems.push(segment.title + '：' + e.message); } }
    if (doc.timeline) try { this.timelineResources(p,r.workspace_id,r.purpose,doc); } catch (e) { if (!(e instanceof AppError)) throw e;problems.push('时间线：'+e.message); }
    const frames = this.repo.all<FrameRow>('SELECT * FROM studio_preview_frames WHERE project_id=? ORDER BY created_at DESC,rowid DESC', r.id), latest = new Map<string, StudioFrame>();
    for (const frame of frames) if ((!latest.has(frame.segment_id) || (latest.get(frame.segment_id)?.status === 'stale' && frame.status === 'ready' && fingerprints.get(frame.segment_id) === frame.fingerprint)) && doc.segments.some(s => s.id === frame.segment_id)) latest.set(frame.segment_id, { id: frame.id, segmentId: frame.segment_id, status: frame.status === 'ready' && fingerprints.get(frame.segment_id) === frame.fingerprint ? 'ready' : 'stale', fingerprint: frame.fingerprint, width: frame.width, height: frame.height, url: '/api/v1/studio/previews/' + frame.id });
    return { id: r.id, workspaceId: r.workspace_id, name: r.name, purpose: r.purpose, version: r.version, archived: !!r.archived, document: doc, tracks: studioTracks(doc), durationMs: timelineDuration(doc), frames: [...latest.values()], resourceProblems: [...new Set(problems)], updatedAt: r.updated_at };
  }
  create(p: Principal, input: z.infer<typeof studioCreateInput>) {
    requireWorkspace(p, input.workspaceId); let document = input.document || blankStudioDocument(),selected:StudioTemplate|null=null,plan:TemplateInstantiationPlan|null=null;
    if(!input.templateId&&(input.parameters||input.templatePlanHash))throw new AppError('TEMPLATE_REQUIRED','参数化制作需要选择模板及固定版本。',409);
    if (input.templateId) { const template = this.template(p, input.workspaceId, input.templateId);selected=template;this.version(template, input.templateVersion || 0);if(template.controls?.length){plan=this.templatePlan(p,input.workspaceId,template,input.variables,input.parameters);if(input.purpose!==template.purpose||plan.hash!==input.templatePlanHash)throw new AppError('TEMPLATE_PLAN_CHANGED','模板版本、参数、素材或用途已变化，请重新核对参数制作计划。',409);document=remapStudioDocument(plan.document);}else document = applyStudioTemplate(template, input.variables,true,input.parameters); }
    if(input.resourceSelectionId)sqliteShelfTemplateSelection(this,p,input.workspaceId,input.resourceSelectionId,selected??undefined);
    const doc = this.validate(p, input.workspaceId, input.purpose, document), id = randomUUID();
    if (this.repo.get<{ n: number }>('SELECT count(*) n FROM studio_projects WHERE tenant_id=? AND workspace_id=? AND archived=0', p.tenantId, input.workspaceId)!.n >= 200) throw new AppError('QUOTA_EXCEEDED', '工作空间已有二百个活动工程，请先归档。', 409);
    this.repo.run('INSERT INTO studio_projects(id,tenant_id,workspace_id,name,purpose,document,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', id, p.tenantId, input.workspaceId, input.name, input.purpose, JSON.stringify(doc), this.environment, this.appEnv, at(), at()); this.repo.run('INSERT INTO studio_project_versions VALUES (?,1,?,?,?,?)', id, input.name, JSON.stringify(doc), p.userId, at());if(selected&&plan)this.recordTemplateInstantiation(p,input.workspaceId,id,selected,input.variables,plan.parameters,plan.hash,doc);if(input.resourceSelectionId)claimSqliteShelfSelection(this.repo,p,input.resourceSelectionId,id,this.environment,this.appEnv);return id;
  }
  save(p: Principal, r: StudioProjectRow, version: number, name: string, document: unknown,options:{allowContentOriginChanges?:boolean}={}) {
    this.version(r, version); this.editable(r);const candidate = studioDocumentInput.parse(document),before=validateStudioDocument(JSON.parse(r.document));
    if(!options.allowContentOriginChanges)for(const segment of candidate.segments){const old=before.segments.find(s=>s.id===segment.id);if(old&&(old.contentOriginId!==segment.contentOriginId||old.contentExpiresAt!==segment.contentExpiresAt))throw new AppError('CONTENT_ORIGIN_CHANGE_REQUIRES_PLAN','请通过当前授权草稿的审阅计划替换来源，或恢复明确的历史版本；不能直接移除脚本来源凭据或到期约束。',409);}
    reconcileTimeline(before,candidate); const doc = this.validate(p, r.workspace_id, r.purpose, candidate);
    for (const frame of this.repo.all<FrameRow>("SELECT * FROM studio_preview_frames WHERE project_id=? AND status='ready'", r.id)) if (!doc.segments.some(s => s.id === frame.segment_id) || this.fingerprint(p, r, doc, frame.segment_id) !== frame.fingerprint) this.repo.run("UPDATE studio_preview_frames SET status='stale' WHERE id=?", frame.id);
    invalidateStudioReviews(this.repo,r.id,'工程已保存新版本，请按新版本重新审核。');
    this.repo.run('UPDATE studio_projects SET name=?,document=?,version=version+1,updated_at=? WHERE id=?', name, JSON.stringify(doc), at(), r.id); this.repo.run('INSERT INTO studio_project_versions VALUES (?,?,?,?,?,?)', r.id, r.version + 1, name, JSON.stringify(doc), p.userId, at()); this.repo.event(p.tenantId, r.workspace_id, r.id, 'studio.project_saved', this.environment); return r.id;
  }
  restore(p: Principal, r: StudioProjectRow, version: number, revision: number) { this.version(r, version); const old = this.repo.get<{ name: string; document: string }>('SELECT name,document FROM studio_project_versions WHERE project_id=? AND version=?', r.id, revision); if (!old) throw new AppError('NOT_FOUND', '历史修订不存在。', 404); return this.save(p, r, version, old.name, JSON.parse(old.document),{allowContentOriginChanges:true}); }
  template(p: Principal, workspaceId: string, id: string): StudioTemplate {
    requireWorkspace(p, workspaceId); const builtin = builtinStudioTemplates().find(t => t.id === id); if (builtin) return builtin;
    const r = this.repo.get<TemplateRow>('SELECT * FROM studio_templates WHERE id=? AND tenant_id=? AND workspace_id=? AND environment=? AND app_env=?', id, p.tenantId, workspaceId, this.environment, this.appEnv); if (!r) throw new AppError('NOT_FOUND', '模板不存在或不在当前工作空间。', 404);
    return { id: r.id, workspaceId: r.workspace_id, name: r.name, description: r.description, purpose: r.purpose, document: JSON.parse(r.document), variables: JSON.parse(r.variables), licenseNote: r.license_note, version: r.version, builtin: false,...(r.controls?{controls:JSON.parse(r.controls)}:{}) };
  }
  templateParameters(p:Principal,workspaceId:string,template:StudioTemplate,input?:TemplateParameters){const values=normalizeTemplateParameters(template.controls,input);for(const c of template.controls||[])if(c.kind==='asset'&&values[c.key]!==null){const a=this.repo.asset(p,values[c.key] as string);assertUsableAsset(a);if(a.workspaceId!==workspaceId||a.mediaType!==c.mediaType)throw new AppError('TEMPLATE_ASSET_SCOPE','参数“'+c.label+'”的素材不在当前空间或类型不兼容。',409);}return values;}
  templatePlan(p:Principal,workspaceId:string,template:StudioTemplate,variables:Record<string,string>,parameters?:TemplateParameters):TemplateInstantiationPlan{requireWorkspace(p,workspaceId);const values=this.templateParameters(p,workspaceId,template,parameters),document=applyStudioTemplate(template,variables,false,values),snapshot=studioSourceSnapshot(this,p,workspaceId,template.purpose,document),hash=createHash('sha256').update(canonical({pipeline:'template-controls-v1',template,variables,parameters:values,sourceHash:snapshot.hash})).digest('hex');return{templateId:template.id,templateVersion:template.version,workspaceId,engine:'native_timeline',hash,parameters:values,document,assets:snapshot.snapshot.assets.map(a=>{const current=this.repo.asset(p,a.id);return{id:a.id,name:current.name,mediaType:current.mediaType,expiresAt:a.expiresAt};}),licenseNote:template.licenseNote,canCreate:true,warnings:['参数只写入声明槽位，不执行脚本、表达式或网络请求。','动画按设定、偏移或缩放处理，关键帧时间与缓动保持；请核对实际成片。','素材沿用原有授权、期限和工作空间约束；文字替换不会自动产生新配音或真人动作。','本计划使用原生时间线；AE需独立授权引擎和模板，原生输出不作为AE渲染验收。']};}
  recordTemplateInstantiation(p:Principal,workspaceId:string,projectId:string,template:StudioTemplate,variables:Record<string,string>,parameters:TemplateParameters|undefined,planHash:string,document:StudioDocument){this.repo.run('INSERT INTO studio_template_instantiations(project_id,tenant_id,workspace_id,actor_id,template_id,template_version,template_snapshot,variables,parameters,plan_hash,document_hash,environment,app_env,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',projectId,p.tenantId,workspaceId,p.userId,template.id,template.version,JSON.stringify(template),JSON.stringify(variables),parameters?JSON.stringify(parameters):null,planHash,createHash('sha256').update(canonical(document)).digest('hex'),this.environment,this.appEnv,at());}
  saveTemplate(p: Principal, input: z.infer<typeof studioTemplateInput>, previous?: StudioTemplate) {
    requireWorkspace(p, input.workspaceId); if (previous?.builtin) throw new AppError('FORBIDDEN', '基础模板请另存到工作空间后编辑。', 403);
    if (new Set(input.variables.map(v => v.key)).size !== input.variables.length || input.variables.some(v => v.defaultValue.length > v.maxLength)) throw new AppError('INVALID_TEMPLATE_VARIABLE', '变量编号重复或默认值过长，请重新核对。');
    const doc = this.validate(p, input.workspaceId, input.purpose, input.document), id = previous?.id || randomUUID(), version = (previous?.version || 0) + 1,controls=input.controls??previous?.controls,definition:StudioTemplate={ id, version, workspaceId: input.workspaceId, name: input.name, description: input.description, purpose: input.purpose, document: doc, variables: input.variables, licenseNote: input.licenseNote, builtin: false,...(controls?.length?{controls}:{}) },values=this.templateParameters(p,input.workspaceId,definition);
    const compiled=applyStudioTemplate(definition, Object.fromEntries(input.variables.map(v => [v.key, v.defaultValue || (v.required ? v.label.slice(0, v.maxLength) : '')])),false,values);this.validate(p,input.workspaceId,input.purpose,compiled);
    if (previous) this.repo.run('UPDATE studio_templates SET name=?,description=?,purpose=?,document=?,variables=?,controls=?,license_note=?,version=?,updated_at=? WHERE id=?', input.name, input.description, input.purpose, JSON.stringify(doc), JSON.stringify(input.variables),controls?.length?JSON.stringify(controls):null, input.licenseNote, version, at(), id);
    else this.repo.run('INSERT INTO studio_templates(id,tenant_id,workspace_id,name,description,purpose,document,variables,controls,license_note,version,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, p.tenantId, input.workspaceId, input.name, input.description, input.purpose, JSON.stringify(doc), JSON.stringify(input.variables),controls?.length?JSON.stringify(controls):null, input.licenseNote, version, this.environment, this.appEnv, at(), at());
    this.repo.run('INSERT INTO studio_template_versions VALUES (?,?,?,?)', id, version, JSON.stringify({ ...input, document: doc,...(controls?.length?{controls}:{}) }), at()); return id;
  }
  brand(p: Principal, id: string): StudioBrand { const r = this.repo.get<BrandRow>('SELECT * FROM studio_brand_kits WHERE id=? AND tenant_id=? AND environment=? AND app_env=?', id, p.tenantId, this.environment, this.appEnv); if (!r) throw new AppError('NOT_FOUND', '品牌素材包不存在。', 404); requireWorkspace(p, r.workspace_id); return { id: r.id, workspaceId: r.workspace_id, name: r.name, style: JSON.parse(r.style), licenseNote: r.license_note, version: r.version }; }
  saveBrand(p: Principal, input: z.infer<typeof studioBrandInput>, old?: StudioBrand) {
    requireWorkspace(p, input.workspaceId); if (input.style.logoAssetId) this.asset(p, input.workspaceId, input.style.logoAssetId, 'image/png'); const id = old?.id || randomUUID();
    if (old) this.repo.run('UPDATE studio_brand_kits SET name=?,style=?,license_note=?,version=version+1,updated_at=? WHERE id=?', input.name, JSON.stringify(input.style), input.licenseNote, at(), id);
    else this.repo.run('INSERT INTO studio_brand_kits(id,tenant_id,workspace_id,name,style,license_note,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', id, p.tenantId, input.workspaceId, input.name, JSON.stringify(input.style), input.licenseNote, this.environment, this.appEnv, at(), at()); return id;
  }
  plan(p: Principal, r: StudioProjectRow, version: number): StudioPlan {
    this.version(r, version); this.editable(r); const view = this.view(p, r), warnings = [...view.resourceProblems, '当前只生成静态分镜 PNG；真人驱动、人声配音和视频导出仍按后续模块接入。'];
    let captionsOK=true;warnings.push(studioCaptionPaginationNotice);try{inspectCaptionRendering(view.document);}catch(e){if(!(e instanceof AppError))throw e;captionsOK=false;warnings.push(e.message);}
    for (const s of view.document.speakers) { if (!s.avatarAssetId) warnings.push(s.name + '未选择形象参考，可继续制作纯文字画面。'); if (s.avatarCloneId || s.voiceCloneId) warnings.push(s.name + '使用的是已验收模拟参考，不是真实克隆模型。'); }
    if (!view.document.segments.some(s => s.text.trim())) warnings.push('工程尚未填写讲解文案。');
    const fingerprints = view.document.segments.map(s => { try { return this.fingerprint(p, r, view.document, s.id); } catch (e) { if (!(e instanceof AppError)) throw e; return e.code; } });
    const assetIds = new Set<string>(); for (const s of view.document.segments) { try { for (const a of this.resources(p, r.workspace_id, r.purpose, view.document, s.id).assets) assetIds.add(a.id); } catch (e) { if (!(e instanceof AppError)) throw e; } }
    let time = 0; const steps = view.document.segments.map(s => { const result = { id: s.id, title: s.title, text: s.text, startMs: view.document.timeline ? segmentTimelineStart(view.document,s.id) : time, durationMs: s.durationMs, readyFrame: view.frames.some(f => f.segmentId === s.id && f.status === 'ready') }; time += s.durationMs; return result; });if (view.document.timeline) time = view.durationMs;
    return { projectId: r.id, version, hash: createHash('sha256').update(canonical({ id: r.id, version, document: view.document, fingerprints })).digest('hex'), durationMs: time, segmentCount: steps.length, steps, assetIds: [...assetIds], warnings: [...new Set(warnings)], cost: { currency: 'CNY', estimatedMinor: null, reason: '尚未配置真实视频/配音服务报价；本次仅生成本地静态预览。' }, canPreview: captionsOK && !view.resourceProblems.length, purpose: 'storyboard_preview', realVideoAvailable: false };
  }
  image(p: Principal, workspaceId: string, reference: { assetId?: string; importMediaId?: string }) {
    let key: string;
    if (reference.assetId) { this.asset(p, workspaceId, reference.assetId, 'image/png'); key = this.repo.get<{ storage_key: string }>('SELECT u.storage_key FROM uploads u JOIN assets a ON a.upload_id=u.id WHERE a.id=?', reference.assetId)!.storage_key; }
    else { const media = this.imports.media(p, reference.importMediaId!); if (media.workspace_id !== workspaceId) throw new AppError('ASSET_SCOPE_MISMATCH', '图片不在当前工作空间。', 409); key = media.storage_key; }
    return readFileSync(path.join(this.dataDir, 'objects', key));
  }
}
