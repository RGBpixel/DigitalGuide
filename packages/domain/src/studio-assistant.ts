import {assistantProposal,type AssistantProposal,type AssistantVoiceIntent,type StudioDocument} from '@digitalguide/contracts';
import {AppError,canonical,segmentWindows} from './index.js';
import {contentInstruction,reviseContentText} from './content-writing.js';
import {enableTimeline,preserveVoiceOutsideRanges,sliceTimelineClip} from './timeline.js';
export interface AssistantInterpretationInput{provider:'local_commands'|'manual'|'mock_editor'|'external_editor'|'local_llm';instruction:string;replacements:{segmentId:string;text:string}[];selectedIds:string[];original:StudioDocument;parent:AssistantProposal|null;allowMock:boolean}
export function assistantRanges(doc:StudioDocument,selectedIds:string[]){
 if(new Set(selectedIds).size!==selectedIds.length||!selectedIds.length||selectedIds.length>8)throw new AppError('ASSISTANT_SELECTION','请选择一至八个不重复的分镜。',422);
 const windows=segmentWindows(doc),ranges=selectedIds.map(id=>{const window=windows.find(w=>w.id===id),segment=doc.segments.find(s=>s.id===id);if(!window||!segment)throw new AppError('ASSISTANT_SELECTION','所选分镜不属于当前工程版本。',409);return{segmentId:id,title:segment.title,startMs:window.startMs,durationMs:window.endMs-window.startMs};}).sort((a,b)=>a.startMs-b.startMs);
 if(ranges.reduce((n,w)=>n+w.durationMs,0)>300000)throw new AppError('ASSISTANT_DURATION_LIMIT','单次局部生成最多五分钟，请减少所选分镜。',422);
 return ranges;
}
export function validateAssistantProposal(original:StudioDocument,selectedIds:string[],value:unknown):AssistantProposal{
 const proposal=assistantProposal.parse(value);assistantRanges(original,selectedIds);
 if(proposal.patches.length!==selectedIds.length||new Set(proposal.patches.map(p=>p.segmentId)).size!==selectedIds.length||proposal.patches.some(p=>!selectedIds.includes(p.segmentId)||p.beforeText!==original.segments.find(s=>s.id===p.segmentId)?.text))throw new AppError('ASSISTANT_PATCH_SCOPE','候选方案扩大了选定范围、重复分镜或改写了原稿，不会执行。',409);
 if(proposal.patches.reduce((n,p)=>n+p.afterText.length,0)>16000)throw new AppError('ASSISTANT_TEXT_LIMIT','所选候选文字合计最多一万六千字符，请拆分对话。',422);
 return proposal;
}
function intentCommand(instruction:string,parent:AssistantVoiceIntent):AssistantVoiceIntent|null{
 const input=instruction.trim().replace(/^[请把将]+/u,'').replace(/[。！!]$/u,'');
 const rate=/^(?:所选(?:分镜|段落)(?:的)?)?(?:语速)?(?:再)?(慢一点|快一点|恢复正常语速|正常语速|放慢语速|加快语速)$/u.exec(input);
 if(rate){const values=['x-slow','slow','medium','fast','x-fast'] as const,current=values.indexOf(parent.rate||'medium'),next=/正常/.test(rate[1])?'medium':values[Math.max(0,Math.min(values.length-1,current+(/慢/.test(rate[1])?-1:1)))];return{...parent,rate:next};}
 const pause=/^(?:在)?(?:段尾|结尾)(?:停顿|暂停)\s*(\d{1,4})\s*(?:毫秒|ms)$/iu.exec(input);if(pause&&Number(pause[1])<=3000)return{...parent,trailingPauseMs:Number(pause[1])};
 return null;
}
export function interpretAssistant(input:AssistantInterpretationInput):AssistantProposal{
 const {original,selectedIds,provider,instruction}=input;assistantRanges(original,selectedIds);
 if(provider==='external_editor')throw new AppError('ASSISTANT_PROVIDER_UNCONFIGURED','真实语义编辑模型尚未接入，不会静默使用规则或模拟建议。',503);
 if(provider==='local_llm')throw new AppError('ASSISTANT_INTERPRETATION_JOB_REQUIRED','本机语义编辑需要通过持久任务执行，请使用本机语义生成入口。',422);
 if(provider==='mock_editor'&&!input.allowMock)throw new AppError('ASSISTANT_MOCK_DISABLED','当前环境不允许模拟内容模型。',409);
 const parent=input.parent?validateAssistantProposal(original,selectedIds,input.parent):null,voiceIntent={...(parent?.voiceIntent||{})},patches=selectedIds.map(id=>({segmentId:id,beforeText:original.segments.find(s=>s.id===id)!.text,afterText:parent?.patches.find(p=>p.segmentId===id)!.afterText??original.segments.find(s=>s.id===id)!.text}));let resultIntent=voiceIntent,message='已形成所选分镜的候选修改；原工程尚未变化。';const warnings=parent?[...parent.warnings]:[];
 if(provider==='manual'){
  if(!input.replacements.length||new Set(input.replacements.map(r=>r.segmentId)).size!==input.replacements.length||input.replacements.some(r=>!selectedIds.includes(r.segmentId)))throw new AppError('ASSISTANT_REPLACEMENT_SCOPE','人工校订只能包含当前选定的分镜，且编号不能重复。',422);
  for(const replacement of input.replacements)patches.find(p=>p.segmentId===replacement.segmentId)!.afterText=replacement.text;
 }else{
  if(input.replacements.length)throw new AppError('ASSISTANT_REPLACEMENTS_NOT_ALLOWED','聊天指令不接受附带隐藏替换项；请使用人工校订模式。',422);
  if(provider==='mock_editor'){
   for(const patch of patches)patch.afterText=reviseContentText(patch.afterText,'mock_rewrite',undefined,instruction);
   message='这是明确模拟的编辑建议，尚未核对语义、事实或真人表达。';warnings.push('候选文字包含模拟改写；实际系统配音或本地视频文件不代表真实语义模型或真人克隆。');
  }else{
   const intent=intentCommand(instruction,voiceIntent);
   if(intent){resultIntent=intent;message='已调整所选分镜的候选配音控制，需实际重新配音后才能写回。';}
   else{const operation=contentInstruction(instruction);if(operation.operation==='replace'&&selectedIds.length!==1)throw new AppError('ASSISTANT_SINGLE_REPLACEMENT','“替换为”请仅选择一个分镜，多段文字可在人工校订中分别填写。',422);for(const patch of patches)patch.afterText=reviseContentText(patch.afterText,operation.operation,operation.operation==='replace'?operation.text:undefined,instruction);if(operation.operation==='shorten')warnings.push('精简使用句子规则，可能遗漏信息；请对照原稿核对，不代表语义摘要。');}
  }
 }
 return validateAssistantProposal(original,selectedIds,{schemaVersion:1,patches,voiceIntent:resultIntent,message,warnings:[...new Set(warnings)].slice(0,20),simulated:provider==='mock_editor'||!!parent?.simulated});
}
export function assistantCandidate(original:StudioDocument,selectedIds:string[],proposal:AssistantProposal){
 validateAssistantProposal(original,selectedIds,proposal);const doc=structuredClone(original);for(const patch of proposal.patches)doc.segments.find(s=>s.id===patch.segmentId)!.text=patch.afterText;return doc;
}
export function prepareAssistantMedia(original:StudioDocument,selectedIds:string[],proposal:AssistantProposal,regenerateSpeech:boolean,videoAudioIds:string[]=[],replaceOriginalVideoAudio=true){
 const doc=assistantCandidate(original,selectedIds,proposal),changed=proposal.patches.filter(p=>p.beforeText!==p.afterText).map(p=>p.segmentId),affected=regenerateSpeech?selectedIds:changed;
 if(affected.length){enableTimeline(doc);const ranges=assistantRanges(doc,affected);preserveVoiceOutsideRanges(doc,ranges,affected);
  if(replaceOriginalVideoAudio)for(const track of doc.timeline!.tracks){if(track.muted)continue;const result:typeof track.clips=[];
   for(const clip of track.clips){const overlaps=clip.muted||!clip.volume||clip.source.type!=='asset'||!videoAudioIds.includes(clip.source.assetId)||clip.segmentId&&!affected.includes(clip.segmentId)?[]:ranges.filter(r=>clip.startMs<r.startMs+r.durationMs&&clip.startMs+clip.durationMs>r.startMs);
    if(!overlaps.length){result.push(clip);continue;}if(track.locked)throw new AppError('ASSISTANT_VIDEO_AUDIO_LOCKED','所选时段的原视频声音所在轨道已锁定，请先解锁或手工处理。',409);
    const original=structuredClone(clip),points=[...new Set([0,clip.durationMs,...overlaps.flatMap(r=>[Math.max(0,r.startMs-clip.startMs),Math.min(clip.durationMs,r.startMs+r.durationMs-clip.startMs)])])].sort((a,b)=>a-b);
    if(points.length===2){clip.volume=0;result.push(clip);continue;}
    clip.muted=true;result.push(clip);for(let i=0;i<points.length-1;i++){const from=points[i],to=points[i+1];if(to-from<100)throw new AppError('ASSISTANT_VIDEO_FRAGMENT','替换原视频声音后会留下不足0.1秒的片段，请先调整切点，不会静默丢弃。',409);const piece=sliceTimelineClip(original,from,to);piece.id=crypto.randomUUID();if(overlaps.some(r=>original.startMs+from<r.startMs+r.durationMs&&original.startMs+to>r.startMs))piece.volume=0;result.push(piece);}
   }track.clips=result;
  }
  for(const track of doc.timeline!.tracks){if(track.type!=='subtitle'||track.muted)continue;for(const clip of track.clips)if(clip.segmentId&&changed.includes(clip.segmentId)&&clip.source.type==='text'&&!clip.muted){if(track.locked)throw new AppError('ASSISTANT_SUBTITLE_LOCKED','所选分镜的旧手工字幕已锁定，请先解锁或校对。',409);clip.muted=true;}}
 }
 // Only selected text and explicitly affected audio/subtitles may change. Geometry and timings remain authored values.
 for(const segment of original.segments.filter(s=>!selectedIds.includes(s.id)))if(canonical(doc.segments.find(s=>s.id===segment.id))!==canonical(segment))throw new AppError('ASSISTANT_UNRELATED_CHANGE','未选分镜发生变化，已阻止应用。',409);
 return doc;
}
