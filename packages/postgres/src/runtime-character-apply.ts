import {randomUUID} from 'node:crypto';
import type {z} from 'zod';
import {AppError,requirePermission,type Principal} from '../../domain/src/index.js';
import {enableTimeline,newTimelineClip,sliceTimelineClip} from '../../domain/src/timeline.js';
import type {StudioDocument,characterJobApplyInput} from '../../contracts/src/index.js';
import type {NativeCharacterProduction} from './runtime-character-production.js';
import type {NativeCharacterJobRow} from './runtime-character-production-shapes.js';

export async function applyNativeCharacterJob(service:NativeCharacterProduction,p:Principal,row:NativeCharacterJobRow,input:z.infer<typeof characterJobApplyInput>,requestId:string){
 requirePermission(p,'asset.write');service.characters.version(row,input.version);await service.current(p,row);
 if(row.applied_project_version||!row.project_id||!['reference','motion'].includes(row.operation))throw new AppError('CHARACTER_APPLY_STATE','请选择未应用且有实际文件的形象制作任务。',409);
 const studio=service.plans.studio,project=await studio.project(p,row.project_id,true);studio.version(project,input.projectVersion);
 const output=await service.output(p,row),snapshot=service.snapshot(row),range=snapshot.project!;
 if(project.version!==range.version)throw new AppError('CHARACTER_PROJECT_CHANGED','工程版本已变化，请重新制作。',409);
 const doc=JSON.parse(project.document) as StudioDocument;enableTimeline(doc);
 const start=range.startMs,end=start+range.durationMs,overlap=(clip:{startMs:number;durationMs:number})=>clip.startMs<end&&clip.startMs+clip.durationMs>start;
 for(const track of doc.timeline!.tracks)if(!track.muted&&(track.type==='avatar'||input.replaceVoiceTrack&&track.type==='voice')&&track.clips.some(c=>!c.muted&&overlap(c))){
  if(track.locked)throw new AppError('CHARACTER_TRACK_LOCKED','所选区间含锁定的形象/配音轨，请先在工程中解锁。',409);
  for(const clip of [...track.clips])if(!clip.muted&&overlap(clip)){
   const before=Math.max(0,start-clip.startMs),after=Math.min(clip.durationMs,end-clip.startMs),retained=[];
   if(before>0)retained.push({...sliceTimelineClip(clip,0,before),id:randomUUID(),linked:false,name:clip.name.slice(0,80)+' · 保留前段'});
   if(after<clip.durationMs)retained.push({...sliceTimelineClip(clip,after,clip.durationMs),id:randomUUID(),linked:false,name:clip.name.slice(0,80)+' · 保留后段'});
   if(track.clips.length+retained.length>300)throw new AppError('CHARACTER_CLIP_LIMIT','保留区间外片段会超出每轨三百段上限，请先整理原轨。',409);
   clip.muted=true;track.clips.push(...retained);
  }
 }
 const duration=Math.min(range.durationMs,output.durationMs??range.durationMs);
 if(snapshot.voice&&snapshot.voice.specs.durationMs>duration&&!input.trimLongVoice)throw new AppError('CHARACTER_VOICE_TOO_LONG','WAV超出本次区间，请延长制作时长或明确确认裁去声音尾部。',409);
 const hasVoice=!!snapshot.voice||!!output.specs.hasAudio;
 if(hasVoice&&!input.replaceVoiceTrack)throw new AppError('CHARACTER_VOICE_CONFIRM','此产物包含关联声音，请明确确认替换区间配音。',409);
 if(doc.timeline!.tracks.length+(hasVoice?2:1)>24)throw new AppError('CHARACTER_TRACK_LIMIT','请先整理轨道，为形象和关联配音预留位置。',409);
 const assetId=randomUUID(),uploadId=randomUUID();
 await service.db.query('SELECT dg_native_character_materialize($1,$2,$3,$4)',[row.id,p.userId,assetId,uploadId]);
 const asset=await service.core.assets.asset(p,assetId);
 await service.db.query('INSERT INTO asset_versions VALUES($1,$2,$3,dg_utc_now())',[asset.id,asset.version,JSON.stringify(asset)]);
 const clip=newTimelineClip({type:'asset',assetId},{startMs:start,durationMs:duration,transform:{x:.5,y:0,width:.5,height:1,rotation:0,opacity:1},name:'形象制作 · '+(row.operation==='motion'?'原创二维动作':'静态/原片参考')});
 doc.timeline!.tracks.push({id:randomUUID(),type:'avatar',name:'形象制作',order:50,locked:false,muted:false,clips:[clip]});
 if(hasVoice)doc.timeline!.tracks.push({id:randomUUID(),type:'voice',name:'形象制作关联声音',order:0,locked:false,muted:false,clips:[newTimelineClip({type:'asset',assetId:snapshot.voice?.id??assetId},{name:'关联原始声音',startMs:start,durationMs:Math.min(duration,snapshot.voice?.specs.durationMs??duration),voiceRole:'narration'})]});
 await studio.save(p,project.id,project.version,project.name,doc,requestId);
 await service.db.query('UPDATE character_jobs SET applied_project_version=$1,version=version+1,updated_at=dg_utc_now() WHERE id=$2',[project.version+1,row.id]);
 await service.core.audit(p,row.workspace_id,'character.applied',row.id,requestId);
 return row.id;
}
