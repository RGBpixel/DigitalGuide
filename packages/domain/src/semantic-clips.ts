import {createHash} from 'node:crypto';
import {AppError,canonical} from './index.js';
import type {MediaProcessingConfiguration,SemanticSourceSnapshot,SemanticClipAnalysis} from '@digitalguide/contracts';
export function semanticWindows(source:SemanticSourceSnapshot,config:Extract<MediaProcessingConfiguration,{operation:'semantic_split'}>){
 if(!config.semantic||!config.instruction.trim()||config.semantic.minClipMs>config.semantic.maxClipMs)throw new AppError('SEMANTIC_CONFIGURATION','请填写检索主题、选择已确认的带时间校对稿，并核对最短/最长时长。',409);
 const from=config.startMs,to=from+(config.durationMs??source.sourceStartMs+source.sourceDurationMs-from);
 if(from<source.sourceStartMs||to>source.sourceStartMs+source.sourceDurationMs||to-from<100)throw new AppError('SEMANTIC_TRANSCRIPT_RANGE','分析区间必须位于这份校对稿的原片时间范围内；请调整起点和时长。',409);
 let prior=source.sourceStartMs;const ids=new Set<string>();for(const s of source.segments){if(ids.has(s.id)||s.startMs<prior||s.endMs<=s.startMs||s.endMs>source.sourceStartMs+source.sourceDurationMs)throw new AppError('SEMANTIC_TIMING_INVALID','校对稿时间须按顺序排列且不重叠，请先修正校对稿。',409);prior=s.endMs;ids.add(s.id);}
 const segments=source.segments.filter(s=>s.startMs>=from&&s.endMs<=to),windows:Omit<SemanticClipAnalysis['candidates'][number],'score'|'name'>[]=[];let overlong=0;
 for(let i=0;i<segments.length;i++){if(segments[i].endMs-segments[i].startMs>config.semantic.maxClipMs){overlong++;continue;}let added=0;
  for(let j=i;j<segments.length;j++){if(j>i&&(segments[j].startMs-segments[j-1].endMs>2000||segments[j].startMs<segments[j-1].endMs))break;const durationMs=segments[j].endMs-segments[i].startMs;if(durationMs>config.semantic.maxClipMs)break;if(durationMs<config.semantic.minClipMs)continue;
   const selected=segments.slice(i,j+1),segmentIds=selected.map(s=>s.id),text=selected.map(s=>s.text).join('\n'),startMs=selected[0].startMs,id=createHash('sha256').update(canonical({policy:'whole-phrase-window-nms-v1',review:source.reviewSha256,query:config.instruction.trim(),segmentIds,startMs,durationMs})).digest('hex');windows.push({id,startMs,durationMs,segmentIds,text});if(windows.length>512)throw new AppError('SEMANTIC_WINDOW_LIMIT','候选窗口超过512个，请缩短分析区间或提高最短片段时长；不会截掉后半段。',409);if(++added===3)break;
  }
 }
 if(!windows.length)throw new AppError('SEMANTIC_NO_TIMED_WINDOW','没有满足时长的完整短语；请调整片段时长或先校对短语边界，系统不会伪造逐字时间。',409);
 return{windows,overlong,phrasesInRange:segments.length,partialPhrases:source.segments.filter(s=>s.startMs<to&&s.endMs>from&&(s.startMs<from||s.endMs>to)).length};
}
export function selectSemanticWindows(scored:SemanticClipAnalysis['candidates'],maxCandidates:number){const ordered=[...scored].sort((a,b)=>b.score-a.score||a.startMs-b.startMs||a.durationMs-b.durationMs||a.id.localeCompare(b.id)),selected:typeof scored=[];for(const c of ordered){if(selected.every(s=>c.startMs>=s.startMs+s.durationMs||s.startMs>=c.startMs+c.durationMs))selected.push({...c,name:'主题候选 '+(selected.length+1)});if(selected.length===maxCandidates)break;}return selected;}
