import {assertProgrammeSource} from '../../domain/src/live-guest-programme.js';
import {assertRecoveryAccess} from '../../recovery/src/guard.js';
import {assertSqliteDataDirectory} from './store-selection.js';
import {effectiveMemberships} from '../../enterprise/src/membership-sql.js';
import {assertLiveRecordingAnswer} from '../../domain/src/live-answer-origin.js';
import {assertAeMediaSource,type AeMediaRow} from './ae-media-origin.js';
import {assertLivePuppet} from '../../domain/src/live-puppet.js';
import {assertLiveRecordingSpeech} from '../../domain/src/live-speech.js';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { AppError, requireWorkspace,requirePermission,assertUsableAsset,canonical,type Principal } from '@digitalguide/domain';
import type { Asset, Job, Profile,ContentSourceReference } from '@digitalguide/contracts';
import {recordingSnapshot,mediaProcessingPayload,mediaProcessingReport,semanticSourceSnapshot,transcriptionSnapshot,transcriptionReview,transcriptionAnalysis,liveRecordingGuard,studioDocumentInput,type MediaProcessingPayload} from '@digitalguide/contracts';

export class Repository {
  db: DatabaseSync;
  identityFingerprints:ReadonlyMap<string,string>=new Map();
  aeCatalogHost?:{aeConfigFile?:string};
  constructor(public dataDir: string, root = process.cwd(),public context?:Pick<Principal,'environment'|'appEnv'>,recovery?:{recoveryValidationOnly?:boolean}) {
    assertSqliteDataDirectory(dataDir);
    assertRecoveryAccess(dataDir,{...context,recoveryValidationOnly:recovery?.recoveryValidationOnly});
    mkdirSync(dataDir, { recursive: true }); mkdirSync(path.join(dataDir, 'objects'), { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'digitalguide.sqlite'));
    // The journal switch also needs to wait for locks held by other starting hosts.
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const directory = path.join(root, 'migrations', 'sqlite');
    for (const name of readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) {
      this.transaction(() => {
        if (!this.get('SELECT name FROM schema_migrations WHERE name=?', name)) {
          this.db.exec(readFileSync(path.join(directory, name), 'utf8'));
          this.run('INSERT INTO schema_migrations VALUES (?,?)', name, new Date().toISOString());
        }
      });
    }
  }
  get<T>(sql: string, ...values: SQLInputValue[]): T | undefined { return this.db.prepare(sql).get(...values) as T | undefined; }
  all<T>(sql: string, ...values: SQLInputValue[]): T[] { return this.db.prepare(sql).all(...values) as T[]; }
  run(sql: string, ...values: SQLInputValue[]) { return this.db.prepare(sql).run(...values); }
  membershipsSql(){return this.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='enterprise_member_directory'")?effectiveMemberships(this.context?.environment,this.context?.appEnv):'memberships';}
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  principal(userId: string): Principal {
    const row = this.get<{ tenant_id: string; role: Principal['role']; workspace_ids: string }>(`SELECT * FROM ${this.membershipsSql()} WHERE user_id=?`, userId);
    if (!row) throw new AppError('AUTH_REQUIRED', '登录已失效，请重新登录。', 401);
    if(this.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='enterprise_member_controls'")&&this.get("SELECT 1 FROM enterprise_member_controls WHERE user_id=? AND tenant_id=? AND environment=? AND app_env=? AND status='suspended'",userId,row.tenant_id,this.context?.environment??'mock',this.context?.appEnv??'development'))throw new AppError('AUTH_REQUIRED','账户已停用，请联系管理员。',401);
    return { userId, tenantId: row.tenant_id, role: row.role, workspaceIds: JSON.parse(row.workspace_ids),...this.context };
  }
  audit(p: Principal, workspaceId: string, action: string, resourceId: string, requestId: string, outcome = 'confirmed') {
    this.run('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)', randomUUID(), p.tenantId, workspaceId, p.userId, action, resourceId, outcome, requestId, new Date().toISOString());
  }
  event(tenantId: string, workspaceId: string, aggregateId: string, type: string, environment: string) {
    this.run('INSERT INTO outbox_events VALUES (?,?,?,?,?,?,?,?,NULL)', randomUUID(), tenantId, workspaceId, aggregateId, type, environment, '{}', new Date().toISOString());
  }
  contentReferences(p:Principal,workspaceId:string,environment:string,appEnv:string,refs:ContentSourceReference[],seen=new Set<string>()) {
    requireWorkspace(p,workspaceId);
    if(!Array.isArray(refs)||refs.length>10||new Set(refs.map(r=>r.id)).size!==refs.length)throw new AppError('CONTENT_REFERENCES_INVALID','脚本来源引用重复或超过十项。',409);
    for(const ref of refs){
      const source=this.get<{workspace_id:string;version:number;text:string;text_sha256:string;expires_at:string;withdrawn:number;kind:string;origin:string}>('SELECT * FROM studio_content_sources WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',ref.id,p.tenantId,environment,appEnv);
      if(!source||source.workspace_id!==workspaceId)throw new AppError('CONTENT_SOURCE_UNAVAILABLE','脚本来源不存在或不在当前工作空间。',409);
      if(source.withdrawn||source.expires_at<=new Date().toISOString()||source.version!==ref.version||source.text_sha256!==ref.textSHA256||createHash('sha256').update(source.text).digest('hex')!==ref.textSHA256)throw new AppError('CONTENT_SOURCE_UNAVAILABLE','脚本来源已撤回、到期或版本/正文发生变化，请核对当前来源。',409);
      if(source.kind==='video'){
        const origin=JSON.parse(source.origin) as {assetId:string;assetVersion:number;assetSHA256:string},asset=this.asset(p,origin.assetId,seen);assertUsableAsset(asset);
        if(asset.workspaceId!==workspaceId||asset.version!==origin.assetVersion||asset.sha256!==origin.assetSHA256)throw new AppError('CONTENT_SOURCE_UNAVAILABLE','人工转写原视频的版本或范围已变化。',409);
        this.transcriptionContentSource(p,ref.id,seen);
      }
    }
  }
  contentOrigin(p:Principal,workspaceId:string,environment:string,appEnv:string,id:string,seen=new Set<string>()):ContentSourceReference[] {
    this.environment(p,environment,appEnv);
    const origin=this.get<{workspace_id:string;source_refs:string;expires_at:string|null}>('SELECT workspace_id,source_refs,expires_at FROM studio_content_origins WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,environment,appEnv);
    if(!origin||origin.workspace_id!==workspaceId)throw new AppError('CONTENT_ORIGIN_UNAVAILABLE','脚本来源凭据不存在或不在当前空间。',409);
    if(origin.expires_at&&origin.expires_at<=new Date().toISOString())throw new AppError('CONTENT_SOURCE_EXPIRED','脚本继承的来源使用期限已到期。',409);
    const refs=JSON.parse(origin.source_refs) as ContentSourceReference[];this.contentReferences(p,workspaceId,environment,appEnv,refs,seen);return refs;
  }
  recordingSource(p:Principal,workspaceId:string,environment:string,appEnv:string,id:string,seen=new Set<string>()) {
    this.environment(p,environment,appEnv);
    requireWorkspace(p,workspaceId);
    const r=this.get<{workspace_id:string;snapshot:string;expires_at:string;withdrawn_at:string|null}>('SELECT workspace_id,snapshot,expires_at,withdrawn_at FROM studio_recordings WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,environment,appEnv);
    if(!r||r.workspace_id!==workspaceId)throw new AppError('RECORDING_UNAVAILABLE','录制来源不存在或不在当前空间/环境。',409);
    const snapshot=recordingSnapshot.parse(JSON.parse(r.snapshot)),at=new Date().toISOString();
    if(r.withdrawn_at||r.expires_at<=at||snapshot.expiresAt<=at)throw new AppError('RECORDING_RIGHTS_UNAVAILABLE','录制用途已撤回或到期，请核对当前授权。',409);
    this.contentReferences(p,workspaceId,environment,appEnv,snapshot.sourceRefs,seen);return snapshot;
  }
  environment(p:Principal,environment:string,appEnv:string){if(p.environment&&p.environment!==environment||p.appEnv&&p.appEnv!==appEnv)throw new AppError('ASSET_ENVIRONMENT_MISMATCH','派生素材不属于当前服务环境，请切换原环境。',409);}
  transcriptionSource(p:Principal,id:string,seen=new Set<string>(),verifyAnalysis=true){
    const key='transcription:'+id;if(seen.has(key)||seen.size>=16)throw new AppError('ASSET_DEPENDENCY_CYCLE','转写来源链包含循环或超过深度限制。',409);
    const r=this.get<{tenant_id:string;workspace_id:string;snapshot:string;input_hash:string;withdrawn_at:string|null;environment:string;app_env:string;analysis:string|null;analysis_hash:string|null}>('SELECT tenant_id,workspace_id,snapshot,input_hash,withdrawn_at,environment,app_env'+(verifyAnalysis?',analysis,analysis_hash':'')+' FROM studio_transcriptions WHERE id=? AND tenant_id=?',id,p.tenantId);if(!r)throw new AppError('TRANSCRIPTION_UNAVAILABLE','转写来源不存在或不在当前组织。',409);this.environment(p,r.environment,r.app_env);requireWorkspace(p,r.workspace_id);const snapshot=transcriptionSnapshot.parse(JSON.parse(r.snapshot));
    if(r.withdrawn_at||snapshot.expiresAt<=new Date().toISOString()||snapshot.rights.expiresAt<=new Date().toISOString()||createHash('sha256').update(canonical(snapshot)).digest('hex')!==r.input_hash)throw new AppError('TRANSCRIPTION_UNAVAILABLE','转写用途已撤回、到期或快照已变化。',409);
    if(r.analysis&&createHash('sha256').update(canonical(JSON.parse(r.analysis))).digest('hex')!==r.analysis_hash)throw new AppError('TRANSCRIPTION_RESULT_CHANGED','转写原始结果摘要不符，请重新识别或人工录入。',409);
    const a=this.asset(p,snapshot.source.id,new Set(seen).add(key));assertUsableAsset(a);if(a.workspaceId!==r.workspace_id||a.version!==snapshot.source.version||a.sha256!==snapshot.source.sha256||a.size!==snapshot.source.size||a.mediaType!==snapshot.source.mediaType||canonical(a.specs)!==canonical(snapshot.source.specs))throw new AppError('TRANSCRIPTION_SOURCE_CHANGED','转写原视频的版本、规格或字节摘要已变化，请重新选择。',409);return snapshot;
  }
  transcriptionContentSource(p:Principal,sourceId:string,seen=new Set<string>()){
    const r=this.get<{transcription_id:string;review_version:number;review_hash:string;review:string|null;input_hash:string|null}>('SELECT s.transcription_id,s.review_version,s.review_hash,v.review,t.input_hash FROM studio_transcription_sources s LEFT JOIN studio_transcription_revisions v ON v.transcription_id=s.transcription_id AND v.version=s.review_version LEFT JOIN studio_transcriptions t ON t.id=s.transcription_id WHERE s.source_id=?',sourceId);if(!r){const source=this.get<{origin:string}>('SELECT origin FROM studio_content_sources WHERE id=?',sourceId);if(source&&JSON.parse(source.origin).mode==='reviewed_video_asr')throw new AppError('TRANSCRIPTION_REVIEW_MISSING','视频校对来源的确认凭据缺失，请重新核对。',409);return;}if(!r.review||!r.input_hash)throw new AppError('TRANSCRIPTION_REVIEW_MISSING','视频校对来源的修订凭据缺失。',409);this.transcriptionSource(p,r.transcription_id,seen);const review=transcriptionReview.parse(JSON.parse(r.review)),reviewHash=createHash('sha256').update(canonical({inputHash:r.input_hash,review})).digest('hex'),source=this.get<{text_sha256:string}>('SELECT text_sha256 FROM studio_content_sources WHERE id=?',sourceId);if(reviewHash!==r.review_hash||createHash('sha256').update(review.segments.map(s=>s.text).join('\n')).digest('hex')!==source?.text_sha256)throw new AppError('TRANSCRIPTION_REVIEW_CHANGED','已确认校对稿的来源摘要不符，请重新核对。',409);
  }
  liveRecordingSource(p:Principal,id:string,seen=new Set<string>()){
    const r=this.get<{tenant_id:string;workspace_id:string;environment:string;app_env:string;source_guard:string;source_guard_hash:string;withdrawn_at:string|null}>('SELECT * FROM live_recordings WHERE id=? AND tenant_id=?',id,p.tenantId);
    if(!r)throw new AppError('LIVE_RECORDING_UNAVAILABLE','模拟节目归档来源不存在或不在当前组织。',409);this.environment(p,r.environment,r.app_env);requireWorkspace(p,r.workspace_id);
    const guard=liveRecordingGuard.parse(JSON.parse(r.source_guard));if(r.withdrawn_at||guard.expiresAt<=new Date().toISOString()||createHash('sha256').update(canonical(guard)).digest('hex')!==r.source_guard_hash)throw new AppError('LIVE_RECORDING_RIGHTS','模拟节目归档用途已撤回、到期或来源摘要不符。',409);
    for(const a of guard.sourceAssets){const current=this.asset(p,a.id,seen);assertUsableAsset(current);if(current.workspaceId!==r.workspace_id||current.version!==a.version||current.sha256!==a.sha256)throw new AppError('LIVE_RECORDING_SOURCE_CHANGED','归档继承的素材范围或版本已变化，请重新核对来源。',409);}
    for(const e of guard.exports){
      const project=this.get<{tenant_id:string;workspace_id:string;environment:string;app_env:string;version:number;archived:number;document:string}>('SELECT * FROM studio_projects WHERE id=?',e.projectId),output=this.get<{project_id:string;project_version:number;status:string;plan_hash:string}>('SELECT * FROM studio_exports WHERE id=?',e.id),review=this.get<{project_id:string;project_version:number;export_id:string;status:string;snapshot_hash:string;invalidated_at:string|null;reviewer_id:string;requester_id:string;last_editor_id:string}>('SELECT * FROM studio_reviews WHERE id=?',e.reviewId),artifact=this.get<{export_id:string;sha256:string;size:number}>('SELECT * FROM studio_export_artifacts WHERE id=?',e.artifactId);
      if(!project||project.tenant_id!==p.tenantId||project.workspace_id!==r.workspace_id||project.environment!==r.environment||project.app_env!==r.app_env||project.version!==e.projectVersion||project.archived||!output||output.project_id!==e.projectId||output.project_version!==e.projectVersion||output.status!=='succeeded'||output.plan_hash!==e.planHash||!artifact||artifact.export_id!==e.id||artifact.sha256!==e.artifactSHA256||artifact.size!==e.artifactSize||!review||review.project_id!==e.projectId||review.project_version!==e.projectVersion||review.export_id!==e.id||review.status!=='approved'||review.invalidated_at||review.snapshot_hash!==e.reviewHash||review.reviewer_id===review.requester_id||review.reviewer_id===review.last_editor_id)throw new AppError('LIVE_RECORDING_REVIEW_CHANGED','归档原节目、成片或独立审核已失效。',409);
      const reviewer=this.principal(review.reviewer_id),requester=this.principal(review.requester_id);requirePermission(reviewer,'studio.approve');requirePermission(requester,'studio.write');requireWorkspace(reviewer,r.workspace_id);requireWorkspace(requester,r.workspace_id);if(reviewer.tenantId!==p.tenantId||requester.tenantId!==p.tenantId)throw new AppError('LIVE_RECORDING_REVIEW_CHANGED','归档原审核的组织范围已变化。',409);
      const doc=studioDocumentInput.parse(JSON.parse(project.document));if(createHash('sha256').update(canonical(doc)).digest('hex')!==e.documentHash)throw new AppError('LIVE_RECORDING_DOCUMENT_CHANGED','归档原工程正文与固定来源不符。',409);
      for(const segment of doc.segments){if(segment.contentExpiresAt&&segment.contentExpiresAt<=new Date().toISOString())throw new AppError('LIVE_RECORDING_CONTENT_EXPIRED','归档原讲稿来源已到期。',409);if(segment.contentOriginId)this.contentOrigin(p,r.workspace_id,r.environment,r.app_env,segment.contentOriginId,seen);if(segment.source){const origin=this.get<{tenant_id:string;workspace_id:string;environment:string;app_env:string;status:string}>('SELECT * FROM studio_imports WHERE id=?',segment.source.importId);if(!origin||origin.tenant_id!==p.tenantId||origin.workspace_id!==r.workspace_id||origin.environment!==r.environment||origin.app_env!==r.app_env||origin.status!=='review')throw new AppError('LIVE_RECORDING_IMPORT_CHANGED','归档原文档已经取消或不在当前范围。',409);}}
      for(const profile of e.resources.profiles){const current=this.profile(p,profile.id);if(current.workspaceId!==r.workspace_id||current.version!==profile.version)throw new AppError('LIVE_RECORDING_PROFILE_CHANGED','归档原角色配置已变化。',409);}
      for(const clone of e.resources.clones){const current=this.get<{tenant_id:string;workspace_id:string;environment:string;app_env:string;status:string;version:number;asset_id:string;consent_id:string;kind:string}>('SELECT * FROM studio_clones WHERE id=?',clone.id);if(!current||current.tenant_id!==p.tenantId||current.workspace_id!==r.workspace_id||current.environment!==r.environment||current.app_env!==r.app_env||current.status!=='accepted'||current.version!==clone.version||!this.get('SELECT id FROM consents WHERE id=? AND asset_id=? AND tenant_id=? AND workspace_id=? AND purpose=? AND revoked_at IS NULL AND expires_at>?',current.consent_id,current.asset_id,p.tenantId,r.workspace_id,current.kind==='avatar'?'train_avatar':'train_voice',new Date().toISOString()))throw new AppError('LIVE_RECORDING_CLONE_CHANGED','归档原形象或声音专项授权已失效。',409);}
      for(const media of e.resources.media){const current=this.get<{tenant_id:string;workspace_id:string;sha256:string;status:string;environment:string;app_env:string}>('SELECT m.tenant_id,m.workspace_id,m.sha256,i.status,i.environment,i.app_env FROM studio_import_media m JOIN studio_imports i ON i.id=m.import_id WHERE m.id=?',media.id);if(!current||current.tenant_id!==p.tenantId||current.workspace_id!==r.workspace_id||current.environment!==r.environment||current.app_env!==r.app_env||current.status!=='review'||current.sha256!==media.sha256)throw new AppError('LIVE_RECORDING_IMPORT_CHANGED','归档原文档画面已变化或取消。',409);}
    }
    for(const c of guard.citations){const collection=this.get<{tenant_id:string;workspace_id:string;environment:string;app_env:string;audience:string;scenes:string}>('SELECT * FROM knowledge_collections WHERE id=?',c.collectionId),doc=this.get<{collection_id:string;published_version_id:string|null}>('SELECT * FROM knowledge_documents WHERE id=?',c.documentId);if(!collection||collection.tenant_id!==p.tenantId||collection.workspace_id!==r.workspace_id||collection.environment!==r.environment||collection.app_env!==r.app_env||collection.audience!=='public'||!JSON.parse(collection.scenes).includes('live')||doc?.collection_id!==c.collectionId||doc.published_version_id!==c.versionId)throw new AppError('LIVE_RECORDING_KNOWLEDGE_CHANGED','归档问答引用的公开知识已经撤回、改版或收紧范围。',409);}
    for(const source of guard.speech||[])assertLiveRecordingSpeech(this,p,source,r.workspace_id,r.environment,r.app_env);for(const source of guard.answers||[])assertLiveRecordingAnswer(this,p,source,r.workspace_id,r.environment,r.app_env);if(guard.puppet)assertLivePuppet(this,p,guard.puppet,r.workspace_id,r.environment,r.app_env);for(const source of guard.guestProgramme||[])assertProgrammeSource(this,p,source,r.workspace_id,r.environment,r.app_env,true);
    return guard;
  }
  semanticTranscript(p:Principal,workspaceId:string,source:MediaProcessingPayload['source'],contentSourceId:string,seen=new Set<string>()){
    const r=this.get<{id:string;workspace_id:string;environment:string;app_env:string;version:number;text_sha256:string;origin:string;transcription_id:string;review_version:number;review_hash:string;review:string;analysis:string;analysis_hash:string}>('SELECT c.id,c.workspace_id,c.environment,c.app_env,c.version,c.text_sha256,c.origin,s.transcription_id,s.review_version,s.review_hash,v.review,t.analysis,t.analysis_hash FROM studio_content_sources c JOIN studio_transcription_sources s ON s.source_id=c.id JOIN studio_transcription_revisions v ON v.transcription_id=s.transcription_id AND v.version=s.review_version JOIN studio_transcriptions t ON t.id=s.transcription_id WHERE c.id=? AND c.tenant_id=? AND c.kind=\'video\'',contentSourceId,p.tenantId);
    if(!r||r.workspace_id!==workspaceId)throw new AppError('SEMANTIC_TRANSCRIPT_UNAVAILABLE','请选择本空间已确认的带时间视频校对稿；手工粘贴的无时间正文不能用于自动切片。',409);
    this.environment(p,r.environment,r.app_env);this.contentReferences(p,workspaceId,r.environment,r.app_env,[{id:r.id,version:r.version,textSHA256:r.text_sha256}],seen);
    const snapshot=this.transcriptionSource(p,r.transcription_id,seen),review=transcriptionReview.parse(JSON.parse(r.review)),analysis=transcriptionAnalysis.parse(JSON.parse(r.analysis)),origin=JSON.parse(r.origin) as Record<string,unknown>;
    if(canonical(snapshot.source)!==canonical(source)||snapshot.configuration.provider!=='windows-offline-asr'||analysis.simulated||analysis.provider!=='windows-offline-asr'||origin.mode!=='reviewed_video_asr'||origin.transcriptionId!==r.transcription_id||origin.reviewVersion!==r.review_version||origin.reviewSHA256!==r.review_hash||origin.analysisSHA256!==r.analysis_hash||!review.segments.length)throw new AppError('SEMANTIC_TRANSCRIPT_CHANGED','校对稿的原片、确认凭据或实际识别来源不一致，请重新核对。',409);
    return semanticSourceSnapshot.parse({contentSourceId:r.id,contentSourceVersion:r.version,textSha256:r.text_sha256,transcriptionId:r.transcription_id,reviewVersion:r.review_version,reviewSha256:r.review_hash,analysisSha256:r.analysis_hash,sourceStartMs:snapshot.configuration.startMs,sourceDurationMs:snapshot.configuration.durationMs,timing:'phrase',synthetic:snapshot.source.synthetic,segments:review.segments});
  }
  mediaSource(p:Principal,workspaceId:string,payload:MediaProcessingPayload,seen=new Set<string>()){
    requireWorkspace(p,workspaceId);const at=new Date().toISOString();if(payload.rights.expiresAt<=at||payload.source.expiresAt&&payload.source.expiresAt<=at)throw new AppError('MEDIA_RIGHTS_EXPIRED','媒体加工继承的用途或原素材期限已到期。',409);
    const a=this.asset(p,payload.source.id,seen);assertUsableAsset(a);if(a.workspaceId!==workspaceId||a.version!==payload.source.version||a.sha256!==payload.source.sha256||a.size!==payload.source.size||a.mediaType!==payload.source.mediaType||canonical(a.specs)!==canonical(payload.source.specs))throw new AppError('MEDIA_SOURCE_CHANGED','原素材版本、规格或字节摘要已变化，请核对并明确采用当前版本。',409);
    if(payload.semanticSource){const actual=this.semanticTranscript(p,workspaceId,payload.source,payload.semanticSource.contentSourceId,seen);if(canonical(actual)!==canonical(payload.semanticSource))throw new AppError('SEMANTIC_TRANSCRIPT_CHANGED','语义切片的固定校对稿已变化，请重新保存并审阅。',409);}
    if(payload.semanticBasis){const basis=payload.semanticBasis,parent=this.mediaJobSource(p,basis.jobId,seen),row=this.get<{input_hash:string;report:string|null;status:string}>('SELECT input_hash,report,status FROM studio_media_jobs WHERE id=?',basis.jobId),report=row?.report?mediaProcessingReport.parse(JSON.parse(row.report)):null;if(!parent.semanticSource||parent.configuration.operation!=='semantic_split'||parent.configuration.provider!=='local-media'||canonical(parent.source)!==canonical(payload.source)||row?.status!=='succeeded'||row.input_hash!==basis.inputHash||!report?.realAlgorithm||report.simulated||!report.semantic||createHash('sha256').update(canonical(report)).digest('hex')!==basis.reportSha256||basis.candidateIds.some(id=>!report.semantic!.candidates.some(c=>c.id===id)))throw new AppError('SEMANTIC_BASIS_CHANGED','采用的语义分析来源或候选已变化，派生结果不可继续使用。',409);}
    return a;
  }
  mediaJobSource(p:Principal,jobId:string,seen=new Set<string>()){
    const key='media-job:'+jobId;if(seen.has(key)||seen.size>=16)throw new AppError('ASSET_DEPENDENCY_CYCLE','媒体加工来源链包含循环或超过深度限制。',409);
    const r=this.get<{workspace_id:string;environment:string;app_env:string;input_snapshot:string;input_hash:string;withdrawn_at:string|null;payload:string}>('SELECT j.workspace_id,j.environment,j.app_env,j.input_snapshot,j.input_hash,p.withdrawn_at,p.payload FROM studio_media_jobs j JOIN studio_media_plans p ON p.id=j.plan_id WHERE j.id=? AND j.tenant_id=?',jobId,p.tenantId);
    if(!r)throw new AppError('MEDIA_SOURCE_UNAVAILABLE','媒体加工来源不存在。',409);this.environment(p,r.environment,r.app_env);requireWorkspace(p,r.workspace_id);
    const current=mediaProcessingPayload.parse(JSON.parse(r.payload)),snapshot=mediaProcessingPayload.parse(JSON.parse(r.input_snapshot));
    if(r.withdrawn_at||current.rights.expiresAt<=new Date().toISOString()||createHash('sha256').update(canonical(snapshot)).digest('hex')!==r.input_hash)throw new AppError('MEDIA_SOURCE_UNAVAILABLE','媒体加工用途已撤回、到期或快照无效。',409);this.mediaSource(p,r.workspace_id,snapshot,snapshot.semanticBasis?new Set(seen).add(key):seen);return snapshot;
  }
  asset(p: Principal, assetId: string,seen=new Set<string>()): Asset {
    if(seen.has(assetId)||seen.size>=16)throw new AppError('ASSET_DEPENDENCY_CYCLE','素材来源链包含循环或超过深度限制，请核对来源。',409);
    const nextSeen=new Set(seen).add(assetId);
    const row = this.get<Omit<Asset, 'archived' | 'synthetic' | 'specs'> & { archived: number; synthetic: number; specs: string }>(`SELECT a.id, a.workspace_id AS workspaceId, a.name, a.category, a.version, a.archived, a.synthetic, a.expires_at AS expiresAt, a.created_at AS createdAt, u.media_type AS mediaType, u.size, u.sha256, u.specs FROM assets a JOIN uploads u ON a.upload_id=u.id WHERE a.id=? AND a.tenant_id=?`, assetId, p.tenantId);
    if (!row) throw new AppError('NOT_FOUND', '素材不存在或无权访问，请返回资产中心。', 404);
    requireWorkspace(p, row.workspaceId);
    const derived=this.get<{tenant_id:string;workspace_id:string;character_archived:number;character_expires:string;source_id:string;source_tenant:string;source_workspace:string;source_version:number;expected_version:number;source_archived:number;source_expires:string|null;consent_id:string;consent_asset_id:string;consent_tenant:string;consent_workspace:string;purpose:string;revoked_at:string|null;consent_expires:string;voice_id:string|null;voice_exists:string|null;voice_expected:number|null;voice_version:number|null;voice_archived:number|null;voice_expires:string|null;voice_tenant:string|null;voice_workspace:string|null}>(`SELECT c.tenant_id,c.workspace_id,c.archived AS character_archived,c.expires_at AS character_expires,s.id AS source_id,s.tenant_id AS source_tenant,s.workspace_id AS source_workspace,s.version AS source_version,d.source_version AS expected_version,s.archived AS source_archived,s.expires_at AS source_expires,g.id AS consent_id,g.asset_id AS consent_asset_id,g.tenant_id AS consent_tenant,g.workspace_id AS consent_workspace,g.purpose,g.revoked_at,g.expires_at AS consent_expires,d.voice_asset_id AS voice_id,d.voice_version AS voice_expected,v.id AS voice_exists,v.version AS voice_version,v.archived AS voice_archived,v.expires_at AS voice_expires,v.tenant_id AS voice_tenant,v.workspace_id AS voice_workspace FROM character_derivations d LEFT JOIN studio_characters c ON c.id=d.character_id LEFT JOIN assets s ON s.id=d.source_asset_id LEFT JOIN consents g ON g.id=d.consent_id LEFT JOIN assets v ON v.id=d.voice_asset_id WHERE d.asset_id=?`,row.id),at=new Date().toISOString();
    const unavailable=derived&&(derived.tenant_id!==p.tenantId||derived.workspace_id!==row.workspaceId||derived.character_archived||derived.character_expires<=at||!derived.source_id||derived.source_tenant!==p.tenantId||derived.source_workspace!==row.workspaceId||derived.source_version!==derived.expected_version||derived.source_archived||derived.source_expires&&derived.source_expires<=at||!derived.consent_id||derived.consent_asset_id!==derived.source_id||derived.consent_tenant!==p.tenantId||derived.consent_workspace!==row.workspaceId||derived.purpose!=='character_use'||derived.revoked_at||derived.consent_expires<=at||derived.voice_id&&(!derived.voice_exists||derived.voice_version!==derived.voice_expected||derived.voice_archived||derived.voice_tenant!==p.tenantId||derived.voice_workspace!==row.workspaceId||derived.voice_expires&&derived.voice_expires<=at));
    let reason:string|null=unavailable?'形象派生素材的来源、形象或独立使用授权已失效，请核对来源后重新生成。':null;
    if(derived?.voice_id&&!reason)try{assertUsableAsset(this.asset(p,derived.voice_id,nextSeen));}catch{reason='关联声音的脚本或素材来源已失效，请重新核对后生成。';}
    const origins=this.all<{origin_id:string;environment:string;app_env:string}>('SELECT a.origin_id,o.environment,o.app_env FROM studio_content_asset_origins a LEFT JOIN studio_content_origins o ON o.id=a.origin_id WHERE a.asset_id=?',row.id);
    for(const origin of origins)try{this.contentOrigin(p,row.workspaceId,origin.environment,origin.app_env,origin.origin_id,nextSeen);}catch(error){reason=error instanceof AppError?error.message:'关联脚本的来源校验失败，请重新核对。';}
    const recording=this.get<{recording_id:string;environment:string;app_env:string}>('SELECT o.recording_id,r.environment,r.app_env FROM studio_recording_outputs o JOIN studio_recordings r ON r.id=o.recording_id WHERE o.asset_id=?',row.id);
    if(recording)try{this.recordingSource(p,row.workspaceId,recording.environment,recording.app_env,recording.recording_id,nextSeen);}catch(error){reason=error instanceof AppError?error.message:'录制来源校验失败，请重新核对。';}
    const processing=this.get<{job_id:string}>('SELECT job_id FROM studio_media_outputs WHERE asset_id=?',row.id);if(processing)try{this.mediaJobSource(p,processing.job_id,nextSeen);}catch(error){reason=error instanceof AppError?error.message:'加工来源校验失败，请重新核对。';}
    const live=this.get<{recording_id:string}>('SELECT recording_id FROM live_recording_origins WHERE asset_id=?',row.id);if(live)try{this.liveRecordingSource(p,live.recording_id,nextSeen);}catch(error){reason=error instanceof AppError?error.message:'节目归档来源校验失败，请重新核对。';}
    const collected=this.get<{tenant_id:string;workspace_id:string;environment:string;app_env:string;rights_expires_at:string;revoked_at:string|null}>('SELECT tenant_id,workspace_id,environment,app_env,rights_expires_at,revoked_at FROM asset_collection_origins WHERE asset_id=?',row.id);
    if(collected){if(collected.tenant_id!==p.tenantId||collected.workspace_id!==row.workspaceId)reason='收集素材的组织或工作空间记录无效，请核对来源。';else if(!p.environment||!p.appEnv||p.environment!==collected.environment||p.appEnv!==collected.app_env)reason='收集素材不属于当前明确的运行环境，请切换原环境。';else if(collected.revoked_at||collected.rights_expires_at<=at)reason='收集素材的独立使用许可已撤回或到期，请联系素材管理人员。';}
    const ae=this.get<AeMediaRow>('SELECT * FROM ae_media_adoptions WHERE asset_id=?',row.id);
    if(ae)try{if(ae.status!=='succeeded')throw new AppError('AE_MEDIA_SOURCE_UNAVAILABLE','AE采用来源尚未完成或已撤回。',409);assertAeMediaSource(this,p,ae,nextSeen);}catch(error){reason=error instanceof AppError?error.message:'AE采用来源校验失败，请管理员核对授权。';}
    return { ...row, archived: !!row.archived, synthetic: !!row.synthetic, specs: JSON.parse(row.specs),...(derived||origins.length||recording||processing||live||collected||ae?{unavailableReason:reason}:{}) };
  }
  job(p: Principal, jobId: string): Job {
    const row = this.get<Omit<Job, 'result'> & { result: string | null }>(`SELECT id, workspace_id AS workspaceId, kind, status, attempts, max_attempts AS maxAttempts, error_code AS errorCode, error_message AS errorMessage, result, environment, created_at AS createdAt, updated_at AS updatedAt FROM jobs WHERE id=? AND tenant_id=?`, jobId, p.tenantId);
    if (!row) throw new AppError('NOT_FOUND', '任务不存在或无权访问。', 404);
    requireWorkspace(p, row.workspaceId);
    return { ...row, result: row.result ? JSON.parse(row.result) : null };
  }
  profile(p: Principal, profileId: string): Profile {
    const row = this.get<Omit<Profile, 'scenes'> & { scenes: string }>('SELECT id, workspace_id AS workspaceId, name, avatar_asset_id AS avatarAssetId, voice_asset_id AS voiceAssetId, scenes, version, created_at AS createdAt FROM profiles WHERE id=? AND tenant_id=?', profileId, p.tenantId);
    if (!row) throw new AppError('NOT_FOUND', '角色不存在或无权访问。', 404);
    requireWorkspace(p, row.workspaceId);
    return { ...row, scenes: JSON.parse(row.scenes) };
  }
  close() { this.db.close(); }
}
