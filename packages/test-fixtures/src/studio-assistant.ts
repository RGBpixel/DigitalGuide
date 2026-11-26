import {blankStudioDocument,type AssistantGenerationSettings} from '@digitalguide/contracts';
import {enableTimeline} from '../../domain/src/timeline.js';
import {fixtureIds as f} from './seed.js';
export function assistantDocumentFixture(durationMs=3000){const doc=blankStudioDocument(),example=doc.segments[0];doc.canvas={width:640,height:360,fps:24,transparent:false};doc.speakers[0].avatarAssetId=f.avatarA;doc.speakers[0].voiceAssetId=f.voiceA;doc.segments=['原有开场。','您好，欢迎参观。','保留的结束语。'].map((text,i)=>({...structuredClone(example),id:crypto.randomUUID(),title:['开场','讲解','结尾'][i],text,durationMs,backgroundColor:['#173f91','#167748','#932f3f'][i],speakerId:doc.speakers[0].id,elements:[]}));enableTimeline(doc);return doc;}
export function assistantSettingsFixture():AssistantGenerationSettings{return{speech:null,renderVideo:true,videoSettings:{preset:'hd',fps:24,transparent:false,omitBackground:false,burnSubtitles:true},trimLongAudio:false,replaceOriginalVideoAudio:true};}
