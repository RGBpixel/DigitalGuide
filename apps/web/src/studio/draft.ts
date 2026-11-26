import { createStore } from 'zustand/vanilla';
import type { StudioDocument, StudioProject } from '@digitalguide/contracts';
import { reconcileTimeline } from '../../../../packages/domain/src/timeline.js';
type Content = { name: string; document: StudioDocument };
export interface StudioDraft {
  current: Content; base: Content; version: number; serial: number; dirty: boolean;
  previous: Content[]; next: Content[];
  edit: (change: (content: Content) => void) => void;
  undo: () => void; redo: () => void;
  accept: (project: StudioProject, serial?: number) => void;
}
const content = (p: StudioProject): Content => ({ name: p.name, document: structuredClone(p.document) });
const equal = (a: Content, b: Content) => JSON.stringify(a) === JSON.stringify(b);
export function createStudioDraft(project: StudioProject) {
  return createStore<StudioDraft>((set, get) => ({
    current: content(project), base: content(project), version: project.version, serial: 0, dirty: false, previous: [], next: [],
    edit(change) { const s = get(), draft = structuredClone(s.current); change(draft);reconcileTimeline(s.current.document,draft.document); if (!equal(draft, s.current)) set({ current: draft, serial: s.serial + 1, dirty: !equal(draft, s.base), previous: [...s.previous.slice(-49), s.current], next: [] }); },
    undo() { const s = get(), previous = s.previous.at(-1); if (previous) set({ current: previous, previous: s.previous.slice(0, -1), next: [s.current, ...s.next].slice(0, 50), dirty: !equal(previous, s.base), serial: s.serial + 1 }); },
    redo() { const s = get(), next = s.next[0]; if (next) set({ current: next, next: s.next.slice(1), previous: [...s.previous.slice(-49), s.current], dirty: !equal(next, s.base), serial: s.serial + 1 }); },
    accept(project, serial) { const s = get(), base = content(project); if (serial === undefined) set({ current: base, base, version: project.version, dirty: false, previous: [], next: [], serial: s.serial + 1 }); else set({ base, version: project.version, ...(s.serial === serial ? { current: base, dirty: false } : { dirty: !equal(s.current, base) }) }); }
  }));
}
export function applyStudioBrand(doc: StudioDocument, style: StudioDocument['brand']) {
  const previous = doc.brand, colors = new Map([[previous.primaryColor.toLowerCase(), style.primaryColor], [previous.accentColor.toLowerCase(), style.accentColor], [previous.textColor.toLowerCase(), style.textColor]]);
  for (const segment of doc.segments) {
    segment.backgroundColor = colors.get(segment.backgroundColor.toLowerCase()) || segment.backgroundColor;
    for (const element of segment.elements) {
      if (element.type === 'text') element.color = colors.get(element.color.toLowerCase()) || element.color;
      if (element.type === 'shape') element.fill = colors.get(element.fill.toLowerCase()) || element.fill;
    }
  }
  doc.brand = structuredClone(style);
  for (const t of doc.timeline?.tracks || []) for (const c of t.clips) if ('color' in c.source) c.source.color = colors.get(c.source.color.toLowerCase()) || c.source.color;
}
