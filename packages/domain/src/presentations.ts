import {presentationDefinition,type PresentationDefinition,type StudioDocument,type PresentationChapter} from '@digitalguide/contracts';
import {AppError} from './index.js';
import {enableTimeline,newTimelineClip,timelineDuration,validateTimeline} from './timeline.js';
export function presentationDefaults(doc:StudioDocument):PresentationDefinition {
 return{pages:doc.segments.map(s=>{const chunks:string[]=[];let chunk='';for(const char of s.text.trim()){if(chunk.length+char.length>1000){chunks.push(chunk);chunk='';}chunk+=char;}if(chunk.trim())chunks.push(chunk);const nonempty=chunks.map(c=>c.trim()).filter(Boolean);return{segmentId:s.id,title:s.title,text:s.text,durationMs:s.durationMs,speakerId:s.speakerId,avatar:{...s.avatar},voiceMode:'inherit',voiceAssetId:null,trimVoiceConfirmed:false,captions:nonempty.map((text,i)=>({id:crypto.randomUUID(),startMs:Math.floor(i*s.durationMs/nonempty.length),endMs:Math.floor((i+1)*s.durationMs/nonempty.length),text})),pointers:[],transition:'cut',transitionMs:0};})};
}
export function composePresentation(source:StudioDocument,input:PresentationDefinition):StudioDocument {
 const definition=presentationDefinition.parse(input),pages=definition.pages,ids=pages.map(p=>p.segmentId),cueIds=pages.flatMap(p=>[...p.captions.map(c=>c.id),...p.pointers.map(c=>c.id)]);
 if(new Set(ids).size!==ids.length||new Set(cueIds).size!==cueIds.length)throw new AppError('PRESENTATION_DUPLICATE_ID','页面与字幕/指示编号不能重复。',400);
 if(pages.reduce((n,p)=>n+p.durationMs,0)>10800000)throw new AppError('PRESENTATION_DURATION','讲解最长三小时，请拆分方案。',400);
 const doc=structuredClone(source);doc.timeline=null;
 doc.segments=pages.map(page=>{
  const original=source.segments.find(s=>s.id===page.segmentId);if(!original)throw new AppError('PRESENTATION_PAGE_MISSING','所选页不在固定来源中，请重新建立方案。',409);
  if(page.speakerId&&!source.speakers.some(s=>s.id===page.speakerId))throw new AppError('PRESENTATION_SPEAKER','讲解人不在此工程中，请先在原工程增加角色后建立新方案。',409);
  if(page.avatar.x+page.avatar.width>1.000001||page.avatar.y+page.avatar.height>1.000001)throw new AppError('PRESENTATION_AVATAR_BOUNDS','数字人位置需完整位于画面内。',400);
  if(page.transitionMs>page.durationMs||(page.transition==='cut'&&page.transitionMs!==0))throw new AppError('PRESENTATION_TRANSITION','切换时长需在本页范围，直接切页为零。',400);
  if((page.voiceMode==='asset')!==!!page.voiceAssetId)throw new AppError('PRESENTATION_VOICE','请选择独立音频，或明确使用原角色声音/静音。',400);
  let end=0;for(const cue of page.captions){if(cue.startMs<end||cue.endMs-cue.startMs<100||cue.endMs>page.durationMs)throw new AppError('PRESENTATION_CAPTION_RANGE','字幕须按时间顺序、不重叠、至少0.1秒且在本页内。',400);end=cue.endMs;}
  for(const pointer of page.pointers)if(pointer.startMs+pointer.durationMs>page.durationMs||pointer.x+pointer.width>1.000001||pointer.y+pointer.height>1.000001)throw new AppError('PRESENTATION_POINTER_RANGE','指示的时间和区域需在本页内。',400);
  return{...original,title:page.title,text:page.text,durationMs:page.durationMs,speakerId:page.speakerId,avatar:{...page.avatar}};
 });
 enableTimeline(doc);const timeline=doc.timeline!,voice=timeline.tracks.find(t=>t.type==='voice')!,subtitle=timeline.tracks.find(t=>t.type==='subtitle')!,overlay=timeline.tracks.find(t=>t.type==='overlay')!;subtitle.clips=[];
 let start=0;
 for(const page of pages){
  for(const track of timeline.tracks)for(const clip of track.clips)if(clip.segmentId===page.segmentId&&track.type!=='voice'){clip.transitionIn=page.transition==='cut'?'none':page.transition;clip.transitionMs=page.transitionMs;}
  voice.clips=voice.clips.filter(c=>c.segmentId!==page.segmentId||page.voiceMode==='inherit');
  if(page.voiceMode==='asset')voice.clips.push(newTimelineClip({type:'asset',assetId:page.voiceAssetId!},{name:page.title+' · 独立旁白',segmentId:page.segmentId,speakerId:page.speakerId,voiceRole:page.speakerId?'dialogue':'narration',startMs:start,durationMs:page.durationMs,linked:true}));
  for(const cue of page.captions)subtitle.clips.push(newTimelineClip({type:'text',text:cue.text,fontSize:30,color:doc.brand.textColor,bold:false,align:'center'},{name:page.title+' · 字幕',segmentId:page.segmentId,startMs:start+cue.startMs,durationMs:cue.endMs-cue.startMs,linked:true,transform:{x:.055,y:.855,width:.89,height:.10,rotation:0,opacity:1}}));
  const pointerClip=(p:typeof page.pointers[number],x:number,y:number,width:number,height:number,shape:'rectangle'|'ellipse')=>newTimelineClip({type:'shape',shape,color:p.color},{name:page.title+' · '+(p.label||'重点指示'),segmentId:page.segmentId,startMs:start+p.startMs,durationMs:p.durationMs,linked:true,transform:{x,y,width,height,rotation:0,opacity:p.kind==='spot'?.48:.95}});
  for(const p of page.pointers){
   if(p.kind==='spot')overlay.clips.push(pointerClip(p,p.x,p.y,p.width,p.height,'ellipse'));
   else{const w=Math.min(.008,Math.max(.005,p.width/3)),h=Math.min(.008,Math.max(.005,p.height/3));overlay.clips.push(pointerClip(p,p.x,p.y,p.width,h,'rectangle'),pointerClip(p,p.x,p.y+p.height-h,p.width,h,'rectangle'),pointerClip(p,p.x,p.y,w,p.height,'rectangle'),pointerClip(p,p.x+p.width-w,p.y,w,p.height,'rectangle'));}
   if(p.label.trim())overlay.clips.push(newTimelineClip({type:'text',text:p.label,fontSize:28,color:p.color,bold:true,align:'left'},{name:page.title+' · 指示文字',segmentId:page.segmentId,startMs:start+p.startMs,durationMs:p.durationMs,linked:true,transform:{x:p.x,y:Math.max(0,p.y-.06),width:Math.min(.5,1-p.x),height:.055,rotation:0,opacity:1}}));
  }
  start+=page.durationMs;
 }
 validateTimeline(doc);return doc;
}
// A live page boundary must come from a sequential authored deck, never a guessed slide duration.
export function presentationChapters(doc:StudioDocument):PresentationChapter[] {
 if(!doc.timeline)throw new AppError('PRESENTATION_TIMELINE_REQUIRED','请先在逐页讲解中生成多轨工程并导出完整视频。',409);
 let start=0;const chapters=doc.segments.map(s=>{const result={pageId:s.id,title:s.title,startMs:start,durationMs:s.durationMs};start+=s.durationMs;return result;});
 if(chapters.length>40||start!==timelineDuration(doc))throw new AppError('PRESENTATION_CHAPTER_MISMATCH','页时长与实际时间线不一致，请重新核对逐页工程。',409);
 const background=doc.timeline.tracks.filter(t=>t.type==='background'&&!t.muted).flatMap(t=>t.clips.filter(c=>!c.muted));
 for(const chapter of chapters){const matches=background.filter(c=>c.segmentId===chapter.pageId);if(matches.length!==1||matches[0].startMs!==chapter.startMs||matches[0].durationMs!==chapter.durationMs)throw new AppError('PRESENTATION_CHAPTER_MISMATCH','背景页已被专业编辑重排或分割，请重新建立与成片一致的逐页方案。',409);}
 if(background.length!==chapters.length)throw new AppError('PRESENTATION_CHAPTER_MISMATCH','时间线还有独立背景，请先明确逐页边界。',409);return chapters;
}
export function presentationPosition(row:{state:string;position_ms:number;anchor_at:string|null;duration_ms:number},now=Date.now()){
 const elapsed=row.state==='playing'&&row.anchor_at?Math.max(0,now-Date.parse(row.anchor_at)):0;return Math.min(row.duration_ms,Math.max(0,Math.floor(row.position_ms+elapsed)));
}
export function presentationChapterAt(chapters:PresentationChapter[],positionMs:number){return chapters.find(c=>positionMs>=c.startMs&&positionMs<c.startMs+c.durationMs)||chapters.at(-1)!;}
