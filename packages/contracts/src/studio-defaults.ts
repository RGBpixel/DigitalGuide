import type { StudioDocument, StudioTemplate } from './studio.js';
export function blankStudioDocument(makeId: () => string = () => crypto.randomUUID()): StudioDocument {
  const speakerId = makeId();
  return { schemaVersion: 1, timeline: null, canvas: { width: 1920, height: 1080, fps: 25, transparent: false }, brand: { primaryColor: '#245649', accentColor: '#DDE8CA', textColor: '#173E33', fontFamily: 'sans', logoAssetId: null }, speakers: [{ id: speakerId, name: '主讲人', profileId: null, avatarAssetId: null, voiceAssetId: null, avatarCloneId: null, voiceCloneId: null }], segments: [{ id: makeId(), title: '开场', speakerId, text: '您好，欢迎观看本次介绍。', durationMs: 6000, backgroundColor: '#F6F8F0', avatar: { x: 0.68, y: 0.15, width: 0.28, height: 0.78 }, source: null, notes: '', elements: [{ id: makeId(), type: 'shape', shape: 'rectangle', x: 0.04, y: 0.14, width: 0.012, height: 0.56, fill: '#245649', zIndex: 0, opacity: 1 }, { id: makeId(), type: 'text', x: 0.09, y: 0.19, width: 0.55, height: 0.22, text: '让每次表达更清晰', fontSize: 72, color: '#245649', align: 'left', bold: true, zIndex: 2, opacity: 1 }] }] };
}
export function builtinStudioTemplates(): StudioTemplate[] {
  const make = (index: number) => { let n = index * 100; return () => '80000000-0000-4000-8000-' + String(++n).padStart(12, '0'); };
  return ['口播介绍', '课程讲解', '访谈开场'].map((name, i) => {
    const doc = blankStudioDocument(make(i + 1)); doc.segments[0].elements = doc.segments[0].elements.map(e => e.type === 'text' ? { ...e, text: '{{headline}}' } : e); doc.segments[0].text = '{{script}}';
    if (i === 1) { doc.canvas = { width: 1920, height: 1080, fps: 25, transparent: false }; doc.segments[0].backgroundColor = '#EDF2E7'; }
    if (i === 2) { doc.segments[0].avatar = { x: 0.61, y: 0.15, width: 0.34, height: 0.78 }; doc.segments[0].elements = doc.segments[0].elements.map(e => e.type === 'text' ? { ...e, width: 0.48 } : e); }
    return { id: '81000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), workspaceId: null, name, purpose: i === 1 ? 'presentation' as const : 'video' as const, description: '本项目原创基础模板，可编辑后另存到工作空间。', document: doc, version: 1, builtin: true, licenseNote: '本项目原创合成布局，无第三方人物或品牌素材。', variables: [{ key: 'headline', label: '画面标题', required: true, defaultValue: name, maxLength: 80 }, { key: 'script', label: '讲解文案', required: true, defaultValue: '您好，欢迎观看这段本地制作示例。', maxLength: 1000 }] };
  });
}
