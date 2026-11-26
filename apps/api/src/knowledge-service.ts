import { advanceSpeakerFocus, releaseSessionSpeaker } from './speaker-lifecycle.js';
import type { SessionRow } from './reception-service.js';
import { cancelConversationTools } from './conversation-tools.js';
import { VisitService, type HostRow } from './visit-service.js';
import { selectLanguageProvider, selectAsrProvider, selectTtsProvider } from '@digitalguide/providers';
import { releaseSessionVisuals } from './visual-lifecycle.js';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, assertUsableAsset, requireWorkspace, type Principal } from '@digitalguide/domain';
import { collectionInput, documentInput, sceneAppInput, type KnowledgeCollection, type KnowledgeDocument, type KnowledgeCitation, type SceneApp, type SceneAppSnapshot, type KnowledgeAnswer, type SceneTool } from '@digitalguide/contracts';
export interface CollectionRow { id: string; tenant_id: string; workspace_id: string; name: string; audience: 'public' | 'staff'; reader_roles: string; scenes: string; version: number; created_at: string }
interface DocumentRow { id: string; collection_id: string; tenant_id: string; workspace_id: string; version: number; published_version_id: string | null }
interface VersionRow { id: string; document_id: string; ordinal: number; title: string; content: string; source_label: string; source_url: string | null; content_hash: string; status: KnowledgeDocument['versions'][number]['status']; created_at: string }
export interface AppRow { id: string; tenant_id: string; workspace_id: string; profile_id: string; name: string; scene: SceneApp['scene']; channel_key: string; config: string; version: number; enabled: number; created_at: string }
interface SearchContext { tenantId: string; workspaceId: string; role?: Principal['role']; scene: SceneApp['scene']; publicOnly: boolean }
const now = () => new Date().toISOString();
function tokens(text: string) {
  const normalized = text.normalize('NFKC').toLowerCase(), list: string[] = normalized.match(/[a-z0-9]+/g) || [];
  for (const match of normalized.matchAll(/[\p{Script=Han}]+/gu)) { const chars = [...match[0]]; if (chars.length === 1) list.push(chars[0]); else for (let i = 0; i < chars.length - 1; i++) list.push(chars[i] + chars[i + 1]); }
  return [...new Set(list)].slice(0, 1000);
}
export class KnowledgeService {
  constructor(public repo: Repository, public environment: string, public appEnv: string) {}
  collection(p: Principal, id: string) {
    const row = this.repo.get<CollectionRow>('SELECT * FROM knowledge_collections WHERE id=? AND tenant_id=? AND environment=? AND app_env=?', id, p.tenantId, this.environment, this.appEnv);
    if (!row) throw new AppError('NOT_FOUND', '知识库不存在或无权访问。', 404); requireWorkspace(p, row.workspace_id); return row;
  }
  document(p: Principal, id: string) {
    const row = this.repo.get<DocumentRow>('SELECT * FROM knowledge_documents WHERE id=? AND tenant_id=?', id, p.tenantId);
    if (!row) throw new AppError('NOT_FOUND', '知识文档不存在或无权访问。', 404); this.collection(p, row.collection_id); return row;
  }
  version(row: { version: number }, version: number) { if (row.version !== version) throw new AppError('VERSION_CONFLICT', '知识或场景版本已变化，请重新核对。', 409); }
  collectionView(row: CollectionRow): KnowledgeCollection { return { id: row.id, workspaceId: row.workspace_id, name: row.name, audience: row.audience, readerRoles: JSON.parse(row.reader_roles), scenes: JSON.parse(row.scenes), version: row.version, createdAt: row.created_at }; }
  documentView(row: DocumentRow): KnowledgeDocument {
    return { id: row.id, collectionId: row.collection_id, version: row.version, publishedVersionId: row.published_version_id, versions: this.repo.all<VersionRow>('SELECT * FROM knowledge_versions WHERE document_id=? ORDER BY ordinal DESC', row.id).map(v => ({ id: v.id, version: v.ordinal, title: v.title, content: v.content, sourceLabel: v.source_label, sourceUrl: v.source_url, contentHash: v.content_hash, status: v.status, createdAt: v.created_at })) };
  }
  invalidate(id: string) {
    const messages = this.repo.all<{ id: string; session_id: string }>("SELECT id,session_id FROM reception_messages WHERE instr(knowledge_citations,?)>0", id);
    for (const m of messages) {
      this.repo.run("UPDATE reception_messages SET text='引用知识已更新或撤回，请重新提问。',knowledge_citations='[]',status='cancelled' WHERE id=?", m.id);
      this.repo.run("UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=? AND status IN ('active','human')", m.session_id);
      this.repo.run("UPDATE idempotency SET response='{}',redacted=1 WHERE instr(response,?)>0 OR instr(action,?)>0", m.session_id, '/sessions/' + m.session_id);
    }
    this.repo.run("UPDATE idempotency SET response='{}',redacted=1 WHERE instr(response,?)>0", id);
  }
  createCollection(p: Principal, input: z.infer<typeof collectionInput>) {
    requireWorkspace(p, input.workspaceId); const id = randomUUID();
    this.repo.run('INSERT INTO knowledge_collections VALUES (?,?,?,?,?,?,?,1,?,?,?,?)', id, p.tenantId, input.workspaceId, input.name, input.audience, JSON.stringify([...new Set(input.readerRoles)]), JSON.stringify([...new Set(input.scenes)]), this.environment, this.appEnv, now(), now()); return this.collection(p, id);
  }
  updateCollection(row: CollectionRow, input: Omit<z.infer<typeof collectionInput>, 'workspaceId'> & { version: number }) {
    this.version(row, input.version); this.invalidate(row.id);
    this.repo.run('UPDATE knowledge_collections SET name=?,audience=?,reader_roles=?,scenes=?,version=version+1,updated_at=? WHERE id=?', input.name, input.audience, JSON.stringify([...new Set(input.readerRoles)]), JSON.stringify([...new Set(input.scenes)]), now(), row.id);
  }
  createDocument(p: Principal, input: z.infer<typeof documentInput>) {
    const collection = this.collection(p, input.collectionId), id = randomUUID();
    this.repo.run('INSERT INTO knowledge_documents(id,collection_id,tenant_id,workspace_id,created_at) VALUES (?,?,?,?,?)', id, collection.id, p.tenantId, collection.workspace_id, now());
    this.draft(this.document(p, id), input); return this.document(p, id);
  }
  draft(row: DocumentRow, input: Omit<z.infer<typeof documentInput>, 'collectionId'>) {
    const ordinal = this.repo.get<{ n: number }>('SELECT COALESCE(max(ordinal),0)+1 AS n FROM knowledge_versions WHERE document_id=?', row.id)!.n;
    if (ordinal > 100) throw new AppError('QUOTA_EXCEEDED', '单文档最多保留 100 个版本，请创建新文档或按治理流程归档。', 409);
    this.repo.run('INSERT INTO knowledge_versions(id,document_id,ordinal,title,content,source_label,source_url,content_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)', randomUUID(), row.id, ordinal, input.title, input.content, input.sourceLabel, input.sourceUrl, createHash('sha256').update(input.content).digest('hex'), now());
    this.repo.run('UPDATE knowledge_documents SET version=version+1 WHERE id=?', row.id); this.invalidate(row.id);
  }
  publish(row: DocumentRow, version: number, versionId: string) {
    this.version(row, version);
    const source = this.repo.get<VersionRow>("SELECT * FROM knowledge_versions WHERE id=? AND document_id=? AND status='draft'", versionId, row.id);
    if (!source) throw new AppError('STATE_CONFLICT', '只能发布当前文档的待审草稿。', 409);
    this.invalidate(row.id); this.repo.run("UPDATE knowledge_versions SET status='superseded' WHERE document_id=? AND status='published'", row.id);
    this.repo.run('DELETE FROM knowledge_chunks WHERE document_id=?', row.id);
    for (let start = 0, sequence = 0; start < source.content.length; start += 450, sequence++) {
      const text = source.content.slice(start, start + 500);
      this.repo.run('INSERT INTO knowledge_chunks VALUES (?,?,?,?,?,?)', randomUUID(), source.id, row.id, sequence, text, JSON.stringify(tokens(source.title + ' ' + text)));
    }
    this.repo.run("UPDATE knowledge_versions SET status='published',published_at=? WHERE id=?", now(), source.id);
    this.repo.run('UPDATE knowledge_documents SET published_version_id=?,version=version+1 WHERE id=?', source.id, row.id);
    this.repo.event(row.tenant_id, row.workspace_id, row.id, 'knowledge.published', this.environment);
  }
  withdraw(row: DocumentRow, version: number) {
    this.version(row, version); this.invalidate(row.id);
    this.repo.run('DELETE FROM knowledge_chunks WHERE document_id=?', row.id);
    this.repo.run("UPDATE knowledge_versions SET status='withdrawn' WHERE id=?", row.published_version_id);
    this.repo.run('UPDATE knowledge_documents SET published_version_id=NULL,version=version+1 WHERE id=?', row.id);
    this.repo.event(row.tenant_id, row.workspace_id, row.id, 'knowledge.withdrawn', this.environment);
  }
  search(context: SearchContext, ids: string[], query: string): KnowledgeCitation[] {
    if (!ids.length) return [];
    const allowed = this.repo.all<CollectionRow>('SELECT * FROM knowledge_collections WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? AND id IN (' + ids.map(() => '?').join(',') + ')', context.tenantId, context.workspaceId, this.environment, this.appEnv, ...ids).filter(c => JSON.parse(c.scenes).includes(context.scene) && (c.audience === 'public' || (!context.publicOnly && context.role && JSON.parse(c.reader_roles).includes(context.role)))).map(c => c.id);
    if (!allowed.length) return [];
    const chunks = this.repo.all<{ collection_id: string; document_id: string; version_id: string; ordinal: number; title: string; source_label: string; source_url: string | null; text: string; tokens: string }>("SELECT d.collection_id,c.document_id,c.version_id,v.ordinal,v.title,v.source_label,v.source_url,c.text,c.tokens FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id AND d.published_version_id=c.version_id JOIN knowledge_versions v ON v.id=c.version_id WHERE d.tenant_id=? AND d.workspace_id=? AND d.collection_id IN (" + allowed.map(() => '?').join(',') + ") AND v.status='published'", context.tenantId, context.workspaceId, ...allowed);
    const terms = tokens(query).slice(0, 40), phrase = query.normalize('NFKC').toLowerCase(), best = new Map<string, KnowledgeCitation>();
    for (const c of chunks) {
      const words = new Set<string>(JSON.parse(c.tokens)), text = (c.title + ' ' + c.text).normalize('NFKC').toLowerCase();
      const score = terms.reduce((sum, token) => sum + (words.has(token) ? 1 : 0), 0) + (text.includes(phrase) ? 10 : 0);
      if (score <= 0 || (best.get(c.document_id)?.score || 0) >= score) continue;
      best.set(c.document_id, { collectionId: c.collection_id, documentId: c.document_id, versionId: c.version_id, version: c.ordinal, title: c.title, sourceLabel: c.source_label, sourceUrl: c.source_url, snippet: c.text.slice(0, 400), score });
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId)).slice(0, 5);
  }
}
export class SceneService {
  knowledge: KnowledgeService;
  constructor(public repo: Repository, public environment: string, public appEnv: string) { this.knowledge = new KnowledgeService(repo, environment, appEnv); }
  app(p: Principal, id: string) {
    const row = this.repo.get<AppRow>('SELECT * FROM scene_apps WHERE id=? AND tenant_id=? AND environment=? AND app_env=?', id, p.tenantId, this.environment, this.appEnv);
    if (!row) throw new AppError('NOT_FOUND', '场景应用不存在或无权访问。', 404); requireWorkspace(p, row.workspace_id); return row;
  }
  snapshot(row: AppRow): SceneAppSnapshot { return { speakerProvider: 'disabled', targetSpeechProvider: 'disabled', asrProvider: 'disabled', ttsProvider: 'disabled', visionProvider: 'disabled', allowCamera: false, allowScreen: false, ...JSON.parse(row.config), id: row.id, workspaceId: row.workspace_id, version: row.version, enabled: !!row.enabled, createdAt: row.created_at }; }
  view(row: AppRow): SceneApp { const { profile, ...view } = this.snapshot(row); return { ...view, profileVersion: profile.version }; }
  save(p: Principal, input: z.infer<typeof sceneAppInput>, existing?: AppRow) {
    requireWorkspace(p, input.workspaceId);
    if ((input.speakerProvider === 'disabled') !== (input.targetSpeechProvider === 'disabled')) throw new AppError('VALIDATION_FAILED', '专注对话与目标语音提取需配套选择，或一并关闭。', 400);
    if (input.visionProvider === 'disabled' && (input.allowCamera || input.allowScreen)) throw new AppError('VALIDATION_FAILED', '启用画面来源前请选择视觉服务。', 400);
    const profile = this.repo.profile(p, input.profileId);
    if (profile.workspaceId !== input.workspaceId || !profile.scenes.includes(input.scene)) throw new AppError('CAPABILITY_UNAVAILABLE', '角色不属于此工作空间或没有启用该场景。', 409);
    assertUsableAsset(this.repo.asset(p, profile.avatarAssetId)); if (profile.voiceAssetId) assertUsableAsset(this.repo.asset(p, profile.voiceAssetId));
    for (const id of input.collectionIds) { const c = this.knowledge.collection(p, id); if (c.workspace_id !== input.workspaceId || !JSON.parse(c.scenes).includes(input.scene) || (input.audience === 'public' && c.audience !== 'public')) throw new AppError('SCOPE_CONFLICT', '知识库与场景或受众范围不一致，公开应用不能绑定内部知识。', 409); }
    if(input.tools.some(t=>t!=='knowledge.search'&&(['restaurant.order_draft','restaurant.service_request'].includes(t)?input.scene!=='restaurant'||input.audience!=='public':input.scene!=='reception')))throw new AppError('SCOPE_CONFLICT','业务工具须匹配场景：餐厅草稿仅对公开餐厅应用开放。',409);
    const presetScenes = { office: 'reception', exhibition: 'exhibition', restaurant: 'restaurant', custom: input.scene };
    if (presetScenes[input.preset] !== input.scene) throw new AppError('VALIDATION_FAILED', '场景模板与运行场景不匹配。', 400);
    const duplicate = this.repo.get<{ id: string }>('SELECT id FROM scene_apps WHERE tenant_id=? AND workspace_id=? AND channel_key=? AND environment=? AND app_env=?', p.tenantId, input.workspaceId, input.channelKey, this.environment, this.appEnv);
    if (duplicate && duplicate.id !== existing?.id) throw new AppError('CHANNEL_CONFLICT', '此频道标识已使用，请为独立应用选择不同标识。', 409);
    const id = existing?.id || randomUUID(), version = existing ? existing.version + 1 : 1, config = JSON.stringify({ ...input, profile, profileVersion: profile.version });
    if (existing && (!input.enabled || (this.snapshot(existing).audience === 'public' && input.audience === 'staff') || this.snapshot(existing).tools.some(t => !input.tools.includes(t)))) {
      const sessions = this.repo.all<{ id: string }>('SELECT id FROM reception_sessions WHERE instr(scene_app_snapshot,?)>0', existing.id);
      for (const session of sessions) {
        releaseSessionVisuals(this.repo, session.id, 'scene.scope_changed');
        cancelConversationTools(this.repo, session.id);
        this.repo.run("UPDATE reception_messages SET text='场景应用已停用或变更受众，请联系工作人员。',knowledge_citations='[]',status='cancelled' WHERE session_id=? AND role='assistant'", session.id);
        this.repo.run('UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=?', session.id);
        this.repo.run("UPDATE idempotency SET response='{}',redacted=1 WHERE instr(response,?)>0 OR instr(action,?)>0", session.id, '/sessions/' + session.id);
      }
    }
    if (existing && ['visionProvider', 'allowCamera', 'allowScreen'].some(key => JSON.parse(existing.config)[key] !== input[key as 'visionProvider' | 'allowCamera' | 'allowScreen'])) {
      for (const session of this.repo.all<{ id: string }>('SELECT id FROM reception_sessions WHERE instr(scene_app_snapshot,?)>0', existing.id)) releaseSessionVisuals(this.repo, session.id, 'scene.visual_policy_changed');
    }
    if (existing && (!input.enabled || input.audience !== this.snapshot(existing).audience || input.speakerProvider !== this.snapshot(existing).speakerProvider || input.targetSpeechProvider !== this.snapshot(existing).targetSpeechProvider)) {
      for (const session of this.repo.all<SessionRow>("SELECT * FROM reception_sessions WHERE instr(scene_app_snapshot,?)>0 AND status IN ('active','human')", existing.id)) {
        if (this.repo.get("SELECT session_id FROM speaker_focus_sessions WHERE session_id=? AND state<>'ended'", session.id)) { const current = advanceSpeakerFocus(this.repo, session, 'scene_speaker_policy_changed'); releaseSessionSpeaker(this.repo, current, 'scene_speaker_policy_changed'); }
      }
    }
    if (existing) this.repo.run('UPDATE scene_apps SET profile_id=?,name=?,scene=?,channel_key=?,config=?,version=?,enabled=?,updated_at=? WHERE id=?', profile.id, input.name, input.scene, input.channelKey, config, version, +input.enabled, now(), id);
    else this.repo.run('INSERT INTO scene_apps VALUES (?,?,?,?,?,?,?, ?,1,?,?,?,?,?)', id, p.tenantId, input.workspaceId, profile.id, input.name, input.scene, input.channelKey, config, +input.enabled, this.environment, this.appEnv, now(), now());
    const row = this.app(p, id); this.repo.run('INSERT INTO scene_app_versions VALUES (?,?,?,?)', id, version, JSON.stringify(this.snapshot(row)), now()); return row;
  }
  ready(snapshot: SceneAppSnapshot, mode: 'text' | 'voice' = 'text') {
    if (!snapshot.enabled) throw new AppError('CAPABILITY_UNAVAILABLE', '场景应用已停用，请选择其他应用。', 409);
    selectLanguageProvider(snapshot.llmProvider, this.environment, this.appEnv);
    if (mode === 'voice') { selectAsrProvider(snapshot.asrProvider || 'disabled', this.environment, this.appEnv); selectTtsProvider(snapshot.ttsProvider || 'disabled', this.environment, this.appEnv); throw new AppError('CAPABILITY_UNAVAILABLE', '模拟语音契约可单独检查；实时麦克风对话仍需目标归属与真实 ASR/TTS 接入。', 409); }
  }
  active(snapshot: SceneAppSnapshot) {
    this.ready(snapshot);
    const current = this.repo.get<{ enabled: number; config: string }>('SELECT enabled,config FROM scene_apps WHERE id=? AND workspace_id=? AND environment=? AND app_env=?', snapshot.id, snapshot.workspaceId, this.environment, this.appEnv);
    if (!current?.enabled) throw new AppError('CAPABILITY_UNAVAILABLE', '此场景应用已停用。', 409);
    if (snapshot.audience === 'public' && JSON.parse(current.config).audience !== 'public') throw new AppError('FORBIDDEN', '此场景已改为内部使用，请重新开启适合访客的场景。', 403);
  }
  toolAllowed(snapshot: SceneAppSnapshot, name: SceneTool) {
    if((name==='visit.lookup_host'||name==='reception.handoff')&&snapshot.scene!=='reception')return false;
    if(['restaurant.order_draft','restaurant.service_request'].includes(name)&&(snapshot.scene!=='restaurant'||snapshot.audience!=='public'))return false;
    const current = this.repo.get<{ config: string }>('SELECT config FROM scene_apps WHERE id=? AND workspace_id=? AND environment=? AND app_env=?', snapshot.id, snapshot.workspaceId, this.environment, this.appEnv);
    return snapshot.tools.includes(name) && !!current && (JSON.parse(current.config).tools || []).includes(name);
  }
  answer(snapshot: SceneAppSnapshot, query: string, p?: Principal): KnowledgeAnswer {
    this.active(snapshot);
    if (snapshot.audience === 'staff' && (!p || p.tenantId !== this.repo.get<{ tenant_id: string }>('SELECT tenant_id FROM scene_apps WHERE id=?', snapshot.id)!.tenant_id || !p.workspaceIds.includes(snapshot.workspaceId))) throw new AppError('FORBIDDEN', '此场景仅供已验证的组织成员使用。', 403);
    const tenantId = this.repo.get<{ tenant_id: string }>('SELECT tenant_id FROM scene_apps WHERE id=?', snapshot.id)!.tenant_id;
    const citations = this.toolAllowed(snapshot, 'knowledge.search') ? this.knowledge.search({ tenantId, workspaceId: snapshot.workspaceId, role: p?.role, scene: snapshot.scene, publicOnly: snapshot.audience === 'public' }, snapshot.collectionIds, query) : [];
    const tools = snapshot.tools.filter(t => this.toolAllowed(snapshot, t));
    const visits = new VisitService(this.repo, this.environment, this.appEnv);
    const hostNames = tools.includes('visit.lookup_host') && /接待人|拜访谁|找谁|可拜访/.test(query) ? this.repo.all<HostRow>('SELECT * FROM reception_hosts WHERE tenant_id=? AND workspace_id=? AND enabled=1 ORDER BY public_name LIMIT 20', tenantId, snapshot.workspaceId).filter(h => visits.availableHost(h)).slice(0, 10).map(h => h.public_name) : [];
    const answer = selectLanguageProvider(snapshot.llmProvider, this.environment, this.appEnv).respond({ question: query, citations, tools, hostNames });
    return { ...answer, citations, simulated: true, provider: snapshot.llmProvider };
  }
}
