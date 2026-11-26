import type { StudioDocument } from '@digitalguide/contracts';

export interface SubtitleCue { startMs: number;endMs: number;text: string }
export function timelineSubtitles(doc: StudioDocument,startMs: number,durationMs: number): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const track of doc.timeline?.tracks || []) if (track.type === 'subtitle' && !track.muted) for (const clip of track.clips) {
    if (clip.muted) continue;
    const text = clip.source.type === 'text' ? clip.source.text : clip.source.type === 'segment_subtitle' ? doc.segments.find(s => s.id === clip.segmentId)?.text || '' : '';
    const start = Math.max(startMs,clip.startMs),end = Math.min(startMs+durationMs,clip.startMs+clip.durationMs);
    // Strip control characters and markup so imported dialogue cannot create subtitle commands.
    const clean = [...text].filter(c => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) || '\t\n\r'.includes(c)).join('').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').trim();
    if (end > start && clean) cues.push({ startMs: start-startMs,endMs: end-startMs,text: clean });
  }
  return cues.sort((a,b) => a.startMs-b.startMs);
}
function timestamp(ms: number,separator: '.'|',') { const n = Math.round(ms),h = Math.floor(n/3600000),m = Math.floor(n/60000)%60,s = Math.floor(n/1000)%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${separator}${String(n%1000).padStart(3,'0')}`; }
export function subtitleFiles(cues: SubtitleCue[]) {
  const srt = cues.map((c,i) => `${i+1}\n${timestamp(c.startMs,',')} --> ${timestamp(c.endMs,',')}\n${c.text.replace(/\r?\n\s*\r?\n/g,'\n')}\n`).join('\n');
  const vtt = 'WEBVTT\n\n'+cues.map(c => `${timestamp(c.startMs,'.')} --> ${timestamp(c.endMs,'.')}\n${c.text.replace(/\r?\n\s*\r?\n/g,'\n')}\n`).join('\n');
  return { srt,vtt };
}
