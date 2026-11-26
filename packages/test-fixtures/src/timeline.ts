import { blankStudioDocument,type StudioDocument } from '@digitalguide/contracts';
import { enableTimeline,applyDuoLayout,newTimelineClip } from '../../domain/src/timeline.js';
export const timelineFixtureAssets = { avatarA: '92000000-0000-4000-8000-000000000001',avatarB: '92000000-0000-4000-8000-000000000002',voiceA: '92000000-0000-4000-8000-000000000003',voiceB: '92000000-0000-4000-8000-000000000004',narration: '92000000-0000-4000-8000-000000000005' };
export function duoTimelineFixture(): StudioDocument {
  const doc = blankStudioDocument(),a = doc.speakers[0],ids = timelineFixtureAssets;a.name = '合成主持';a.avatarAssetId = ids.avatarA;a.voiceAssetId = ids.voiceA;
  const b = { ...a,id: crypto.randomUUID(),name: '合成嘉宾',avatarAssetId: ids.avatarB,voiceAssetId: ids.voiceB };doc.speakers.push(b);
  doc.segments = ['主持人发问','嘉宾回答','独立旁白'].map((title,i) => ({ ...structuredClone(doc.segments[0]),id: crypto.randomUUID(),title,text: ['您好，请介绍一下这个示例。','这是两个独立角色的本地合成示例。','接下来是独立旁白，两个角色保持倾听。'][i],speakerId: i === 2 ? null : i ? b.id : a.id,durationMs: 1000,elements: [{ id: crypto.randomUUID(),type: 'text',text: '双人制作 · 原创合成测试',x: 0.06,y: 0.035,width: 0.88,height: 0.1,fontSize: 60,color: doc.brand.primaryColor,bold: true,align: 'left',zIndex: 0,opacity: 1 }] }));
  enableTimeline(doc);doc.timeline!.tracks.find(t => t.type === 'voice')!.clips.push(newTimelineClip({ type: 'asset',assetId: ids.narration },{ name: '独立旁白 · 合成提示音',segmentId: doc.segments[2].id,startMs: 2000,durationMs: 1000,speakerId: null,voiceRole: 'narration',linked: true }));applyDuoLayout(doc,'side_by_side');return doc;
}
