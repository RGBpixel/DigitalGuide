import {createHash} from 'node:crypto';
import {AppError,canonical} from './index.js';
import {transcriptionReview,type TranscriptionReview,type TranscriptionSnapshot} from '@digitalguide/contracts';
export function validateTranscriptionReview(input:TranscriptionReview,snapshot:TranscriptionSnapshot){const review=transcriptionReview.parse(input),from=snapshot.configuration.startMs,to=from+snapshot.configuration.durationMs,ids=new Set<string>();let end=from;
  for(const s of review.segments){if(ids.has(s.id)||s.startMs<end||s.endMs>to||s.startMs<from||s.endMs-s.startMs<20)throw new AppError('TRANSCRIPTION_REVIEW_RANGE','校对片段编号须唯一、按时间排列且不重叠，每段至少20毫秒并在所选视频区间内。',409);ids.add(s.id);end=s.endMs;}
  const text=review.segments.map(s=>s.text).join('\n');if(text.length>60000)throw new AppError('TRANSCRIPTION_TEXT_LIMIT','校对正文超过60000字，请主动拆分来源；不会自动截断。',409);return{review,text};
}
export const transcriptionReviewHash=(inputHash:string,review:TranscriptionReview)=>createHash('sha256').update(canonical({inputHash,review})).digest('hex');
export function transcriptionSubtitles(review:TranscriptionReview,kind:'srt'|'vtt'){
  const time=(ms:number)=>{const h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60,f=ms%1000;return`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${kind==='srt'?',':'.'}${String(f).padStart(3,'0')}`;};
  const text=(s:string)=>s.replace(/-->/g,'→').replace(/\r\n?/g,'\n').replace(/\n\s*\n/g,'\n').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');return(kind==='vtt'?'WEBVTT\n\n':'')+review.segments.map((s,i)=>`${kind==='srt'?i+1+'\n':''}${time(s.startMs)} --> ${time(s.endMs)}\n${text(s.text)}\n`).join('\n');
}
