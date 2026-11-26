import {createCanvas,type SKRSContext2D} from '@napi-rs/canvas';
import type {StudioDocument,TimelineClip} from '@digitalguide/contracts';
import {AppError} from '@digitalguide/domain';
import {wrapText,textFont} from './text-layout.js';

export interface CaptionBox {text:string;x:number;y:number;width:number;height:number;fontSize:number;family:string;bold:boolean;align:'left'|'center'|'right'}
export interface CaptionLayout {font:string;ascent:number;descent:number;step:number;pages:{lines:string[];weight:number}[]}
const cache=new Map<string,CaptionLayout>(),graphemes=new Intl.Segmenter('und',{granularity:'grapheme'});
const tooSmall=()=>new AppError('SUBTITLE_BOX_TOO_SMALL','字幕框无法容纳一个完整字形，请增大字幕框或减小字号后重试。',409);
/** Measure in document units so preview, FHD and UHD choose identical pages. */
export function captionLayout(ctx:SKRSContext2D,box:CaptionBox):CaptionLayout{
 const font=textFont(box.fontSize,box.family,box.bold),key=JSON.stringify([font,box.width,box.height,box.text]);const cached=cache.get(key);if(cached){cache.delete(key);cache.set(key,cached);return cached;}
 if(!Number.isFinite(box.width)||!Number.isFinite(box.height)||!Number.isFinite(box.fontSize)||box.width<=0||box.height<=0||box.fontSize<=0)throw tooSmall();
 ctx.save();ctx.font=font;ctx.textBaseline='alphabetic';ctx.textAlign='left';
 const inkWidth=(m:ReturnType<SKRSContext2D['measureText']>)=>Math.max(m.width,m.actualBoundingBoxLeft+m.actualBoundingBoxRight);
 try{const lines=wrapText(box.text,box.width,text=>inkWidth(ctx.measureText(text))),metrics=lines.filter(Boolean).map(text=>ctx.measureText(text)),ascent=Math.max(0,...metrics.map(m=>m.actualBoundingBoxAscent)),descent=Math.max(0,...metrics.map(m=>m.actualBoundingBoxDescent)),step=Math.max(box.fontSize*1.35,ascent+descent),rows=Math.floor((box.height-ascent-descent+1e-7)/step)+1;
  if(metrics.length&&(rows<1||metrics.some(m=>inkWidth(m)>box.width+1e-7)))throw tooSmall();
  const pages:CaptionLayout['pages']=[];if(metrics.length)for(let i=0;i<lines.length;i+=rows){const page=lines.slice(i,i+rows),weight=[...graphemes.segment(page.join(''))].filter(g=>g.segment.trim()).length;pages.push({lines:page,weight:Math.max(1,weight)});}
  const result={font,ascent,descent,step,pages};cache.set(key,result);if(cache.size>256)cache.delete(cache.keys().next().value!);return result;
 }finally{ctx.restore();}
}
/** Display-only estimates. Authored text and subtitle cue timestamps are never rewritten. */
export function captionPageIntervals(layout:CaptionLayout,durationMs:number){
 if(!Number.isFinite(durationMs)||durationMs<=0)throw new AppError('SUBTITLE_TIME_INVALID','字幕时长无效，请重新核对片段范围。',409);
 const n=layout.pages.length;if(!n)return[];const minimum=n>1?100:0;if(durationMs<n*minimum)throw new AppError('SUBTITLE_TIMING_TOO_DENSE','长字幕分页时间不足，请延长字幕片段，缩短单条字幕，或到字幕制作页拆分并校对。',409);
 const total=layout.pages.reduce((s,p)=>s+p.weight,0),remaining=durationMs-n*minimum;let sum=0;
 return layout.pages.map((page,index)=>{const startMs=index*minimum+Math.round(remaining*sum/total);sum+=page.weight;const endMs=index===n-1?durationMs:(index+1)*minimum+Math.round(remaining*sum/total);return{...page,index,startMs,endMs};});
}
export function captionAtTime(layout:CaptionLayout,timeMs:number,durationMs:number){const pages=captionPageIntervals(layout,durationMs);if(!Number.isFinite(timeMs))throw new AppError('SUBTITLE_TIME_INVALID','字幕播放位置无效。',409);return pages.find(p=>Math.max(0,timeMs)<p.endMs)??pages.at(-1)??null;}
export function drawCaption(ctx:SKRSContext2D,box:CaptionBox,timeMs:number,durationMs:number,color:string){
 const layout=captionLayout(ctx,box),page=captionAtTime(layout,timeMs,durationMs);if(!page)return{pageIndex:0,pageCount:0};
 ctx.save();try{ctx.beginPath();ctx.rect(box.x,box.y,box.width,box.height);ctx.clip();ctx.font=layout.font;ctx.fillStyle=color;ctx.textBaseline='alphabetic';ctx.textAlign=box.align;
  const x=box.align==='left'?box.x:box.align==='center'?box.x+box.width/2:box.x+box.width;page.lines.forEach((line,i)=>{if(line){const m=ctx.measureText(line),inkX=Math.min(Math.max(x,box.x+m.actualBoundingBoxLeft),box.x+box.width-m.actualBoundingBoxRight);ctx.fillText(line,inkX,box.y+layout.ascent+i*layout.step);}});
 }finally{ctx.restore();}return{pageIndex:page.index,pageCount:layout.pages.length};
}
export function segmentCaptionBox(doc:StudioDocument,text:string,width=doc.canvas.width*.89,height=doc.canvas.height*.08):CaptionBox{
 const fontSize=Math.max(16,doc.canvas.height*.027),inset=Math.min(height/4,Math.max(1,fontSize*.08));return{text,x:width*.02,y:inset,width:width*.96,height:height-2*inset,fontSize,family:doc.brand.fontFamily,bold:false,align:'left'};
}
export function clipCaptionBox(doc:StudioDocument,clip:TimelineClip):CaptionBox|null{
 const width=doc.canvas.width*clip.transform.width,height=doc.canvas.height*clip.transform.height;
 if(clip.source.type==='segment_subtitle')return segmentCaptionBox(doc,doc.segments.find(s=>s.id===clip.segmentId)?.text??'',width,height);
 if(clip.source.type==='text')return{text:clip.source.text,x:0,y:0,width,height,fontSize:clip.source.fontSize,family:doc.brand.fontFamily,bold:clip.source.bold,align:clip.source.align};return null;
}
/** Bounded preflight for visual subtitle jobs; audio/package exports keep their authored cues. */
export function inspectCaptionRendering(doc:StudioDocument,startMs=0,endMs=10800000){
 const ctx=createCanvas(1,1).getContext('2d');let paged=0;
 const check=(box:CaptionBox|null,duration:number)=>{if(!box)return;const layout=captionLayout(ctx,box);captionPageIntervals(layout,duration);if(layout.pages.length>1)paged++;};
 if(doc.timeline){for(const track of doc.timeline.tracks)if(track.type==='subtitle'&&!track.muted)for(const clip of track.clips)if(!clip.muted&&clip.startMs<endMs&&clip.startMs+clip.durationMs>startMs)check(clipCaptionBox(doc,clip),clip.curveDurationMs);}
 else{let start=0;for(const s of doc.segments){if(start<endMs&&start+s.durationMs>startMs)check(segmentCaptionBox(doc,s.text),s.durationMs);start+=s.durationMs;}}
 return{pagedClips:paged};
}
