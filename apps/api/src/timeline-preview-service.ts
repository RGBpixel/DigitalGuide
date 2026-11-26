import {inspectCaptionRendering} from '../../../packages/media/src/caption-layout.js';
import {studioPreviewRendererPolicy,studioCaptionPaginationNotice} from '../../../packages/domain/src/studio-project.js';
import {isVideoMediaType} from '@digitalguide/contracts';
import { randomUUID,createHash } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import type { StudioDocument,TimelinePlan,TimelineRenderJob } from '@digitalguide/contracts';
import { AppError,canonical,requireWorkspace,type Principal } from '@digitalguide/domain';
import { timelineDuration } from '../../../packages/domain/src/timeline.js';
import { mediaTools } from '../../../packages/media/src/media-tools.js';
import { StudioService,type StudioProjectRow } from './studio-service.js';
import type { VideoKeySource } from '../../../packages/media/src/video-source.js';
export interface TimelineJobRow { id: string;project_id: string;tenant_id: string;workspace_id: string;actor_id: string;project_version: number;plan_hash: string;start_ms: number;duration_ms: number;status: TimelineRenderJob['status'];attempts: number;lease_token: string|null;lease_until: string|null;progress: number;video_key: string|null;audio_key: string|null;result: string|null;error_message: string|null;updated_at: string }
export class TimelinePreviews {
  studio: StudioService;
  constructor(public repo: Repository,public environment: string,public appEnv: string,public dataDir: string,public root: string) { this.studio = new StudioService(repo,environment,appEnv,dataDir); }
  row(p: Principal,id: string) { const row = this.repo.get<TimelineJobRow>('SELECT * FROM studio_timeline_previews WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.environment,this.appEnv);if (!row) throw new AppError('NOT_FOUND','时间线预览不存在。',404);requireWorkspace(p,row.workspace_id);return row; }
  plan(p: Principal,project: StudioProjectRow,version: number,startMs: number,durationMs: number): TimelinePlan {
    this.studio.version(project,version);this.studio.editable(project);const view = this.studio.view(p,project),doc = view.document;
    if (!doc.timeline) throw new AppError('TIMELINE_NOT_ENABLED','请先在工程中启用专业时间线并保存。',409);
    if (startMs+durationMs > timelineDuration(doc)) throw new AppError('INVALID_PREVIEW_RANGE','预览区间超出工程时长，请调整起点或时长。',409);
    const warnings = [...view.resourceProblems,'仅生成最长边 640、15 帧/秒的本地预览；角色是静态参考，未执行真人驱动或克隆。','WAV 按原始录音或合成测试素材混合，不会把台词自动变成人声；变速同时改变原录音音高。'];let configured = true;
    try { mediaTools(this.root);inspectCaptionRendering(doc,startMs,startMs+durationMs);warnings.push(studioCaptionPaginationNotice); } catch (e) { if (!(e instanceof AppError)) throw e;configured = false;warnings.push(e.message); }
    let resources: unknown = null;try { resources = this.studio.timelineResources(p,project.workspace_id,project.purpose,doc); } catch (e) { if (!(e instanceof AppError)) throw e;warnings.push(e.message); }
    const scale = Math.min(640/doc.canvas.width,640/doc.canvas.height),hash = createHash('sha256').update(canonical({ renderer:studioPreviewRendererPolicy,id: project.id,version,doc,resources,startMs,durationMs })).digest('hex');
    return { projectId: project.id,version,hash,startMs,durationMs,width: Math.max(2,Math.round(doc.canvas.width*scale/2)*2),height: Math.max(2,Math.round(doc.canvas.height*scale/2)*2),fps: 15,clipCount: doc.timeline.tracks.flatMap(t => t.clips).filter(c => c.startMs < startMs+durationMs && c.startMs+c.durationMs > startMs).length,warnings: [...new Set(warnings)],canRender: configured && !view.resourceProblems.length && resources !== null,estimatedMinor: null,mode: 'local_reference_preview' };
  }
  create(p: Principal,project: StudioProjectRow,input: { version: number;startMs: number;durationMs: number;planHash: string }) {
    const plan = this.plan(p,project,input.version,input.startMs,input.durationMs);if (!plan.canRender || plan.hash !== input.planHash) throw new AppError('PLAN_CHANGED','计划、素材或授权已变化，请重新审阅。',409);
    if (this.repo.get("SELECT id FROM studio_timeline_previews WHERE project_id=? AND status IN ('queued','rendering')",project.id)) throw new AppError('PREVIEW_IN_PROGRESS','此工程已有时间线预览，请等待或取消。',409);
    if (this.repo.get<{n: number}>("SELECT count(*) n FROM studio_timeline_previews WHERE tenant_id=? AND status IN ('queued','rendering')",p.tenantId)!.n >= 5) throw new AppError('QUOTA_EXCEEDED','组织同时最多五项时间线预览，请等待现有任务。',409);
    const id = randomUUID(),at = new Date().toISOString();this.repo.run('INSERT INTO studio_timeline_previews(id,project_id,tenant_id,workspace_id,actor_id,project_version,plan_hash,start_ms,duration_ms,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,project.id,p.tenantId,project.workspace_id,p.userId,input.version,input.planHash,input.startMs,input.durationMs,this.environment,this.appEnv,at,at);return id;
  }
  current(p: Principal,row: TimelineJobRow) { const project = this.studio.project(p,row.project_id);try { const plan = this.plan(p,project,row.project_version,row.start_ms,row.duration_ms);return plan.canRender && plan.hash === row.plan_hash; } catch (e) { if (!(e instanceof AppError)) throw e;return false; } }
  view(p: Principal,row: TimelineJobRow): TimelineRenderJob {
    const data = row.result ? JSON.parse(row.result) as { width: number;height: number;fps: number;sha256: string;size: number;warnings: string[] } : null,available = row.status === 'succeeded' && this.current(p,row);
    return { id: row.id,projectId: row.project_id,version: row.project_version,status: row.status,startMs: row.start_ms,durationMs: row.duration_ms,progress: row.progress,errorMessage: row.error_message,videoUrl: available ? '/api/v1/studio/timeline-previews/'+row.id+'/video' : null,audioUrl: available ? '/api/v1/studio/timeline-previews/'+row.id+'/audio' : null,width: data?.width || null,height: data?.height || null,fps: data?.fps || null,sha256: data?.sha256 || null,size: data?.size || null,warnings: [...(data?.warnings || []),...(row.status === 'succeeded' && !available ? ['来源或授权已变化，旧预览不可用，请重新生成。'] : [])],updatedAt: row.updated_at,simulatedAvatar: true };
  }
  files(p: Principal,doc: StudioDocument,workspaceId: string) {
    const images: Record<string,string> = {},audio: Record<string,string> = {},videos: Record<string,VideoKeySource> = {};
    const asset = (id: string,type: 'image/png'|'audio/wav') => { this.studio.asset(p,workspaceId,id,type);return this.repo.get<{storage_key: string}>('SELECT u.storage_key FROM uploads u JOIN assets a ON a.upload_id=u.id WHERE a.id=?',id)!.storage_key; };
    for (const t of doc.timeline?.tracks || []) for (const c of t.clips) if (c.source.type === 'asset') { const a = this.studio.timelineAsset(p,workspaceId,c.source.assetId,['voice','music'].includes(t.type));if (isVideoMediaType(a.mediaType)) videos[a.id] = { key: this.repo.get<{storage_key: string}>('SELECT u.storage_key FROM uploads u JOIN assets a ON a.upload_id=u.id WHERE a.id=?',a.id)!.storage_key,specs: a.specs };else if (['voice','music'].includes(t.type)) audio[c.source.assetId] = asset(c.source.assetId,'audio/wav');else images['a:'+c.source.assetId] = asset(c.source.assetId,'image/png'); }
    if (doc.brand.logoAssetId) images['a:'+doc.brand.logoAssetId] = asset(doc.brand.logoAssetId,'image/png');
    const usedSpeakers = new Set([...doc.segments.map(s => s.speakerId),...(doc.timeline?.tracks.flatMap(t => t.clips.map(c => c.speakerId)) || [])]);
    for (const s of doc.speakers.filter(s => usedSpeakers.has(s.id))) { if (s.avatarAssetId) images['a:'+s.avatarAssetId] = asset(s.avatarAssetId,'image/png');if (s.voiceAssetId) audio[s.voiceAssetId] = asset(s.voiceAssetId,'audio/wav'); }
    for (const s of doc.segments) for (const e of s.elements) if (e.type === 'image') { if (e.assetId) images['a:'+e.assetId] = asset(e.assetId,'image/png');else { const m = this.studio.imports.media(p,e.importMediaId!);if (m.workspace_id !== workspaceId) throw new AppError('ASSET_SCOPE_MISMATCH','图片不在当前空间。',409);images['m:'+m.id] = m.storage_key; } }
    return { images,audio,videos };
  }
}
