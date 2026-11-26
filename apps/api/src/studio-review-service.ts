import { createHash,randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { studioDocumentInput,commentCreateInput,reviewCreateInput,reviewDecisionInput,type StudioComment,type StudioReview,type ProjectReviewSummary,type StudioDocument } from '@digitalguide/contracts';
import { AppError,canonical,requirePermission,hasPermission,requireWorkspace,type Principal } from '@digitalguide/domain';
import { timelineDuration } from '../../../packages/domain/src/timeline.js';
import { StudioService,type StudioProjectRow } from './studio-service.js';
import { StudioExports } from './studio-export-service.js';
import { studioSourceSnapshot } from './studio-source-snapshot.js';
export interface ReviewRow { id: string;project_id: string;project_version: number;stage: 'project'|'delivery';export_id: string|null;requester_id: string;reviewer_id: string;last_editor_id: string;snapshot_hash: string;status: StudioReview['status'];version: number;note: string;decision_at: string|null;invalidated_at: string|null;invalidation_reason: string|null;created_at: string }
interface CommentRow { id: string;project_id: string;project_version: number;author_id: string;parent_id: string|null;anchor: string;body: string;version: number;resolved_at: string|null;resolved_by: string|null;created_at: string }
const at = () => new Date().toISOString();
export class StudioReviews {
  studio: StudioService;exports: StudioExports;
  constructor(public repo: Repository,public environment: string,public appEnv: string,public dataDir: string,public root: string) { this.studio = new StudioService(repo,environment,appEnv,dataDir);this.exports = new StudioExports(repo,environment,appEnv,dataDir,root); }
  name(id: string) { return this.repo.get<{name: string}>('SELECT name FROM users WHERE id=?',id)?.name || '已停用成员'; }
  lastEditor(project: StudioProjectRow) { const editor = this.repo.get<{actor_id: string}>('SELECT actor_id FROM studio_project_versions WHERE project_id=? AND version=?',project.id,project.version);if (!editor) throw new AppError('PROJECT_VERSION_MISSING','工程修订记录缺失，请联系管理员。',409);return editor.actor_id; }
  team(p: Principal,workspaceId: string) {
    requireWorkspace(p,workspaceId);return this.repo.all<{id: string;name: string}>(`SELECT u.id,u.name FROM users u JOIN ${this.repo.membershipsSql()} m ON m.user_id=u.id WHERE m.tenant_id=? ORDER BY u.id`,p.tenantId).flatMap(user => { const member = this.repo.principal(user.id);return member.workspaceIds.includes(workspaceId) ? [{ ...user,canApprove: hasPermission(member,'studio.approve'),canComment: hasPermission(member,'studio.comment') }] : []; });
  }
  row(p: Principal,id: string) { const r = this.repo.get<ReviewRow>('SELECT r.* FROM studio_reviews r JOIN studio_projects p ON p.id=r.project_id WHERE r.id=? AND p.tenant_id=? AND p.environment=? AND p.app_env=?',id,p.tenantId,this.environment,this.appEnv);if (!r) throw new AppError('NOT_FOUND','审核记录不存在或不在当前环境。',404);this.studio.project(p,r.project_id);return r; }
  snapshot(p: Principal,project: StudioProjectRow,stage: 'project'|'delivery',exportId: string|null) {
    this.studio.editable(project);const doc = studioDocumentInput.parse(JSON.parse(project.document)),source = studioSourceSnapshot(this.studio,p,project.workspace_id,project.purpose,doc);let delivery: unknown = null;
    if (stage === 'delivery') {
      if (!exportId) throw new AppError('DELIVERY_REQUIRED','请先选择已完成的视频或音频成品。',409);const row = this.exports.row(p,exportId),view = this.exports.view(p,row);
      if (row.project_id !== project.id || row.project_version !== project.version || row.kind === 'package' || row.status !== 'succeeded' || !view.artifacts.length || view.artifacts.some(a => !a.url)) throw new AppError('DELIVERY_UNAVAILABLE','成品与当前工程版本不一致、尚未完成或来源已失效，请重新导出。',409);
      delivery = { id: row.id,planHash: row.plan_hash,kind: row.kind,files: view.artifacts.map(a => ({ id: a.id,sha256: a.sha256,size: a.size,kind: a.kind })) };
    }
    return createHash('sha256').update(canonical({ projectId: project.id,version: project.version,name: project.name,purpose: project.purpose,sourceHash: source.hash,stage,delivery })).digest('hex');
  }
  staleReason(p: Principal,r: ReviewRow): string|null {
    if (r.invalidated_at) return r.invalidation_reason || '工程已变化，请重新审核。';
    try {
      const project = this.studio.project(p,r.project_id);if (project.version !== r.project_version || project.archived) return '工程版本或归档状态已变化，请重新提交当前版本。';
      const reviewer = this.repo.principal(r.reviewer_id);requirePermission(reviewer,'studio.approve');requireWorkspace(reviewer,project.workspace_id);if (reviewer.tenantId !== p.tenantId || r.reviewer_id === r.requester_id || r.reviewer_id === this.lastEditor(project)) return '审核人与提交人或最后编辑人不独立，请重新指定。';
      if (this.snapshot(p,project,r.stage,r.export_id) !== r.snapshot_hash) return '源素材、配置或成品已变化，原审核不再适用。';return null;
    } catch (e) { return e instanceof AppError ? e.message : '工程、来源或审核权限无法核对，请重新提交审核。'; }
  }
  view(p: Principal,r: ReviewRow): StudioReview {
    const reason = this.staleReason(p,r),project = this.studio.project(p,r.project_id),pending = r.status === 'pending' && !reason;
    return { id: r.id,projectId: project.id,projectName: project.name,projectVersion: r.project_version,stage: r.stage,exportId: r.export_id,requesterId: r.requester_id,requesterName: this.name(r.requester_id),reviewerId: r.reviewer_id,reviewerName: this.name(r.reviewer_id),status: r.status,effectiveStatus: reason ? 'stale' : r.status,staleReason: reason,version: r.version,note: r.note,decisionAt: r.decision_at,canDecide: pending && p.userId === r.reviewer_id && hasPermission(p,'studio.approve'),canWithdraw: pending && (p.userId === r.requester_id || p.role === 'admin'),createdAt: r.created_at };
  }
  summary(p: Principal,project: StudioProjectRow): ProjectReviewSummary {
    const reviews = this.repo.all<ReviewRow>('SELECT * FROM studio_reviews WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50',project.id).map(r => this.view(p,r)),deliveries = this.repo.all<{id: string}>("SELECT id FROM studio_exports WHERE project_id=? AND project_version=? AND kind IN ('video','audio') AND status='succeeded' ORDER BY created_at DESC LIMIT 20",project.id,project.version).map(r => this.exports.view(p,this.exports.row(p,r.id))),lastEditor = this.lastEditor(project);
    return { currentUserId: p.userId,canComment: hasPermission(p,'studio.comment'),canRequest: hasPermission(p,'studio.write') && !project.archived,canApprove: hasPermission(p,'studio.approve'),reviews,deliveries,reviewers: this.team(p,project.workspace_id).filter(m => m.canApprove && m.id !== p.userId && m.id !== lastEditor),approvedDeliveryIds: reviews.filter(r => r.stage === 'delivery' && r.effectiveStatus === 'approved').map(r => r.exportId!) };
  }
  create(p: Principal,project: StudioProjectRow,input: z.infer<typeof reviewCreateInput>) {
    requirePermission(p,'studio.write');this.studio.version(project,input.version);const editor = this.lastEditor(project),reviewer = this.repo.principal(input.reviewerId);requirePermission(reviewer,'studio.approve');requireWorkspace(reviewer,project.workspace_id);
    if (reviewer.tenantId !== p.tenantId || reviewer.userId === p.userId || reviewer.userId === editor) throw new AppError('SELF_REVIEW_NOT_ALLOWED','审核人须与提交人、最后编辑人不同，并拥有本空间审核权限。',409);
    const hash = this.snapshot(p,project,input.stage,input.exportId);
    for (const existing of this.repo.all<ReviewRow>("SELECT * FROM studio_reviews WHERE project_id=? AND stage=? AND status='pending' AND invalidated_at IS NULL",project.id,input.stage)) { const reason = this.staleReason(p,existing);if (!reason) throw new AppError('REVIEW_IN_PROGRESS','该工程已有同类待审请求，请等待或撤回。',409);this.repo.run('UPDATE studio_reviews SET invalidated_at=?,invalidation_reason=?,version=version+1,updated_at=? WHERE id=?',at(),reason,at(),existing.id); }
    if (this.repo.get<{n: number}>('SELECT count(*) n FROM studio_reviews WHERE project_id=?',project.id)!.n >= 500) throw new AppError('REVIEW_LIMIT','此工程的审核记录已达本地上限，请归档并创建新工程。',409);
    const id = randomUUID(),now = at();this.repo.run('INSERT INTO studio_reviews(id,project_id,project_version,stage,export_id,requester_id,reviewer_id,last_editor_id,snapshot_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,project.id,project.version,input.stage,input.exportId,p.userId,reviewer.userId,editor,hash,now,now);return id;
  }
  decide(p: Principal,r: ReviewRow,input: z.infer<typeof reviewDecisionInput>) {
    requirePermission(p,'studio.approve');this.studio.version(r,input.version);if (p.userId !== r.reviewer_id) throw new AppError('FORBIDDEN','仅指定审核人可以审批，请联系提交人重新指定。',403);
    if (r.status !== 'pending') throw new AppError('STATE_CONFLICT','审核已处理，请刷新查看结果。',409);const reason = this.staleReason(p,r);if (reason) throw new AppError('REVIEW_STALE',reason,409);
    const now = at();this.repo.run('UPDATE studio_reviews SET status=?,version=version+1,note=?,decision_at=?,updated_at=? WHERE id=?',input.decision === 'approve' ? 'approved' : 'changes_requested',input.note,now,now,r.id);
  }
  withdraw(p: Principal,r: ReviewRow,version: number) {
    this.studio.version(r,version);if (!hasPermission(p,'studio.write') || (r.requester_id !== p.userId && p.role !== 'admin')) throw new AppError('FORBIDDEN','仅提交人或管理员可以撤回待审请求。',403);if (r.status !== 'pending') throw new AppError('STATE_CONFLICT','只能撤回尚未处理的审核。',409);
    this.repo.run("UPDATE studio_reviews SET status='withdrawn',version=version+1,updated_at=? WHERE id=?",at(),r.id);
  }
  approvedDelivery(p: Principal,exportId: string) {
    const job = this.exports.row(p,exportId),reviews = this.repo.all<ReviewRow>("SELECT * FROM studio_reviews WHERE export_id=? AND stage='delivery' AND status='approved' ORDER BY decision_at DESC",job.id);return reviews.find(r => !this.staleReason(p,r)) || null;
  }
  comment(_p: Principal,project: StudioProjectRow,id: string) { const r = this.repo.get<CommentRow>('SELECT * FROM studio_comments WHERE id=? AND project_id=?',id,project.id);if (!r) throw new AppError('NOT_FOUND','评论不存在。',404);return r; }
  commentView(p: Principal,project: StudioProjectRow,r: CommentRow): StudioComment { return { id: r.id,projectVersion: r.project_version,authorId: r.author_id,authorName: this.name(r.author_id),parentId: r.parent_id,anchor: JSON.parse(r.anchor),body: r.body,version: r.version,resolvedAt: r.resolved_at,resolvedBy: r.resolved_by,createdAt: r.created_at,currentVersion: r.project_version === project.version,canResolve: hasPermission(p,'studio.comment') && (p.userId === r.author_id || hasPermission(p,'studio.approve')) }; }
  createComment(p: Principal,project: StudioProjectRow,input: z.infer<typeof commentCreateInput>) {
    requirePermission(p,'studio.comment');const revision = this.repo.get<{document: string}>('SELECT document FROM studio_project_versions WHERE project_id=? AND version=?',project.id,input.version);if (!revision) throw new AppError('VERSION_NOT_FOUND','评论目标版本不存在，请刷新后重新定位。',409);
    const doc = JSON.parse(revision.document) as StudioDocument,anchor = input.anchor,clip = doc.timeline?.tracks.flatMap(t => t.clips).find(c => c.id === anchor.clipId);
    if ((anchor.segmentId && !doc.segments.some(s => s.id === anchor.segmentId)) || (anchor.clipId && !clip) || (clip && anchor.segmentId && clip.segmentId !== anchor.segmentId) || (anchor.timeMs !== null && anchor.timeMs > timelineDuration(doc))) throw new AppError('INVALID_COMMENT_ANCHOR','评论位置不属于该工程版本，请重新选择分镜、片段或时间点。',409);
    if (input.parentId && this.comment(p,project,input.parentId).project_version !== input.version) throw new AppError('COMMENT_VERSION_MISMATCH','回复需要保持原评论版本，不能跨版本拼接讨论。',409);
    if (this.repo.get<{n: number}>('SELECT count(*) n FROM studio_comments WHERE project_id=?',project.id)!.n >= 1000) throw new AppError('COMMENT_LIMIT','此工程已达1000条评论，请归档讨论后新建工程。',409);
    const id = randomUUID();this.repo.run('INSERT INTO studio_comments(id,project_id,project_version,author_id,parent_id,anchor,body,created_at) VALUES (?,?,?,?,?,?,?,?)',id,project.id,input.version,p.userId,input.parentId,JSON.stringify(anchor),input.body,at());return id;
  }
  resolveComment(p: Principal,project: StudioProjectRow,r: CommentRow,version: number,resolved: boolean) {
    requirePermission(p,'studio.comment');this.studio.version(r,version);if (!this.commentView(p,project,r).canResolve) throw new AppError('FORBIDDEN','仅作者或审核人员可以处理评论。',403);this.repo.run('UPDATE studio_comments SET resolved_at=?,resolved_by=?,version=version+1 WHERE id=?',resolved ? at() : null,resolved ? p.userId : null,r.id);
  }
}
