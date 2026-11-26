import { describe,expect,it } from 'vitest';
import { blankStudioDocument,studioDocument } from '@digitalguide/contracts';
import { estimateWordCues,applyWordCues,validateWordCues,translatedDocument } from '@digitalguide/domain';
import { enableTimeline,newTimelineClip } from '../../packages/domain/src/timeline.js';
describe('T22语言工程及逐词字幕',()=>{
 it('移动过的专业时间线用实际关联起点，译文和逐词字幕不回到脚本累计起点',()=>{
  const source=blankStudioDocument();source.segments[0].text='hello world';enableTimeline(source);for(const t of source.timeline!.tracks)for(const c of t.clips)c.startMs+=2000;const cues=estimateWordCues(source,'en-US',[source.segments[0].id]);expect(cues[0].startMs).toBe(2000);expect(cues.at(-1)!.endMs).toBe(2000+source.segments[0].durationMs);const target=translatedDocument(source,[{segmentId:source.segments[0].id,text:'你好世界'}]);expect(target.timeline!.tracks.filter(t=>t.type==='subtitle'&&!t.muted)[0].clips[0].startMs).toBe(2000);
 });
 it('逐词估算保留标点和分镜时间，应用为实际文字轨并保留原轨/原稿，校对影响输出文字',()=>{
  const source=blankStudioDocument();source.segments[0].text='Hello, DigitalGuide!';const before=structuredClone(source),cues=estimateWordCues(source,'en-US',[source.segments[0].id]);expect(cues.map(c=>c.text)).toEqual(['Hello,','DigitalGuide!']);expect(cues[0].startMs).toBe(0);expect(cues.at(-1)!.endMs).toBe(source.segments[0].durationMs);cues[0].text='Welcome,';const result=applyWordCues(source,cues,'en-US');studioDocument.parse(result.document);expect(source).toEqual(before);expect(result.document.timeline!.tracks.filter(t=>t.type==='subtitle'&&!t.muted)).toHaveLength(1);expect(result.document.timeline!.tracks.find(t=>t.id===result.trackId)!.clips.map(c=>c.source)).toEqual(cues.map(c=>({type:'text',text:c.text,fontSize:28,color:source.brand.textColor,bold:false,align:'center'})));
 });
 it('锁定轨不被绕过，重复/重叠/跨分镜/极短字幕和过密脚本拒绝',()=>{
  const source=blankStudioDocument();source.segments[0].text='one two';enableTimeline(source);const cues=estimateWordCues(source,'en-US',[source.segments[0].id]);source.timeline!.tracks.find(t=>t.type==='subtitle')!.locked=true;expect(()=>applyWordCues(source,cues,'en-US')).toThrow('锁定');for(const changed of [[cues[0],{...cues[1],id:cues[0].id}],[cues[0],{...cues[1],startMs:1}],[{...cues[0],endMs:source.segments[0].durationMs+1}],[{...cues[0],endMs:50}]])expect(()=>validateWordCues(source,changed)).toThrow('字幕编号');source.segments[0].text='word '.repeat(101);source.segments[0].durationMs=1000;expect(()=>estimateWordCues(source,'en-US',[source.segments[0].id])).toThrow('过密');
 });
 it('人工译文独立成工程，原配音和旧字幕保留但静音，原音乐/布局不变，新字幕读目标文字',()=>{
  const source=blankStudioDocument();source.segments[0].text='欢迎';source.speakers[0].voiceAssetId=crypto.randomUUID();enableTimeline(source);const oldSub=source.timeline!.tracks.find(t=>t.type==='subtitle')!;oldSub.clips[0].source={type:'text',text:'人工旧字幕',fontSize:28,color:'#FFFFFF',bold:false,align:'center'};const music=source.timeline!.tracks.find(t=>t.type==='music')!;music.clips.push(newTimelineClip({type:'asset',assetId:crypto.randomUUID()}));const before=structuredClone(source),target=translatedDocument(source,[{segmentId:source.segments[0].id,text:'Welcome'}]);studioDocument.parse(target);expect(source).toEqual(before);expect(target.speakers[0].voiceAssetId).toBeNull();expect(target.timeline!.tracks.find(t=>t.type==='voice')!.muted).toBe(true);expect(target.timeline!.tracks.find(t=>t.id===oldSub.id)!).toMatchObject({muted:true});expect(target.timeline!.tracks.find(t=>t.type==='music')).toEqual(music);expect(target.timeline!.tracks.filter(t=>t.type==='subtitle'&&!t.muted).flatMap(t=>t.clips).every(c=>c.source.type==='segment_subtitle')).toBe(true);expect(target.segments[0].text).toBe('Welcome');
 });
 it('译文必须与每个分镜一一对应，不补空白或复制原文伪造翻译',()=>{
  const source=blankStudioDocument();expect(()=>translatedDocument(source,[])).toThrow('每个分镜');expect(()=>translatedDocument(source,[{segmentId:crypto.randomUUID(),text:'foreign'}])).toThrow('每个分镜');
 });
});
