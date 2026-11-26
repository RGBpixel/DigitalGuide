import { createHash, randomUUID } from 'node:crypto';
import type { StudioDocument, StudioTemplate, StudioTrack,TemplateParameters } from '@digitalguide/contracts';
import { studioDocumentInput } from '@digitalguide/contracts';
import { AppError, canonical } from './index.js';
import { validateTimeline,timelineDependencies } from './timeline.js';
import {applyTemplateControls} from './template-controls.js';
export function validateStudioDocument(input: unknown): StudioDocument {
  const doc = studioDocumentInput.parse(input), ids = [...doc.speakers.map(s => s.id), ...doc.segments.flatMap(s => [s.id, ...s.elements.map(e => e.id)])];
  if (new Set(ids).size !== ids.length) throw new AppError('DUPLICATE_OBJECT_ID', '角色、分镜和画面对象编号必须唯一。');
  if (doc.segments.reduce((n, s) => n + s.durationMs, 0) > 3 * 3600000) throw new AppError('PROJECT_TOO_LONG', '本地工程总时长最多三小时，请拆分工程。');
  for (const segment of doc.segments) { if (segment.speakerId && !doc.speakers.some(s => s.id === segment.speakerId)) throw new AppError('INVALID_SPEAKER', '分镜引用了不存在的角色。'); for (const e of segment.elements) if (e.x + e.width > 1.001 || e.y + e.height > 1.001) throw new AppError('INVALID_LAYOUT', '画面对象超出画布范围，请调整位置或尺寸。'); }
  validateTimeline(doc);return doc;
}
export function studioTracks(doc: StudioDocument): StudioTrack[] {
  if (doc.timeline) return doc.timeline.tracks.slice().sort((a,b) => a.order-b.order).map(t => ({ id: t.id,type: t.type,clips: t.clips.map(c => ({ id: c.id,segmentId: c.segmentId,speakerId: c.speakerId,startMs: c.startMs,durationMs: c.durationMs,sourceInMs: c.sourceInMs })) }));
  const tracks: StudioTrack[] = (['background', 'avatar', 'voice', 'music', 'subtitle', 'overlay'] as const).map(type => ({ id: 'linked-' + type, type, clips: [] })); let time = 0;
  for (const segment of doc.segments) { for (const track of tracks) { if (track.type === 'music' || ((track.type === 'avatar' || track.type === 'voice') && !segment.speakerId)) continue; track.clips.push({ id: segment.id + ':' + track.type, segmentId: segment.id, speakerId: segment.speakerId, startMs: time, durationMs: segment.durationMs, sourceInMs: 0 }); } time += segment.durationMs; }
  return tracks;
}
export function remapStudioDocument(doc: StudioDocument) {
  const ids = new Map<string, string>(), remap = (id: string) => { let next = ids.get(id); if (!next) { next = randomUUID(); ids.set(id, next); } return next; };
  return { ...structuredClone(doc), speakers: doc.speakers.map(s => ({ ...s, id: remap(s.id) })), segments: doc.segments.map(s => ({ ...s, id: remap(s.id), speakerId: s.speakerId ? remap(s.speakerId) : null, elements: s.elements.map(e => ({ ...e, id: remap(e.id) })) })),timeline: doc.timeline ? { ...structuredClone(doc.timeline),tracks: doc.timeline.tracks.map(t => ({ ...structuredClone(t),id: remap(t.id),clips: t.clips.map(c => ({ ...structuredClone(c),id: remap(c.id),segmentId: c.segmentId ? remap(c.segmentId) : null,speakerId: c.speakerId ? remap(c.speakerId) : null })) })) } : null };
}
export function applyStudioTemplate(template: StudioTemplate, variables: Record<string, string>,remap = true,parameters?:TemplateParameters): StudioDocument {
  if (template.variables.some(v => v.maxLength < (variables[v.key] ?? v.defaultValue).length) || Object.keys(variables).some(k => !template.variables.some(v => v.key === k))) throw new AppError('INVALID_TEMPLATE_VARIABLE', '模板变量未知或超过长度限制。');
  const replace = (text: string) => text.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_all, key: string) => { const field = template.variables.find(v => v.key === key); if (!field) throw new AppError('INVALID_TEMPLATE_VARIABLE', '模板中有未定义变量。'); const value = variables[key] ?? field.defaultValue; if (field.required && !value.trim()) throw new AppError('MISSING_TEMPLATE_VARIABLE', '请填写模板必填变量：' + field.label); return value; });
  const doc = structuredClone(template.document); for (const segment of doc.segments) { segment.title = replace(segment.title); segment.text = replace(segment.text); segment.notes = replace(segment.notes); segment.elements = segment.elements.map(e => e.type === 'text' ? { ...e, text: replace(e.text) } : e); }
  for (const t of doc.timeline?.tracks || []) for (const c of t.clips) { c.name = replace(c.name);if (c.source.type === 'text') c.source.text = replace(c.source.text); }
  const result=template.controls?.length||parameters?applyTemplateControls(doc,template.controls,parameters):doc;return validateStudioDocument(remap ? remapStudioDocument(result) : result);
}
export const studioPreviewRendererPolicy = 'caption-pages-ink-v3';
export const studioCaptionPaginationNotice = '长字幕在原片段内按估算时间分页显示，字号与原稿不变；SRT/VTT保留原文字和起止时间，精确对齐请在字幕制作页拆分并校对。';
export function studioFingerprint(doc: StudioDocument, segmentId: string, resources: unknown) {
  const segment = doc.segments.find(s => s.id === segmentId)!; return createHash('sha256').update(canonical({ renderer: studioPreviewRendererPolicy, canvas: doc.canvas, brand: doc.brand, segment, speaker: doc.speakers.find(s => s.id === segment.speakerId) || null, resources,...(doc.timeline ? { timeline: timelineDependencies(doc,segmentId) } : {}) })).digest('hex');
}
