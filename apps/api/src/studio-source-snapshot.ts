import { createHash } from 'node:crypto';
import { canonical,type Principal } from '@digitalguide/domain';
import type { StudioDocument } from '@digitalguide/contracts';
import type { StudioService } from './studio-service.js';
export function studioSourceSnapshot(studio: StudioService,p: Principal,workspaceId: string,purpose: 'video'|'presentation',doc: StudioDocument) {
  studio.validate(p,workspaceId,purpose,doc);
  const resources = doc.segments.map(s => studio.resources(p,workspaceId,purpose,doc,s.id)),timeline = doc.timeline ? studio.timelineResources(p,workspaceId,purpose,doc) : null,ids = new Set([...resources.flatMap(r => r.assets.map(a => a.id)),...(timeline?.assets.map(a => a.id) || [])]);
  const assets = [...ids].sort().map(id => { const a = studio.repo.asset(p,id);return { id: a.id,version: a.version,sha256: a.sha256,expiresAt: a.expiresAt }; });
  const profiles = doc.speakers.filter(s => s.profileId).map(s => studio.repo.profile(p,s.profileId!));
  const snapshot = { document: doc,resources,timeline,assets,profiles };return { snapshot,hash: createHash('sha256').update(canonical(snapshot)).digest('hex') };
}
