import {inspectCaptionRendering} from '../../../packages/media/src/caption-layout.js';
import {studioCaptionPaginationNotice} from '../../../packages/domain/src/studio-project.js';
import { createHash,randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { exportPlanInput,type ExportPlan,type StudioExport,type ExportArtifact } from '@digitalguide/contracts';
import { AppError,canonical,requireWorkspace,type Principal } from '@digitalguide/domain';
import { enableTimeline,timelineDuration } from '../../../packages/domain/src/timeline.js';
import { mediaTools } from '../../../packages/media/src/media-tools.js';
import { deliveryDimensions } from '../../../packages/domain/src/delivery.js';
import { timelineSubtitles } from '../../../packages/media/src/timeline-subtitles.js';
import { StudioService,type StudioProjectRow } from './studio-service.js';
import { TimelinePreviews } from './timeline-preview-service.js';
import { studioPackageSnapshot } from './studio-package-service.js';
import { packageMaxBytes } from '../../../packages/domain/src/portable-project.js';
export type ExportRequest = z.infer<typeof exportPlanInput>;
export interface ExportRow { id: string;project_id: string;tenant_id: string;workspace_id: string;actor_id: string;project_version: number;plan_hash: string;kind: ExportRequest['kind'];settings: string;start_ms: number;duration_ms: number;status: StudioExport['status'];attempts: number;lease_token: string|null;lease_until: string|null;progress: number;result: string|null;error_message: string|null;updated_at: string }
export interface ArtifactRow { id: string;export_id: string;kind: ExportArtifact['kind'];name: string;media_type: string;storage_key: string;size: number;sha256: string }
export class StudioExports {
  studio: StudioService;previews: TimelinePreviews;
  constructor(public repo: Repository,public environment: string,public appEnv: string,public dataDir: string,public root: string) { this.studio = new StudioService(repo,environment,appEnv,dataDir);this.previews = new TimelinePreviews(repo,environment,appEnv,dataDir,root); }
  row(p: Principal,id: string) { const row = this.repo.get<ExportRow>('SELECT * FROM studio_exports WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.environment,this.appEnv);if (!row) throw new AppError('NOT_FOUND','导出任务不存在或不在当前环境。',404);requireWorkspace(p,row.workspace_id);return row; }
  document(p: Principal,project: StudioProjectRow) { const doc = this.studio.view(p,project).document;if (!doc.timeline) enableTimeline(doc);return doc; }
  request(row: ExportRow): ExportRequest { return { version: row.project_version,kind: row.kind,settings: JSON.parse(row.settings),startMs: row.start_ms,durationMs: row.duration_ms }; }
  plan(p: Principal,project: StudioProjectRow,input: ExportRequest,validateCaptions=true): ExportPlan {
    this.studio.version(project,input.version);this.studio.editable(project);
    if (input.kind === 'package') return this.packagePlan(p,project,input);
    const view = this.studio.view(p,project),doc = this.document(p,project),durationMs = input.durationMs ?? timelineDuration(doc)-input.startMs;
    if (durationMs < 100 || durationMs > 10800000 || input.startMs+durationMs > timelineDuration(doc)) throw new AppError('INVALID_EXPORT_RANGE','请选择工程内至少0.1秒、最多三小时的输出范围。',409);
    const warnings = [...view.resourceProblems,'使用当前图片、视频和录音合成，不自动生成真人动作、口型或克隆语音。','输出尺寸不代表源图片具备同等细节；低分辨率素材会按布局放大。'];
    let configured = true,resources: ReturnType<StudioService['timelineResources']>|null = null;
    try { mediaTools(this.root);if(input.kind==='video'&&input.settings.burnSubtitles){if(validateCaptions)inspectCaptionRendering(doc,input.startMs,input.startMs+durationMs);warnings.push(studioCaptionPaginationNotice);} } catch (e) { if (!(e instanceof AppError)) throw e;configured = false;warnings.push(e.message); }
    try { resources = this.studio.timelineResources(p,project.workspace_id,project.purpose,doc); } catch (e) { if (!(e instanceof AppError)) throw e;warnings.push(e.message); }
    const sourceSpecs = resources?.assets.map(r => { const a = this.repo.asset(p,r.id);return { id: a.id,name: a.name,mediaType: a.mediaType,specs: a.specs }; }) || [];
    for (const m of resources?.media || []) { const a = this.studio.imports.media(p,m.id);sourceSpecs.push({ id: a.id,name: '导入文档参考图',mediaType: 'image/png',specs: { width: a.width,height: a.height } }); }
    if (input.kind === 'video' && input.settings.transparent) warnings.push('透明输出为 ProRes 4444 MOV，请使用兼容剪辑软件检查；普通网页播放器可能无法播放。'+(!input.settings.omitBackground ? '背景轨道仍会合成；需要透明底时请同时移除背景。' : '背景轨道已从本次输出中移除。'));
    if (!input.settings.burnSubtitles) warnings.push('视频不烧录字幕，另提供同一范围的 SRT/VTT；外挂字幕仅保留文字和时点。');
    if (!timelineSubtitles(doc,input.startMs,durationMs).length) warnings.push('当前范围没有启用字幕；SRT为空，VTT仅含文件头。');
    const dimensions = input.kind === 'video' ? deliveryDimensions(doc,input.settings) : null;
    const hash = createHash('sha256').update(canonical({ pipelineVersion: 'delivery-v1',projectId: project.id,version: input.version,doc: view.document,resources,kind: input.kind,settings: input.settings,startMs: input.startMs,durationMs })).digest('hex');
    return { projectId: project.id,version: input.version,hash,kind: input.kind,settings: input.settings,startMs: input.startMs,durationMs,width: dimensions?.width || null,height: dimensions?.height || null,fps: input.kind === 'video' ? input.settings.fps : null,codec: input.kind === 'video' ? input.settings.transparent ? 'prores_4444' : 'h264' : 'pcm_s16le',alpha: input.kind === 'video' && input.settings.transparent,estimatedBytes: Math.ceil(durationMs/1000*(input.kind === 'audio' ? 192000 : input.settings.transparent ? (input.settings.preset === 'uhd' ? 60000000 : 16000000)*(input.settings.fps/30) : input.settings.preset === 'uhd' ? 5000000 : 2000000)),warnings: [...new Set(warnings)],sourceSpecs,canExport: configured && resources !== null && !view.resourceProblems.length };
  }
  packagePlan(p: Principal,project: StudioProjectRow,input: ExportRequest): ExportPlan {
    const durationMs = timelineDuration(this.studio.view(p,project).document),warnings = ['开放工程包含脚本、分镜、多轨编辑和清单中的源素材；不是第三方剪辑软件原生工程。','不包含账号、供应商模型、克隆记录与原PPT/PDF处理绑定；导入后需按目标用途重新确认素材权限。'];
    if (input.startMs !== 0 || (input.durationMs !== null && input.durationMs !== durationMs)) throw new AppError('FULL_PROJECT_REQUIRED','开放工程包必须导出完整工程；如需片段，请先另存工程。',409);
    let snapshot: ReturnType<typeof studioPackageSnapshot>|null = null;
    try { snapshot = studioPackageSnapshot(this.studio,p,project); } catch (e) { if (!(e instanceof AppError)) throw e;warnings.push(e.message); }
    const estimatedBytes = snapshot ? snapshot.portable.assets.reduce((n,a) => n+a.size+512,Buffer.byteLength(JSON.stringify(snapshot.portable))+1024) : 0;
    if (estimatedBytes > packageMaxBytes) warnings.push('工程包预计超过1 GB，请拆分工程后导出。');
    if (snapshot) warnings.push(...snapshot.portable.nonPortable.map(n => n.reason));
    const fingerprintSnapshot=snapshot?{...snapshot,portable:{...snapshot.portable,assets:snapshot.portable.assets.map(a=>{const stable={...a};delete stable.synthetic;return stable;})}}:null;
    return { projectId: project.id,version: input.version,hash: createHash('sha256').update(canonical({ pipelineVersion: 'project-package-v1',projectId: project.id,version: input.version,snapshot:fingerprintSnapshot,settings: input.settings })).digest('hex'),kind: 'package',settings: input.settings,startMs: 0,durationMs,width: null,height: null,fps: null,codec: null,alpha: false,estimatedBytes,warnings,sourceSpecs: snapshot?.portable.assets.map(a => ({ id: a.id,name: a.name,mediaType: a.mediaType,specs: a.specs })) || [],canExport: snapshot !== null && estimatedBytes <= packageMaxBytes };
  }
  create(p: Principal,project: StudioProjectRow,input: ExportRequest & { planHash: string }) {
    const plan = this.plan(p,project,input);if (!plan.canExport || plan.hash !== input.planHash) throw new AppError('PLAN_CHANGED','规格、工程、素材或授权已变化，请重新审阅输出计划。',409);
    if (this.repo.get("SELECT id FROM studio_exports WHERE project_id=? AND status IN ('queued','rendering')",project.id)) throw new AppError('EXPORT_IN_PROGRESS','此工程已有导出任务，请等待或取消后再生成。',409);
    if (this.repo.get<{ n: number }>("SELECT count(*) n FROM studio_exports WHERE tenant_id=? AND environment=? AND app_env=? AND status IN ('queued','rendering')",p.tenantId,this.environment,this.appEnv)!.n >= 3) throw new AppError('QUOTA_EXCEEDED','组织当前环境同时最多三项导出任务，请等待已有任务。',409);
    const id = randomUUID(),at = new Date().toISOString();this.repo.run('INSERT INTO studio_exports(id,project_id,tenant_id,workspace_id,actor_id,project_version,plan_hash,kind,settings,start_ms,duration_ms,rights_confirmed_at,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,project.id,p.tenantId,project.workspace_id,p.userId,input.version,plan.hash,input.kind,JSON.stringify(input.settings),input.startMs,plan.durationMs,at,this.environment,this.appEnv,at,at);return id;
  }
  current(p: Principal,row: ExportRow) { const project = this.studio.project(p,row.project_id);try { const plan = this.plan(p,project,this.request(row),row.status!=='succeeded');return plan.canExport && plan.hash === row.plan_hash; } catch (e) { if (!(e instanceof AppError)) throw e;return false; } }
  view(p: Principal,row: ExportRow): StudioExport {
    const available = row.status === 'succeeded' && this.current(p,row),warnings = row.result ? (JSON.parse(row.result) as { warnings: string[] }).warnings : [];
    return { id: row.id,projectId: row.project_id,version: row.project_version,kind: row.kind,status: row.status,progress: row.progress,errorMessage: row.error_message,updatedAt: row.updated_at,warnings: [...warnings,...(row.status === 'succeeded' && !available ? ['来源、权限或工程版本已变化，旧输出不再提供下载，请重新生成。'] : [])],artifacts: this.repo.all<ArtifactRow>('SELECT * FROM studio_export_artifacts WHERE export_id=? ORDER BY rowid',row.id).map(a => ({ id: a.id,kind: a.kind,name: a.name,mediaType: a.media_type,size: a.size,sha256: a.sha256,url: available ? '/api/v1/studio/exports/'+row.id+'/files/'+a.id : null })) };
  }
}
