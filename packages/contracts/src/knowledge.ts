import { focusProviderId, targetSpeechProviderId } from './speaker.js';
import { z } from 'zod';
import { sceneToolName, asrProviderId, ttsProviderId, type ToolProposal } from './runtime.js';
import type { Profile } from './index.js';
const id = z.uuid(), version = z.int().positive();
export const knowledgeScene = z.enum(['video', 'presentation', 'live', 'exhibition', 'reception', 'restaurant', 'learning']);
const roles = z.array(z.enum(['admin', 'editor', 'viewer','reviewer'])).min(1).max(4);
const collectionFields = { name: z.string().trim().min(1).max(80), audience: z.enum(['public', 'staff']), readerRoles: roles.default(['admin', 'editor', 'viewer']), scenes: z.array(knowledgeScene).min(1).max(7) };
export const collectionInput = z.strictObject({ workspaceId: id, ...collectionFields });
export const collectionUpdateInput = z.strictObject({ version, ...collectionFields });
const sourceUrl = z.string().url().max(500).refine(value => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; });
const documentFields = { title: z.string().trim().min(1).max(100), content: z.string().trim().min(1).max(30000), sourceLabel: z.string().trim().min(1).max(120), sourceUrl: sourceUrl.nullable().default(null) };
export const documentInput = z.strictObject({ collectionId: id, ...documentFields });
export const documentDraftInput = z.strictObject({ version, ...documentFields });
export const knowledgePublishInput = z.strictObject({ version, versionId: id, confirmed: z.literal(true) });
export const knowledgeWithdrawInput = z.strictObject({ version, confirmed: z.literal(true) });
export const knowledgeSearchInput = z.strictObject({ workspaceId: id, collectionIds: z.array(id).min(1).max(20), scene: knowledgeScene, query: z.string().trim().min(1).max(500), publicOnly: z.boolean().default(false) });
export const citationSchema = z.object({ collectionId: id, documentId: id, versionId: id, version: z.int().positive(), title: z.string(), sourceLabel: z.string(), sourceUrl: z.string().nullable(), snippet: z.string(), score: z.number() });
export const collectionSchema = z.object({ id, workspaceId: id, name: z.string(), audience: z.enum(['public', 'staff']), readerRoles: roles, scenes: z.array(knowledgeScene), version, createdAt: z.iso.datetime() });
export const knowledgeVersionSchema = z.object({ id, version: z.int().positive(), title: z.string(), content: z.string(), sourceLabel: z.string(), sourceUrl: z.string().nullable(), contentHash: z.string(), status: z.enum(['draft', 'published', 'superseded', 'withdrawn']), createdAt: z.iso.datetime() });
export const documentSchema = z.object({ id, collectionId: id, version, publishedVersionId: id.nullable(), versions: z.array(knowledgeVersionSchema) });
const sceneFields = { profileId: id, name: z.string().trim().min(1).max(80), scene: knowledgeScene, channelKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/), audience: z.enum(['public', 'staff']).default('public'), preset: z.enum(['custom', 'office', 'exhibition', 'restaurant']).default('custom'), welcomeText: z.string().trim().min(1).max(200), instructions: z.string().trim().max(2000).default(''), collectionIds: z.array(id).max(20).default([]), llmProvider: z.enum(['mock-grounded', 'mock-brief', 'external']).default('mock-grounded'), visionProvider: z.enum(['disabled', 'mock-vision', 'external-vision']).default('disabled'), allowCamera: z.boolean().default(false), allowScreen: z.boolean().default(false), speakerProvider: focusProviderId.default('disabled'), targetSpeechProvider: targetSpeechProviderId.default('disabled'), asrProvider: asrProviderId.default('disabled'), ttsProvider: ttsProviderId.default('disabled'), tools: z.array(sceneToolName).max(3).default(['knowledge.search']), enabled: z.boolean().default(true) };
export const sceneAppInput = z.strictObject({ workspaceId: id, ...sceneFields });
export const sceneAppUpdateInput = z.strictObject({ version, ...sceneFields });
export const sceneQueryInput = z.strictObject({ query: z.string().trim().min(1).max(500) });
export const sceneResolveInput = z.strictObject({ version, mode: z.enum(['text', 'voice']).default('text') });
export const sceneAppSchema = z.object({ id, workspaceId: id, version, profileVersion: version, ...sceneFields, createdAt: z.iso.datetime() });
export type KnowledgeCollection = z.infer<typeof collectionSchema>;
export type KnowledgeDocument = z.infer<typeof documentSchema>;
export type KnowledgeCitation = z.infer<typeof citationSchema>;
export type SceneApp = z.infer<typeof sceneAppSchema>;
export interface SceneAppSnapshot extends SceneApp { profile: Profile }
export interface KnowledgeAnswer { text: string; citations: KnowledgeCitation[]; simulated: true; provider: string; toolProposals: ToolProposal[] }
export const knowledgeOperations = [
  ['post', '/knowledge/collections', collectionInput, '创建有可见范围的知识库'],
  ['post', '/knowledge/collections/{id}/update', collectionUpdateInput, '修改知识库范围并使旧引用失效'],
  ['post', '/knowledge/documents', documentInput, '创建带来源的知识草稿'],
  ['post', '/knowledge/documents/{id}/draft', documentDraftInput, '保存新的不可覆盖知识版本'],
  ['post', '/knowledge/documents/{id}/publish', knowledgePublishInput, '明确发布当前版本并构建检索索引'],
  ['post', '/knowledge/documents/{id}/withdraw', knowledgeWithdrawInput, '撤回知识及索引并取消旧引用'],
  ['post', '/knowledge/search', knowledgeSearchInput, '按实际身份和场景检索有引用的已发布知识'],
  ['post', '/scene-apps', sceneAppInput, '从统一角色创建场景与频道配置'],
  ['post', '/scene-apps/{id}/update', sceneAppUpdateInput, '保存场景配置版本'],
  ['post', '/scene-apps/{id}/query', sceneQueryInput, '在场景权限内预览模拟回答'],
  ['post', '/scene-apps/{id}/resolve', sceneResolveInput, '检查实际可用能力，不静默切换模型']
] as const;
