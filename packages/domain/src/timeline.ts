import type { StudioDocument,StudioSegment,StudioTimeline,TimelineClip,TimelineTrack,TimelineTransform,TimelineSuggestion } from '@digitalguide/contracts';
import { studioTimeline } from '@digitalguide/contracts';
import { AppError } from './index.js';
export const timelineTypes = ['background','avatar','voice','music','subtitle','overlay'] as const;
export const timelineNames = { background: '背景',avatar: '数字人',voice: '旁白与台词',music: '音乐',subtitle: '字幕',overlay: '文字与叠加' };
export const fullTransform = (): TimelineTransform => ({ x: 0,y: 0,width: 1,height: 1,rotation: 0,opacity: 1 });
export function newTimelineClip(source: TimelineClip['source'],input: Partial<Omit<TimelineClip,'source'>> = {}): TimelineClip {
  return { id: crypto.randomUUID(),name: '新片段',segmentId: null,speakerId: null,linked: false,startMs: 0,durationMs: 3000,sourceInMs: 0,playbackRate: 1,source,curveOffsetMs: 0,curveDurationMs: input.durationMs || 3000,transform: fullTransform(),keyframes: [],crop: { left: 0,top: 0,right: 0,bottom: 0 },fit: 'contain',muted: false,volume: 1,loop: false,envelope: [],fadeInMs: 0,fadeOutMs: 0,transitionIn: 'none',transitionMs: 0,color: { brightness: 1,contrast: 1,saturation: 1 },actorState: 'auto',voiceRole: 'dialogue',...input };
}
function segmentClips(s: StudioSegment,startMs: number): { type: TimelineTrack['type']; clip: TimelineClip }[] {
  return timelineTypes.filter(type => type !== 'music' && (!(type === 'avatar' || type === 'voice') || !!s.speakerId)).map(type => {
    const sources = { background: 'segment_background',avatar: 'segment_avatar',voice: 'segment_narration',subtitle: 'segment_subtitle',overlay: 'segment_elements' } as const;
    const transform = type === 'avatar' ? { ...s.avatar,rotation: 0,opacity: 1 } : type === 'subtitle' ? { ...fullTransform(),x: 0.055,y: 0.855,width: 0.89,height: 0.08 } : fullTransform();
    return { type,clip: newTimelineClip({ type: sources[type as keyof typeof sources] },{ name: s.title,segmentId: s.id,speakerId: type === 'avatar' || type === 'voice' ? s.speakerId : null,linked: true,startMs,durationMs: s.durationMs,transform }) };
  });
}
export function enableTimeline(doc: StudioDocument) {
  if (doc.timeline) return;
  const timeline: StudioTimeline = { schemaVersion: 1,snapMs: 80,tracks: timelineTypes.map((type,order) => ({ id: crypto.randomUUID(),type,name: timelineNames[type],order: order * 10,locked: false,muted: false,clips: [] })) };
  let start = 0; for (const segment of doc.segments) { for (const { type,clip } of segmentClips(segment,start)) timeline.tracks.find(t => t.type === type)!.clips.push(clip); start += segment.durationMs; } doc.timeline = timeline;
}
export function validateTimeline(doc: StudioDocument) {
  if (!doc.timeline) return;
  const timeline = studioTimeline.parse(doc.timeline), ids = [...timeline.tracks.map(t => t.id),...timeline.tracks.flatMap(t => t.clips.map(c => c.id))];
  const existing = new Set([...doc.speakers.map(s => s.id),...doc.segments.flatMap(s => [s.id,...s.elements.map(e => e.id)])]);
  if (new Set(ids).size !== ids.length || ids.some(id => existing.has(id))) throw new AppError('DUPLICATE_TIMELINE_ID','轨道和片段编号必须唯一。');
  if (timeline.tracks.reduce((n,t) => n+t.clips.length,0) > 1000) throw new AppError('TIMELINE_TOO_LARGE','一个工程最多一千个片段，请拆分工程。');
  if (timelineTypes.some(type => !timeline.tracks.some(t => t.type === type))) throw new AppError('MISSING_TRACK_TYPE','请保留背景、数字人、旁白、音乐、字幕和叠加六类轨道，可清空片段。');
  const allowed: Record<TimelineTrack['type'],string[]> = { background: ['segment_background','color','asset'],avatar: ['segment_avatar','speaker_avatar','asset'],voice: ['segment_narration','asset'],music: ['asset'],subtitle: ['segment_subtitle','text'],overlay: ['segment_elements','text','shape','asset'] };
  for (const track of timeline.tracks) for (const c of track.clips) {
    if (!allowed[track.type].includes(c.source.type)) throw new AppError('INVALID_CLIP_SOURCE','片段来源不适用于当前轨道。');
    if (c.segmentId && !doc.segments.some(s => s.id === c.segmentId)) throw new AppError('INVALID_CLIP_SEGMENT','片段引用的分镜已移除。');
    if (c.source.type.startsWith('segment_') && !c.segmentId) throw new AppError('INVALID_CLIP_SEGMENT','关联来源需要一个有效分镜。');
    if (c.speakerId && !doc.speakers.some(s => s.id === c.speakerId)) throw new AppError('INVALID_SPEAKER','片段引用的角色已移除。');
    if (c.source.type === 'speaker_avatar' && !c.speakerId) throw new AppError('INVALID_SPEAKER','独立角色片段需要选择角色。');
    if (track.type === 'voice' && c.voiceRole === 'dialogue' && !c.speakerId) throw new AppError('INVALID_SPEAKER','角色台词需要指定发言人，独立旁白请选择旁白模式。');
    if (c.startMs+c.durationMs > 10800000 || c.curveOffsetMs+c.durationMs > c.curveDurationMs || c.fadeInMs > c.curveDurationMs || c.fadeOutMs > c.curveDurationMs || c.transitionMs > c.curveDurationMs) throw new AppError('INVALID_CLIP_RANGE','片段时长、淡入淡出或曲线范围无效。');
    if (c.crop.left+c.crop.right >= 1 || c.crop.top+c.crop.bottom >= 1) throw new AppError('INVALID_CROP','裁切后必须保留有效画面。');
    for (const points of [c.keyframes,c.envelope]) if (points.some((p,i) => p.timeMs > c.curveDurationMs || (i > 0 && p.timeMs <= points[i-1].timeMs))) throw new AppError('INVALID_CURVE','关键帧和音量节点须按时间递增且在曲线范围内。');
  }
  const events = timeline.tracks.flatMap(t => t.clips.flatMap(c => [{ time: c.startMs,delta: 1 },{ time: c.startMs+c.durationMs,delta: -1 }])).sort((a,b) => a.time-b.time || a.delta-b.delta);let simultaneous = 0;for (const e of events) { simultaneous += e.delta;if (simultaneous > 32) throw new AppError('TIMELINE_TOO_DENSE','同一时刻最多三十二个片段，请合并素材或错开时间。'); }
}
export function timelineDuration(doc: StudioDocument) { return doc.timeline ? Math.max(0,...doc.timeline.tracks.flatMap(t => t.clips.map(c => c.startMs+c.durationMs))) : doc.segments.reduce((n,s) => n+s.durationMs,0); }
export function activeTimelineClips(doc: StudioDocument,timeMs: number) { return (doc.timeline?.tracks || []).slice().sort((a,b) => a.order-b.order).flatMap(track => track.clips.filter(c => timeMs >= c.startMs && timeMs < c.startMs+c.durationMs).slice().sort((a,b) => a.startMs-b.startMs).map(clip => ({ track,clip,localMs: timeMs-clip.startMs }))); }
const lerp = (a: number,b: number,t: number) => a+(b-a)*t;
export function transformAt(c: TimelineClip,localMs: number): TimelineTransform {
  const time = localMs+c.curveOffsetMs, points = c.keyframes;
  if (!points.length) return { ...c.transform };
  const previous = points.filter(p => p.timeMs <= time).at(-1),next = points.find(p => p.timeMs > time);
  const from = previous || { ...c.transform,timeMs: 0,easing: 'linear' },to = next || from,ratio = to === from || from.easing === 'hold' ? 0 : Math.min(1,Math.max(0,(time-from.timeMs)/(to.timeMs-from.timeMs)));
  return Object.fromEntries((['x','y','width','height','rotation','opacity'] as const).map(key => [key,lerp(from[key],to[key],ratio)])) as TimelineTransform;
}
export function gainAt(c: TimelineClip,localMs: number) {
  const time = localMs+c.curveOffsetMs,previous = c.envelope.filter(p => p.timeMs <= time).at(-1),next = c.envelope.find(p => p.timeMs > time),from = previous || { timeMs: 0,gain: 1 };
  const envelope = next ? lerp(from.gain,next.gain,Math.min(1,Math.max(0,(time-from.timeMs)/(next.timeMs-from.timeMs)))) : from.gain;
  return c.muted ? 0 : c.volume*envelope*Math.min(1,c.fadeInMs ? time/c.fadeInMs : 1)*Math.min(1,c.fadeOutMs ? (c.curveDurationMs-time)/c.fadeOutMs : 1);
}
export function visualOpacityAt(c: TimelineClip,localMs: number) { const t = localMs+c.curveOffsetMs; return transformAt(c,localMs).opacity*Math.max(0,Math.min(1,c.fadeInMs ? t/c.fadeInMs : 1,c.fadeOutMs ? (c.curveDurationMs-t)/c.fadeOutMs : 1,c.transitionIn === 'fade' && c.transitionMs ? t/c.transitionMs : 1)); }
export function speakerStatesAt(doc: StudioDocument,timeMs: number) {
  const active = activeTimelineClips(doc,timeMs),voices = active.filter(a => a.track.type === 'voice'),speaking = new Set(voices.filter(v => v.clip.voiceRole === 'dialogue').map(v => v.clip.speakerId)),states: Record<string,'speaking'|'listening'|'silent'> = {};
  for (const { track,clip } of active) if (track.type === 'avatar' && clip.speakerId) states[clip.speakerId] = clip.actorState === 'auto' ? speaking.has(clip.speakerId) ? 'speaking' : voices.length ? 'listening' : 'silent' : clip.actorState;
  return states;
}
export function sliceTimelineClip(c: TimelineClip,fromMs: number,toMs: number): TimelineClip {
  if (!Number.isInteger(fromMs) || !Number.isInteger(toMs) || fromMs < 0 || toMs > c.durationMs || toMs-fromMs < 100) throw new AppError('INVALID_CUT','每段至少保留 0.1 秒，请调整剪切位置。');
  return { ...structuredClone(c),id: fromMs ? crypto.randomUUID() : c.id,startMs: c.startMs+fromMs,durationMs: toMs-fromMs,sourceInMs: Math.round(c.sourceInMs+fromMs*c.playbackRate),curveOffsetMs: c.curveOffsetMs+fromMs };
}
export function preserveVoiceOutsideRanges(doc:StudioDocument,windows:{startMs:number;durationMs:number}[],selectedSegmentIds?:string[]) {
  if(!doc.timeline)return;
  const ranges=windows.map(w=>({start:w.startMs,end:w.startMs+w.durationMs})).sort((a,b)=>a.start-b.start),merged:{start:number;end:number}[]=[];
  for(const range of ranges){if(!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<=range.start)throw new AppError('INVALID_CLIP_RANGE','配音范围无效。',409);const last=merged.at(-1);if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else merged.push({...range});}
  const timeline=structuredClone(doc.timeline);
  for(const track of timeline.tracks){
    if(track.type!=='voice'||track.muted)continue;
    const result:TimelineClip[]=[];
    for(const clip of track.clips){
      if(selectedSegmentIds&&clip.segmentId&&!selectedSegmentIds.includes(clip.segmentId)){result.push(clip);continue;}
      const overlaps=clip.muted?[]:merged.filter(r=>clip.startMs<r.end&&clip.startMs+clip.durationMs>r.start);
      if(!overlaps.length){result.push(clip);continue;}
      if(track.locked)throw new AppError('SPEECH_TRACK_LOCKED','所选时段有锁定的可听配音轨，请先解锁或静音。',409);
      const original=structuredClone(clip);clip.muted=true;result.push(clip);let cursor=0;
      for(const range of overlaps){
        const from=Math.max(0,range.start-original.startMs),to=Math.min(original.durationMs,range.end-original.startMs);
        if(from>cursor){if(from-cursor<100)throw new AppError('SPEECH_CLIP_FRAGMENT','区间外配音不足0.1秒，请先调整切点或人工拆分，不会静默丢弃。',409);result.push({...sliceTimelineClip(original,cursor,from),id:crypto.randomUUID()});}
        cursor=Math.max(cursor,to);
      }
      if(cursor<original.durationMs){if(original.durationMs-cursor<100)throw new AppError('SPEECH_CLIP_FRAGMENT','区间外配音不足0.1秒，请先调整切点或人工拆分。',409);result.push({...sliceTimelineClip(original,cursor,original.durationMs),id:crypto.randomUUID()});}
    }
    track.clips=result;
  }
  if(timeline.tracks.reduce((n,t)=>n+t.clips.length,0)>1000)throw new AppError('TIMELINE_TOO_LARGE','保留区间外配音后超过一千片段，请先整理工程。',409);
  doc.timeline=timeline;
}
export function retimeTimelineClip(c: TimelineClip,durationMs: number) {
  if (!Number.isInteger(durationMs) || durationMs < 100) throw new AppError('INVALID_CLIP_RANGE','片段至少 0.1 秒。');
  const ratio = durationMs/c.durationMs;c.curveOffsetMs = Math.round(c.curveOffsetMs*ratio);c.curveDurationMs = Math.max(c.curveOffsetMs+durationMs,Math.round(c.curveDurationMs*ratio));c.durationMs = durationMs;
  c.keyframes = c.keyframes.map(p => ({ ...p,timeMs: Math.round(p.timeMs*ratio) }));c.envelope = c.envelope.map(p => ({ ...p,timeMs: Math.round(p.timeMs*ratio) }));c.fadeInMs = Math.round(c.fadeInMs*ratio);c.fadeOutMs = Math.round(c.fadeOutMs*ratio);c.transitionMs = Math.round(c.transitionMs*ratio);
  // Nodes that collide under a faster rate retain the last explicitly authored value.
  c.keyframes = [...new Map(c.keyframes.map(p => [p.timeMs,p])).values()];c.envelope = [...new Map(c.envelope.map(p => [p.timeMs,p])).values()];
}
export function snapTimelineStart(doc: StudioDocument,startMs: number,excludeIds: string[],playheadMs = 0) {
  const tolerance = doc.timeline?.snapMs || 0;if (!tolerance) return Math.round(Math.max(0,startMs));
  const points = [0,playheadMs,...(doc.timeline?.tracks || []).flatMap(t => t.clips.filter(c => !excludeIds.includes(c.id)).flatMap(c => [c.startMs,c.startMs+c.durationMs]))];
  const nearest = points.reduce((best,p) => Math.abs(p-startMs) < Math.abs(best-startMs) ? p : best,points[0]);return Math.round(Math.max(0,Math.abs(nearest-startMs) <= tolerance ? nearest : startMs));
}
export function editTimelineClip(doc: StudioDocument,clipId: string,change: (clip: TimelineClip,track: TimelineTrack) => void) {
  const track = doc.timeline?.tracks.find(t => t.clips.some(c => c.id === clipId));if (!track) throw new AppError('NOT_FOUND','片段不存在。');if (track.locked) throw new AppError('TRACK_LOCKED','请先解锁该轨道。');change(track.clips.find(c => c.id === clipId)!,track);
}
export function splitTimelineClip(doc: StudioDocument,clipId: string,atMs: number,group = false) {
  const selected = doc.timeline?.tracks.flatMap(t => t.clips).find(c => c.id === clipId);if (!selected) throw new AppError('NOT_FOUND','片段不存在。');
  const targets = (doc.timeline?.tracks || []).flatMap(t => t.clips).filter(c => (c.id === clipId || (group && selected.segmentId && c.segmentId === selected.segmentId && c.linked)) && c.startMs < atMs && atMs < c.startMs+c.durationMs);
  for (const c of targets) editTimelineClip(doc,c.id,(clip,track) => { const left = sliceTimelineClip(clip,0,atMs-clip.startMs),right = sliceTimelineClip(clip,atMs-clip.startMs,clip.durationMs);track.clips.splice(track.clips.indexOf(clip),1,left,right); });
  if (!targets.length) throw new AppError('INVALID_CUT','播放头需要位于片段内部。');
}
export function moveTimelineClip(doc: StudioDocument,clipId: string,startMs: number,group = false,playheadMs = 0) {
  const selected = doc.timeline?.tracks.flatMap(t => t.clips).find(c => c.id === clipId);if (!selected) throw new AppError('NOT_FOUND','片段不存在。');
  const targets = (doc.timeline?.tracks || []).flatMap(t => t.clips).filter(c => c.id === clipId || (group && selected.segmentId && c.segmentId === selected.segmentId && c.linked));
  const next = snapTimelineStart(doc,startMs,targets.map(c => c.id),playheadMs),delta = Math.max(-Math.min(...targets.map(c => c.startMs)),next-selected.startMs);
  for (const target of targets) editTimelineClip(doc,target.id,c => { c.startMs = Math.round(c.startMs+delta);if (!group) c.linked = false; });
  if (group) doc.segments.sort((a,b) => segmentTimelineStart(doc,a.id)-segmentTimelineStart(doc,b.id));
}
export function segmentTimelineStart(doc: StudioDocument,segmentId: string) { const clips = doc.timeline?.tracks.flatMap(t => t.clips).filter(c => c.segmentId === segmentId && c.linked) || [];return clips.length ? Math.min(...clips.map(c => c.startMs)) : doc.segments.slice(0,doc.segments.findIndex(s => s.id === segmentId)).reduce((n,s) => n+s.durationMs,0); }
export function timelineDependencies(doc: StudioDocument,segmentId: string) {
  if (!doc.timeline) return null;const segment = doc.segments.find(s => s.id === segmentId)!,start = segmentTimelineStart(doc,segmentId),end = start+segment.durationMs;
  const tracks = doc.timeline.tracks.map(t => ({ ...t,clips: t.clips.filter(c => c.startMs < end && c.startMs+c.durationMs > start) })).filter(t => t.clips.length);
  const dependencies = new Map<string,{ id: string;backgroundColor?: string;elements?: StudioSegment['elements'];text?: string }>(),speakers = new Set(tracks.flatMap(t => t.clips.map(c => c.speakerId)).filter((id): id is string => !!id));
  for (const t of tracks) for (const c of t.clips) if (c.segmentId && ['segment_background','segment_elements','segment_subtitle'].includes(c.source.type)) { const s = doc.segments.find(s => s.id === c.segmentId)!,entry = dependencies.get(s.id) || { id: s.id };if (c.source.type === 'segment_background') entry.backgroundColor = s.backgroundColor;if (c.source.type === 'segment_elements') entry.elements = s.elements;if (c.source.type === 'segment_subtitle') entry.text = s.text;dependencies.set(s.id,entry); }
  return { start,end,tracks,segments: [...dependencies.values()].sort((a,b) => a.id.localeCompare(b.id)),speakers: doc.speakers.filter(s => speakers.has(s.id)) };
}
export function reconcileTimeline(before: StudioDocument,after: StudioDocument) {
  if (!before.timeline || !after.timeline || JSON.stringify(before.timeline) !== JSON.stringify(after.timeline)) return;
  const changedOrder = before.segments.map(s => s.id).join() !== after.segments.filter(s => before.segments.some(b => b.id === s.id)).map(s => s.id).join(),oldStart = new Map<string,number>(),newStart = new Map<string,number>();let oldPrefix = 0,newPrefix = 0;
  for (const s of before.segments) { oldStart.set(s.id,oldPrefix);oldPrefix += s.durationMs; }for (const s of after.segments) { newStart.set(s.id,newPrefix);newPrefix += s.durationMs; }
  for (const track of after.timeline.tracks) {
    track.clips = track.clips.filter(c => (c.source.type !== 'speaker_avatar' || after.speakers.some(s => s.id === c.speakerId)) && (!c.segmentId || after.segments.some(s => s.id === c.segmentId) || !c.source.type.startsWith('segment_')));
    for (const c of track.clips) {
      if (c.segmentId && !after.segments.some(s => s.id === c.segmentId)) { c.segmentId = null;c.linked = false; }
      if (c.speakerId && !after.speakers.some(s => s.id === c.speakerId)) { c.speakerId = null;c.voiceRole = 'narration'; }
      const s = after.segments.find(s => s.id === c.segmentId),old = before.segments.find(s => s.id === c.segmentId);if (!s || !old || !c.linked) continue;
      if (c.source.type === 'segment_avatar' || c.source.type === 'segment_narration') { c.speakerId = s.speakerId;if (!s.speakerId) c.voiceRole = 'narration'; }
      const delta = (newStart.get(s.id) || 0)-(oldStart.get(s.id) || 0);c.startMs = Math.max(0,c.startMs+delta);
      if (s.durationMs !== old.durationMs) { const ratio = s.durationMs/old.durationMs,base = segmentTimelineStart(before,s.id);c.startMs = Math.max(0,Math.round(base+delta+(c.startMs-delta-base)*ratio));retimeTimelineClip(c,Math.max(100,Math.round(c.durationMs*ratio))); }
      if (changedOrder) c.startMs = Math.max(0,Math.round(c.startMs));
    }
  }
  for (const s of after.segments.filter(s => !before.segments.some(b => b.id === s.id))) for (const { type,clip } of segmentClips(s,newStart.get(s.id)!)) after.timeline.tracks.find(t => t.type === type)!.clips.push(clip);
}
export function timelineSuggestions(doc: StudioDocument,backgrounds: { id: string;name: string }[] = []): TimelineSuggestion[] {
  const suggestions: TimelineSuggestion[] = [];
  for (const s of doc.segments) {
    const estimated = Math.min(600000,Math.max(1000,Math.ceil([...s.text.replace(/\s/g,'')].length/4.5*1000/100)*100));
    if (s.text && estimated > s.durationMs*1.25) suggestions.push({ id: 'duration:'+s.id,segmentId: s.id,kind: 'duration',title: '留出更充足的讲解时长',reason: '按每秒约 4.5 字的本地粗略规则估计，实际录音仍需人工核对。',durationMs: estimated,source: 'local_rules',requiresReview: true });
    if (s.text.length >= 8) suggestions.push({ id: 'callout:'+s.id,segmentId: s.id,kind: 'callout',title: '增加可编辑的重点文字',reason: '取首句作为候选重点，未由模型判断语义，请审阅后采用。',text: s.text.split(/[。！？.!?]/)[0].slice(0,80),source: 'local_rules',requiresReview: true });
    if (s.speakerId) suggestions.push({ id: 'emphasis:'+s.id,segmentId: s.id,kind: 'emphasis',title: '增加轻微镜头推进',reason: '将推进写入角色关键帧，可继续修改或撤销。',source: 'local_rules',requiresReview: true });
    if (backgrounds[0]) suggestions.push({ id: 'background:'+s.id+':'+backgrounds[0].id,segmentId: s.id,kind: 'background',title: '参考画面候选：'+backgrounds[0].name,reason: '从本工作空间已上传背景中提供候选，未自动判断语义，采用前请核对是否适合此段。',assetId: backgrounds[0].id,source: 'local_rules',requiresReview: true });
  }return suggestions.slice(0,100);
}
export function applyTimelineSuggestion(doc: StudioDocument,suggestion: TimelineSuggestion) {
  const segment = doc.segments.find(s => s.id === suggestion.segmentId);if (!segment) throw new AppError('NOT_FOUND','建议对应的分镜已移除。');enableTimeline(doc);
  if (suggestion.kind === 'duration' && suggestion.durationMs) { const before = structuredClone(doc);segment.durationMs = suggestion.durationMs;reconcileTimeline(before,doc); }
  if (suggestion.kind === 'callout' && suggestion.text) doc.timeline!.tracks.find(t => t.type === 'overlay')!.clips.push(newTimelineClip({ type: 'text',text: suggestion.text,fontSize: 48,color: doc.brand.primaryColor,bold: true,align: 'left' },{ name: '重点文字',segmentId: segment.id,startMs: segmentTimelineStart(doc,segment.id),durationMs: segment.durationMs,linked: true,transform: { ...fullTransform(),x: 0.06,y: 0.64,width: 0.56,height: 0.12 },fadeInMs: 300,fadeOutMs: 300 }));
  if (suggestion.kind === 'emphasis') for (const track of doc.timeline!.tracks.filter(t => t.type === 'avatar')) for (const clip of track.clips.filter(c => c.segmentId === segment.id)) { const from = clip.transform,to = { ...from,x: from.x-from.width*0.025,y: from.y-from.height*0.025,width: from.width*1.05,height: from.height*1.05 };clip.keyframes = [{ ...from,timeMs: 0,easing: 'linear' },{ ...to,timeMs: clip.curveDurationMs,easing: 'linear' }]; }
  if (suggestion.kind === 'background' && suggestion.assetId) { const t = doc.timeline!.tracks.find(t => t.type === 'background')!;if (t.locked) throw new AppError('TRACK_LOCKED','请先解锁背景轨道。');const existing = t.clips.filter(c => c.segmentId === segment.id && c.linked);if (existing.length) for (const c of existing) c.source = { type: 'asset',assetId: suggestion.assetId };else t.clips.push(newTimelineClip({ type: 'asset',assetId: suggestion.assetId },{ name: '建议参考画面',segmentId: segment.id,startMs: segmentTimelineStart(doc,segment.id),durationMs: segment.durationMs,linked: true,fit: 'cover' })); }
}
export function applyDuoLayout(doc: StudioDocument,mode: 'side_by_side'|'speaker_focus'|'interview') {
  if (doc.speakers.length < 2) throw new AppError('TWO_SPEAKERS_REQUIRED','请先配置两个独立角色。');enableTimeline(doc);
  const avatarTracks = doc.timeline!.tracks.filter(t => t.type === 'avatar');if (avatarTracks.some(t => t.locked)) throw new AppError('TRACK_LOCKED','请先解锁数字人轨道，再应用双人布局。');
  const end = timelineDuration(doc),actors = doc.speakers.slice(0,2),track = avatarTracks[0],clip = (speakerId: string,startMs: number,durationMs: number,box: Pick<TimelineTransform,'x'|'y'|'width'|'height'>) => newTimelineClip({ type: 'speaker_avatar' },{ name: doc.speakers.find(s => s.id === speakerId)!.name,segmentId: null,speakerId,startMs,durationMs,transform: { ...fullTransform(),...box },linked: false });
  const voices = doc.timeline!.tracks.filter(t => t.type === 'voice').flatMap(t => t.clips),points = mode === 'side_by_side' ? [0,end] : [...new Set([0,end,...voices.flatMap(c => [c.startMs,c.startMs+c.durationMs])])].filter(t => t >= 0 && t <= end).sort((a,b) => a-b);
  const clips: TimelineClip[] = [];
  for (let i = 0;i < points.length-1;i++) { const start = points[i],duration = points[i+1]-start;if (duration < 100) continue;const speaking = voices.find(c => c.voiceRole === 'dialogue' && c.speakerId && actors.some(a => a.id === c.speakerId) && c.startMs <= start && c.startMs+c.durationMs > start)?.speakerId;
    if (mode === 'side_by_side' || !speaking) for (let n = 0;n < 2;n++) clips.push(clip(actors[n].id,start,duration,{ x: n ? 0.56 : 0.08,y: 0.2,width: 0.36,height: 0.63 }));
    else { clips.push(clip(speaking,start,duration,{ x: 0.22,y: 0.12,width: 0.56,height: 0.73 }));if (mode === 'speaker_focus') clips.push(clip(actors.find(a => a.id !== speaking)!.id,start,duration,{ x: 0.8,y: 0.63,width: 0.17,height: 0.22 })); }
  }
  for (const t of avatarTracks) t.clips = [];track.clips = clips;
}
