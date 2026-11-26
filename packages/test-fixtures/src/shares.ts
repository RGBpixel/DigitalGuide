import {blankStudioDocument,type ShareDefinition} from '@digitalguide/contracts';
import {enableTimeline,newTimelineClip,fullTransform} from '../../domain/src/timeline.js';
import {fixtureIds as f} from './seed.js';
// Original synthetic media and choices. No real person, site publication or device input.
export function shareVideoDocument(){
 const d=blankStudioDocument();d.canvas={width:640,height:360,fps:24,transparent:false};const n=d.segments[0];n.text='原创互动视频：介绍、重点、继续探索。';n.durationMs=6000;n.elements=[];n.speakerId=d.speakers[0].id;d.speakers[0].voiceAssetId=f.voiceA;enableTimeline(d);
 for(const t of d.timeline!.tracks)t.clips=[];
 const bg=d.timeline!.tracks.find(t=>t.type==='background')!;for(const [i,color]of ['#143c95','#13854c','#a73239'].entries())bg.clips.push(newTimelineClip({type:'color',color},{startMs:i*2000,durationMs:2000}));
 d.timeline!.tracks.find(t=>t.type==='voice')!.clips.push(newTimelineClip({type:'segment_narration'},{segmentId:n.id,speakerId:n.speakerId,durationMs:2000}));
 d.timeline!.tracks.find(t=>t.type==='subtitle')!.clips.push(newTimelineClip({type:'segment_subtitle'},{segmentId:n.id,durationMs:6000,transform:{...fullTransform(),x:.05,y:.86,width:.9,height:.1}}));return d;
}
export function shareDefinitionFixture():ShareDefinition{return{schemaVersion:1,chapters:[{id:'intro',title:'产品介绍',timeMs:0},{id:'focus',title:'重点内容',timeMs:2000},{id:'end',title:'继续探索',timeMs:4000}],linkOrigins:['https://example.com'],widgets:[
 {id:'focus-link',label:'跳到重点',startMs:0,endMs:2000,rect:{x:.04,y:.08,width:.26,height:.3},action:{kind:'seek',timeMs:2500}},
 {id:'interest',label:'选择内容',startMs:2000,endMs:4000,rect:{x:.06,y:.08,width:.6,height:.5},action:{kind:'choice',prompt:'你希望先看哪一部分？',options:[{id:'detail',label:'继续探索',action:{kind:'seek',timeMs:4500}},{id:'stay',label:'继续当前内容',action:{kind:'none'}}]}},
 {id:'website',label:'官方说明',startMs:4000,endMs:6000,rect:{x:.04,y:.08,width:.28,height:.3},action:{kind:'link',url:'https://example.com/guide?source=video#overview'}}
]};}
