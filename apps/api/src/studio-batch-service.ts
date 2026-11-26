import { createHash,randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { batchPlanInput,batchRetryInput,type StudioDocument,type StudioTemplate,type TemplateParameters,type StudioBatchPlan,type StudioBatchSummary,type StudioBatch,type StudioBatchItem } from '@digitalguide/contracts';
import { AppError,canonical,requirePermission,hasPermission,requireWorkspace,type Principal } from '@digitalguide/domain';
import { parseBatchData } from '../../../packages/domain/src/batch-data.js';
import { applyStudioTemplate,remapStudioDocument } from '../../../packages/domain/src/studio-project.js';
import { timelineDuration } from '../../../packages/domain/src/timeline.js';
import { StudioService } from './studio-service.js';
import { StudioExports } from './studio-export-service.js';
import { studioSourceSnapshot } from './studio-source-snapshot.js';
import { mediaTools } from '../../../packages/media/src/media-tools.js';
export interface BatchRow { id: string;tenant_id: string;workspace_id: string;actor_id: string;name: string;template_id: string;template_version: number;template_snapshot: string;plan_hash:string;kind: 'video'|'audio';settings: string;max_in_flight: number;max_attempts: number;status: StudioBatchSummary['status'];version: number;rights_confirmed_at: string;updated_at: string }
export interface BatchItemRow { id: string;batch_id: string;position: number;name: string;variables: string;parameters:string|null;document: string|null;source_hash: string|null;status: StudioBatchItem['status'];version: number;attempts: number;project_id: string|null;export_id: string|null;error_code: string|null;error_message: string|null }
type PlanInput = z.infer<typeof batchPlanInput>;
const at = () => new Date().toISOString();
export class StudioBatches {
  studio: StudioService;exports: StudioExports;
  constructor(public repo: Repository,public environment: string,public appEnv: string,public dataDir: string,public root: string) { this.studio = new StudioService(repo,environment,appEnv,dataDir);this.exports = new StudioExports(repo,environment,appEnv,dataDir,root); }
  row(p: Principal,id: string) { const r = this.repo.get<BatchRow>('SELECT * FROM studio_batches WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.environment,this.appEnv);if (!r) throw new AppError('NOT_FOUND','批次不存在或不在当前环境。',404);requireWorkspace(p,r.workspace_id);return r; }
  items(r: BatchRow) { return this.repo.all<BatchItemRow>('SELECT * FROM studio_batch_items WHERE batch_id=? ORDER BY position',r.id); }
  item(r: BatchRow,id: string) { const row = this.repo.get<BatchItemRow>('SELECT * FROM studio_batch_items WHERE id=? AND batch_id=?',id,r.id);if (!row) throw new AppError('NOT_FOUND','此批次中没有该条目。',404);return row; }
  prepare(p: Principal,input: PlanInput) {
    input = { workspaceId: input.workspaceId,name: input.name,templateId: input.templateId,templateVersion: input.templateVersion,data: input.data,kind: input.kind,settings: input.settings,maxInFlight: input.maxInFlight,maxAttempts: input.maxAttempts };
    requireWorkspace(p,input.workspaceId);const template = this.studio.template(p,input.workspaceId,input.templateId);this.studio.version(template,input.templateVersion);
    const prepared = parseBatchData(input.data.format,input.data.content,template.controls).map(row => {
      let document: StudioDocument|null = null,sourceHash: string|null = null,error = row.error,durationMs = 0,parameters=row.parameters;
      if (!error) try { if(template.controls?.length||parameters!==undefined)parameters=this.studio.templateParameters(p,input.workspaceId,template,parameters);document = applyStudioTemplate(template,row.variables,false,parameters);durationMs = timelineDuration(document);if (durationMs < 100) throw new AppError('EMPTY_TIMELINE','时间线没有可输出区间，请修正模板。',409);sourceHash = studioSourceSnapshot(this.studio,p,input.workspaceId,template.purpose,document).hash; }
      catch (e) { error = e instanceof AppError ? e.message : '变量或模板内容无效，请核对必填项、长度和素材。';document = null; }
      return { ...row,...(parameters!==undefined?{parameters}:{}),error,document,sourceHash,durationMs };
    });
    const validCount = prepared.filter(r => !r.error).length,active = this.repo.get<{n: number}>('SELECT count(*) n FROM studio_projects WHERE tenant_id=? AND workspace_id=? AND archived=0',p.tenantId,input.workspaceId)!.n;
    const warnings = ['仅使用模板中的现有图像、视频和录音实际本地合成；替换文案不会自动生成新配音、口型或真人动作。','本批不调用付费或发布服务，外部费用为0；本地计算和存储仍有资源消耗。','固定模板版本，逐项保存结果。失败项需明确修正后重试，最多'+input.maxAttempts+'次；重试创建独立工程，旧结果保留。'];
    let configured = true;try { mediaTools(this.root); } catch (e) { if (!(e instanceof AppError)) throw e;configured = false;warnings.push(e.message); }
    if (active+validCount > 200) warnings.push('本空间剩余活动工程容量不足，请归档已有工程或缩小批次。');if (prepared.some(r => r.error)) warnings.push('存在无效数据行；确认后将保留为失败项，其余条目继续，失败项可单独修正。');
    const plan: StudioBatchPlan = { hash: createHash('sha256').update(canonical({ pipelineVersion: 'batch-v1',input,template,rows: prepared,configured })).digest('hex'),canStart: configured && validCount > 0 && active+validCount <= 200,total: prepared.length,validCount,invalidCount: prepared.length-validCount,templateName: template.name,templateVersion: template.version,estimatedBytes: Math.ceil(prepared.filter(r => !r.error).reduce((n,r) => n+r.durationMs/1000*(input.kind === 'audio' ? 192000 : input.settings.transparent ? input.settings.preset === 'uhd' ? 60000000 : 16000000 : input.settings.preset === 'uhd' ? 5000000 : 2000000),0)),externalCostMinor: 0,currency: 'CNY',warnings,items: prepared.map(r => ({ position: r.position,name: r.name,variables: r.variables,...(r.parameters!==undefined?{parameters:r.parameters}:{}),valid: !r.error,error: r.error,durationMs: r.durationMs })) };
    return { plan,template,prepared };
  }
  create(p: Principal,input: PlanInput & {planHash: string;acceptInvalidRows: boolean}) {
    requirePermission(p,'studio.write');const { plan,template,prepared } = this.prepare(p,input);if (!plan.canStart || plan.hash !== input.planHash) throw new AppError('BATCH_PLAN_CHANGED','数据、模板或来源已变化，或工程容量不足，请重新审阅批量计划。',409);
    if (plan.invalidCount && !input.acceptInvalidRows) throw new AppError('INVALID_ROWS_CONFIRM_REQUIRED','请明确确认保留失败行并继续其他条目，或先修正数据。',409);
    if (this.repo.get<{n: number}>("SELECT count(*) n FROM studio_batches WHERE tenant_id=? AND environment=? AND app_env=? AND status IN ('running','paused')",p.tenantId,this.environment,this.appEnv)!.n >= 3) throw new AppError('BATCH_LIMIT','组织当前环境最多三项未完成批次，请等待或取消已有批次。',409);
    const id = randomUUID(),now = at();this.repo.run('INSERT INTO studio_batches(id,tenant_id,workspace_id,actor_id,name,template_id,template_version,template_snapshot,input_format,input_content,kind,settings,max_in_flight,max_attempts,plan_hash,rights_confirmed_at,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,p.tenantId,input.workspaceId,p.userId,input.name,template.id,template.version,JSON.stringify(template),input.data.format,input.data.content,input.kind,JSON.stringify(input.settings),input.maxInFlight,input.maxAttempts,plan.hash,now,this.environment,this.appEnv,now,now);
    for (const row of prepared) { const itemId = randomUUID();this.repo.run('INSERT INTO studio_batch_items(id,batch_id,position,name,variables,parameters,document,source_hash,status,attempts,error_code,error_message,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',itemId,id,row.position,row.name,JSON.stringify(row.variables),row.parameters!==undefined?JSON.stringify(row.parameters):null,row.document ? JSON.stringify(row.document) : null,row.sourceHash,row.error ? 'failed' : 'queued',row.error ? 1 : 0,row.error ? 'INVALID_BATCH_ROW' : null,row.error,now);if (row.error) this.repo.run('INSERT INTO studio_batch_attempts VALUES (?,?,?,?,?,?,?,?,?)',itemId,1,null,null,'failed','INVALID_BATCH_ROW',row.error,now,now); }
    this.repo.event(p.tenantId,input.workspaceId,id,'studio.batch_created',this.environment);return id;
  }
  summary(p: Principal,r: BatchRow): StudioBatchSummary {
    const counts = { total: 0,queued: 0,rendering: 0,succeeded: 0,failed: 0,cancelled: 0 };let progress = 0;
    for (const item of this.items(r)) { counts.total++;counts[item.status]++;progress += item.status === 'queued' ? 0 : item.status === 'rendering' ? this.repo.get<{progress: number}>('SELECT progress FROM studio_exports WHERE id=?',item.export_id)?.progress || 0 : 1; }
    return { id: r.id,workspaceId: r.workspace_id,name: r.name,templateName: JSON.parse(r.template_snapshot).name,templateVersion: r.template_version,kind: r.kind,maxInFlight: r.max_in_flight,maxAttempts: r.max_attempts,status: r.status,version: r.version,counts,progress: counts.total ? progress/counts.total : 0,externalCostMinor: 0,canManage: hasPermission(p,'studio.write'),updatedAt: r.updated_at };
  }
  view(p: Principal,r: BatchRow): StudioBatch { return { ...this.summary(p,r),settings: JSON.parse(r.settings),rightsConfirmedAt: r.rights_confirmed_at,items: this.items(r).map(item => this.itemView(p,item)) }; }
  itemView(p: Principal,item: BatchItemRow): StudioBatchItem {
    let exported: StudioBatchItem['export'] = null;if (item.export_id) try { exported = this.exports.view(p,this.exports.row(p,item.export_id)); } catch (e) { if (!(e instanceof AppError)) throw e; }
    return { id: item.id,position: item.position,name: item.name,variables: JSON.parse(item.variables),...(item.parameters?{parameters:JSON.parse(item.parameters)}:{}),status: item.status,version: item.version,attempts: item.attempts,projectId: item.project_id,exportId: item.export_id,errorCode: item.error_code,errorMessage: item.error_message,export: exported,attemptHistory: this.repo.all<{attempt: number;projectId: string|null;exportId: string|null;status: string;errorMessage: string|null;startedAt: string;finishedAt: string|null}>('SELECT attempt,project_id AS projectId,export_id AS exportId,status,error_message AS errorMessage,started_at AS startedAt,finished_at AS finishedAt FROM studio_batch_attempts WHERE item_id=? ORDER BY attempt',item.id) };
  }
  reconcile(r: BatchRow) {
    for (const item of this.items(r).filter(i => i.status === 'rendering')) {
      const job = this.repo.get<{status: string;error_message: string|null}>('SELECT status,error_message FROM studio_exports WHERE id=?',item.export_id);
      if (!job || ['succeeded','failed','cancelled'].includes(job.status)) { const status = job?.status || 'failed',message = job?.error_message || (job ? null : '关联导出任务缺失，请联系管理员。'),code = status === 'failed' ? 'EXPORT_FAILED' : null,now = at();this.repo.run('UPDATE studio_batch_items SET status=?,version=version+1,error_code=?,error_message=?,updated_at=? WHERE id=? AND status=?',status,code,message,now,item.id,'rendering');this.repo.run('UPDATE studio_batch_attempts SET status=?,error_code=?,error_message=?,finished_at=? WHERE item_id=? AND attempt=?',status,code,message,now,item.id,item.attempts); }
    }
    const items = this.items(r);if (!items.some(i => ['queued','rendering'].includes(i.status)) && ['running','paused'].includes(r.status)) this.repo.run('UPDATE studio_batches SET status=?,version=version+1,updated_at=? WHERE id=?',items.some(i => i.status !== 'succeeded') ? 'completed_with_errors' : 'completed',at(),r.id);
  }
  control(p: Principal,r: BatchRow,version: number,action: 'pause'|'resume'|'cancel') {
    requirePermission(p,'studio.write');this.studio.version(r,version);if (!['running','paused'].includes(r.status)) throw new AppError('STATE_CONFLICT','批次已结束；失败项可单独修正重试。',409);
    if ((action === 'pause' && r.status !== 'running') || (action === 'resume' && r.status !== 'paused')) throw new AppError('STATE_CONFLICT','批次状态已变化，请刷新。',409);
    if (action === 'cancel') for (const item of this.items(r)) if (['queued','rendering'].includes(item.status)) this.cancelItem(p,r,item,item.version);
    this.repo.run('UPDATE studio_batches SET status=?,version=version+1,updated_at=? WHERE id=?',action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'cancelled',at(),r.id);
  }
  cancelItem(p: Principal,r: BatchRow,item: BatchItemRow,version: number) {
    requirePermission(p,'studio.write');this.studio.version(item,version);if (!['queued','rendering'].includes(item.status)) throw new AppError('STATE_CONFLICT','此条目已经结束。',409);
    const now = at();if (item.export_id) this.repo.run("UPDATE studio_exports SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status IN ('queued','rendering')",now,item.export_id);
    this.repo.run("UPDATE studio_batch_items SET status='cancelled',version=version+1,updated_at=? WHERE id=?",now,item.id);if (item.status === 'rendering' && item.attempts) this.repo.run("UPDATE studio_batch_attempts SET status='cancelled',finished_at=? WHERE item_id=? AND attempt=?",now,item.id,item.attempts);this.repo.event(p.tenantId,r.workspace_id,item.id,'studio.batch_item_cancelled',this.environment);
  }
  retry(p: Principal,r: BatchRow,item: BatchItemRow,input: z.infer<typeof batchRetryInput>) {
    requirePermission(p,'studio.write');this.studio.version(item,input.version);if (r.status === 'cancelled' || item.status !== 'failed' || item.attempts >= r.max_attempts) throw new AppError('RETRY_NOT_ALLOWED','只能重试未取消批次中的失败项，且不能超过次数上限；请新建批次。',409);
    const template = JSON.parse(r.template_snapshot);let doc: StudioDocument|null = null,source: string|null = null,error: string|null = null;
    const parameterInput=input.parameters??(item.parameters?JSON.parse(item.parameters) as TemplateParameters:undefined);let parameters=parameterInput;
    try { if(template.controls?.length||parameters!==undefined)parameters=this.studio.templateParameters(p,r.workspace_id,template,parameters);doc = applyStudioTemplate(template,input.variables,false,parameters);if (timelineDuration(doc) < 100) throw new AppError('EMPTY_TIMELINE','模板时间线为空，请新建批次。',409);source = studioSourceSnapshot(this.studio,p,r.workspace_id,template.purpose,doc).hash; } catch (e) { error = e instanceof AppError ? e.message : '变量不符合固定模板，请修正后重试。';doc = null; }
    const attempts = item.attempts+(error ? 1 : 0),now = at();this.repo.run('UPDATE studio_batch_items SET name=?,variables=?,parameters=?,document=?,source_hash=?,status=?,version=version+1,attempts=?,project_id=NULL,export_id=NULL,error_code=?,error_message=?,updated_at=? WHERE id=?',input.name,JSON.stringify(input.variables),parameters!==undefined?JSON.stringify(parameters):null,doc ? JSON.stringify(doc) : null,source,error ? 'failed' : 'queued',attempts,error ? 'INVALID_BATCH_ROW' : null,error,now,item.id);
    if (error) this.repo.run('INSERT INTO studio_batch_attempts VALUES (?,?,?,?,?,?,?,?,?)',item.id,attempts,null,null,'failed','INVALID_BATCH_ROW',error,now,now);if (r.status === 'completed_with_errors' && !error) this.repo.run("UPDATE studio_batches SET status='running',version=version+1,updated_at=? WHERE id=?",now,r.id);
  }
  dispatch(r: BatchRow,item: BatchItemRow) {
    const current = this.repo.get<BatchRow>('SELECT * FROM studio_batches WHERE id=?',r.id),fresh = this.item(r,item.id);if (current?.status !== 'running' || fresh.status !== 'queued') return false;
    const inFlight = this.repo.get<{n: number}>("SELECT count(*) n FROM studio_exports WHERE tenant_id=? AND environment=? AND app_env=? AND status IN ('queued','rendering')",r.tenant_id,this.environment,this.appEnv)!.n,batchInFlight = this.repo.get<{n: number}>("SELECT count(*) n FROM studio_batch_items WHERE batch_id=? AND status='rendering'",r.id)!.n;if (inFlight >= 3 || batchInFlight >= r.max_in_flight) return false;
    const owner = this.repo.principal(r.actor_id);requirePermission(owner,'studio.write');requireWorkspace(owner,r.workspace_id);const template = JSON.parse(r.template_snapshot) as StudioTemplate,document = JSON.parse(fresh.document!) as StudioDocument,parameters=fresh.parameters?JSON.parse(fresh.parameters) as TemplateParameters:undefined;
    if(template.controls?.length||parameters!==undefined){const checked=this.studio.templateParameters(owner,r.workspace_id,template,parameters),expected=applyStudioTemplate(template,JSON.parse(fresh.variables),false,checked);if(canonical(expected)!==canonical(document))throw new AppError('BATCH_PARAMETER_SNAPSHOT_CHANGED','参数与已审阅的批次文档不一致，请核对该项后重试。',409);}
    mediaTools(this.root);
    if (studioSourceSnapshot(this.studio,owner,r.workspace_id,template.purpose,document).hash !== fresh.source_hash) throw new AppError('BATCH_SOURCE_CHANGED','排队期间素材、授权或配置已变化，请审阅后单独重试。',409);
    if (this.repo.get<{n: number}>('SELECT count(*) n FROM studio_projects WHERE tenant_id=? AND workspace_id=? AND archived=0',r.tenant_id,r.workspace_id)!.n >= 200) throw new AppError('BATCH_PROJECT_QUOTA','工作空间已达200个活动工程，请先归档再重试。',409);
    const projectId = this.studio.create(owner,{ workspaceId: r.workspace_id,name: fresh.name,purpose: template.purpose,document: remapStudioDocument(document),variables: {} }),project = this.studio.project(owner,projectId),request = { version: 1,kind: r.kind,settings: JSON.parse(r.settings),startMs: 0,durationMs: null },plan = this.exports.plan(owner,project,request),exportId = this.exports.create(owner,project,{ ...request,planHash: plan.hash }),attempt = fresh.attempts+1,now = at();if(template.controls?.length)this.studio.recordTemplateInstantiation(owner,r.workspace_id,projectId,template,JSON.parse(fresh.variables),parameters,r.plan_hash,JSON.parse(project.document));
    this.repo.run("UPDATE studio_batch_items SET status='rendering',attempts=?,version=version+1,project_id=?,export_id=?,error_code=NULL,error_message=NULL,updated_at=? WHERE id=?",attempt,projectId,exportId,now,fresh.id);this.repo.run('INSERT INTO studio_batch_attempts VALUES (?,?,?,?,?,?,?,?,?)',fresh.id,attempt,projectId,exportId,'rendering',null,null,now,null);this.repo.run('UPDATE studio_batches SET last_dispatch_at=?,updated_at=? WHERE id=?',now,now,r.id);return true;
  }
  failQueued(r: BatchRow,item: BatchItemRow,error: unknown) {
    const fresh = this.item(r,item.id);if (fresh.status !== 'queued') return;const attempt = fresh.attempts+1,now = at(),message = error instanceof AppError ? error.message : '本地生成准备失败，请核对模板、工具和素材后重试。',code = error instanceof AppError ? error.code : 'BATCH_PREPARE_FAILED';
    this.repo.run("UPDATE studio_batch_items SET status='failed',attempts=?,version=version+1,error_code=?,error_message=?,updated_at=? WHERE id=?",attempt,code,message,now,item.id);this.repo.run('INSERT INTO studio_batch_attempts VALUES (?,?,?,?,?,?,?,?,?)',item.id,attempt,null,null,'failed',code,message,now,now);this.repo.run('UPDATE studio_batches SET last_dispatch_at=?,updated_at=? WHERE id=?',now,now,r.id);
  }
}
