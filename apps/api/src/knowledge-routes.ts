import { authenticatedSession } from './auth-check.js';
import { runRuntimeProbe } from './runtime-probe.js';
import type { RuntimeAdapters } from '@digitalguide/providers';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { requirePermission, requireWorkspace } from '@digitalguide/domain';
import { id, listInput, collectionInput, collectionUpdateInput, documentInput, documentDraftInput, knowledgePublishInput, knowledgeWithdrawInput, knowledgeSearchInput, sceneAppInput, sceneAppUpdateInput, sceneQueryInput, sceneResolveInput, runtimeProbeInput } from '@digitalguide/contracts';
import type { Config } from './config.js';
import { executeIdempotent } from './idempotency.js';
import { KnowledgeService, SceneService, type CollectionRow, type AppRow } from './knowledge-service.js';
export function registerKnowledgeRoutes(app: FastifyInstance, repo: Repository, config: Config, adapters: RuntimeAdapters = {}) {
  const knowledge = new KnowledgeService(repo, config.providerMode, config.appEnv), scenes = new SceneService(repo, config.providerMode, config.appEnv);
  const send = (req: FastifyRequest, reply: FastifyReply, data: unknown) => reply.send({ data, requestId: req.id });
  const resource = (req: FastifyRequest) => id.parse((req.params as { id: string }).id);
  function mutate(req: FastifyRequest, reply: FastifyReply, work: () => { id: string; workspaceId: string; version: number }) {
    requirePermission(req.principal, 'knowledge.manage');
    const result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, () => {
      const data = work(); repo.audit(req.principal, data.workspaceId, 'knowledge.' + req.url.split('/').at(-1), data.id, req.id); return data;
    }); return send(req, reply, result.data);
  }
  function scope(req: FastifyRequest) {
    const q = listInput.parse(req.query); if (q.cursor) id.parse(q.cursor);
    const spaces = q.workspaceId ? [q.workspaceId] : req.principal.workspaceIds; spaces.forEach(w => requireWorkspace(req.principal, w)); return { q, spaces };
  }
  app.get('/api/v1/knowledge/collections', (req, reply) => {
    requirePermission(req.principal, 'knowledge.manage'); const { q, spaces } = scope(req);
    const rows = spaces.length ? repo.all<CollectionRow>('SELECT * FROM knowledge_collections WHERE tenant_id=? AND workspace_id IN (' + spaces.map(() => '?').join(',') + ') AND environment=? AND app_env=? AND id>? ORDER BY id LIMIT ?', req.principal.tenantId, ...spaces, config.providerMode, config.appEnv, q.cursor || '', q.limit + 1) : [];
    return send(req, reply, { items: rows.slice(0, q.limit).map(r => knowledge.collectionView(r)), nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null });
  });
  app.post('/api/v1/knowledge/collections', (req, reply) => mutate(req, reply, () => { const row = knowledge.createCollection(req.principal, collectionInput.parse(req.body)); return { id: row.id, workspaceId: row.workspace_id, version: row.version }; }));
  app.post('/api/v1/knowledge/collections/:id/update', (req, reply) => {
    knowledge.collection(req.principal, resource(req));
    return mutate(req, reply, () => { const row = knowledge.collection(req.principal, resource(req)); knowledge.updateCollection(row, collectionUpdateInput.parse(req.body)); return { id: row.id, workspaceId: row.workspace_id, version: row.version + 1 }; });
  });
  app.get('/api/v1/knowledge/collections/:id/documents', (req, reply) => {
    requirePermission(req.principal, 'knowledge.manage'); const c = knowledge.collection(req.principal, resource(req)), { q } = scope(req);
    const rows = repo.all<{ id: string }>('SELECT id FROM knowledge_documents WHERE collection_id=? AND id>? ORDER BY id LIMIT ?', c.id, q.cursor || '', q.limit + 1);
    return send(req, reply, { items: rows.slice(0, q.limit).map(row => knowledge.documentView(knowledge.document(req.principal, row.id))), nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null });
  });
  app.post('/api/v1/knowledge/documents', (req, reply) => mutate(req, reply, () => { const row = knowledge.createDocument(req.principal, documentInput.parse(req.body)); return { id: row.id, workspaceId: row.workspace_id, version: row.version }; }));
  app.get('/api/v1/knowledge/documents/:id', (req, reply) => { requirePermission(req.principal, 'knowledge.manage'); return send(req, reply, knowledge.documentView(knowledge.document(req.principal, resource(req)))); });
  for (const action of ['draft', 'publish', 'withdraw'] as const) app.post('/api/v1/knowledge/documents/:id/' + action, (req, reply) => {
    knowledge.document(req.principal, resource(req));
    return mutate(req, reply, () => {
      const row = knowledge.document(req.principal, resource(req));
      if (action === 'draft') { const input = documentDraftInput.parse(req.body); knowledge.version(row, input.version); knowledge.draft(row, input); }
      else if (action === 'publish') { const input = knowledgePublishInput.parse(req.body); knowledge.publish(row, input.version, input.versionId); }
      else { const input = knowledgeWithdrawInput.parse(req.body); knowledge.withdraw(row, input.version); }
      return { id: row.id, workspaceId: row.workspace_id, version: row.version + 1 };
    });
  });
  app.post('/api/v1/knowledge/search', (req, reply) => {
    const input = knowledgeSearchInput.parse(req.body); requireWorkspace(req.principal, input.workspaceId);
    return send(req, reply, { citations: knowledge.search({ tenantId: req.principal.tenantId, workspaceId: input.workspaceId, role: req.principal.role, scene: input.scene, publicOnly: input.publicOnly }, input.collectionIds, input.query), engine: 'local_keywords', semanticModel: 'not_configured' });
  });
  app.get('/api/v1/scene-apps', (req, reply) => {
    requirePermission(req.principal, 'knowledge.manage'); const { q, spaces } = scope(req);
    const rows = spaces.length ? repo.all<AppRow>('SELECT * FROM scene_apps WHERE tenant_id=? AND workspace_id IN (' + spaces.map(() => '?').join(',') + ') AND environment=? AND app_env=? AND id>? ORDER BY id LIMIT ?', req.principal.tenantId, ...spaces, config.providerMode, config.appEnv, q.cursor || '', q.limit + 1) : [];
    return send(req, reply, { items: rows.slice(0, q.limit).map(row => scenes.view(row)), nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null });
  });
  app.post('/api/v1/scene-apps', (req, reply) => mutate(req, reply, () => { const row = scenes.save(req.principal, sceneAppInput.parse(req.body)); return { id: row.id, workspaceId: row.workspace_id, version: row.version }; }));
  app.get('/api/v1/scene-apps/:id', (req, reply) => { requirePermission(req.principal, 'knowledge.manage'); return send(req, reply, scenes.view(scenes.app(req.principal, resource(req)))); });
  app.post('/api/v1/scene-apps/:id/update', (req, reply) => {
    scenes.app(req.principal, resource(req));
    return mutate(req, reply, () => { const input = sceneAppUpdateInput.parse(req.body), row = scenes.app(req.principal, resource(req)); knowledge.version(row, input.version); const saved = scenes.save(req.principal, { ...input, workspaceId: row.workspace_id }, row); return { id: saved.id, workspaceId: saved.workspace_id, version: saved.version }; });
  });
  app.post('/api/v1/scene-apps/:id/query', (req, reply) => { const input = sceneQueryInput.parse(req.body), row = scenes.app(req.principal, resource(req)); return send(req, reply, scenes.answer(scenes.snapshot(row), input.query, req.principal)); });
  app.post('/api/v1/scene-apps/:id/pipeline/check', async (req, reply) => {
    requirePermission(req.principal, 'knowledge.manage'); const input = runtimeProbeInput.parse(req.body), row = scenes.app(req.principal, resource(req)); knowledge.version(row, input.version);
    const result = await runRuntimeProbe(scenes, scenes.snapshot(row), input.fixture, req.principal, adapters, () => { const current = authenticatedSession(repo, req, config).principal; requirePermission(current, 'knowledge.manage'); return current; }); repo.audit(req.principal, row.workspace_id, 'runtime.mock_contract_checked', row.id, req.id); return send(req, reply, result);
  });
  app.post('/api/v1/scene-apps/:id/resolve', (req, reply) => {
    requirePermission(req.principal, 'knowledge.manage'); const input = sceneResolveInput.parse(req.body), row = scenes.app(req.principal, resource(req)); knowledge.version(row, input.version); scenes.ready(scenes.snapshot(row), input.mode);
    return send(req, reply, { ready: true, mode: 'text', provider: scenes.view(row).llmProvider, asr: scenes.view(row).asrProvider, tts: scenes.view(row).ttsProvider, vision: scenes.view(row).visionProvider, microphone: 'not_connected' });
  });
}
