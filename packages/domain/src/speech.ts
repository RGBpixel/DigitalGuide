import { speechTextInput,type SpeechCompilation,type SpeechRun,type SpeechTextInput,type PronunciationEntry } from '@digitalguide/contracts';
import { AppError } from './index.js';
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function validatePronunciationEntries(entries:PronunciationEntry[]){
 const keys=new Set<string>();for(const e of entries){const key=e.locale+'\0'+e.term;if(keys.has(key))throw new AppError('PRONUNCIATION_DUPLICATE','同一语言的词条重复，请合并后保存。',409);keys.add(key);const locales=new Set<string>();for(const t of e.translations){if(t.locale===e.locale||locales.has(t.locale))throw new AppError('TERM_TRANSLATION_DUPLICATE','术语的目标语言重复或与源语言相同。',409);locales.add(t.locale);}}
}
export function compileSpeech(raw:SpeechTextInput):SpeechCompilation {
 const input=speechTextInput.parse(raw),chars=[...input.text],annotations=[...input.annotations].sort((a,b)=>a.start-b.start);validatePronunciationEntries(input.dictionary);
 let end=0;for(const a of annotations){if(a.start<end||a.end>chars.length)throw new AppError('VOICE_ANNOTATION_RANGE','语音标注重叠或超出原文范围，请按当前文字重新选择。',409);if(a.expectedText!==null&&chars.slice(a.start,a.end).join('')!==a.expectedText)throw new AppError('VOICE_ANNOTATION_TEXT_CHANGED','标注原词与当前文字不一致，请重新选择，旧标注不会用于新内容。',409);end=a.end;}
 const dictionary=input.dictionary.filter(e=>e.locale===input.locale).map(e=>({...e,chars:[...e.term]})).sort((a,b)=>b.chars.length-a.chars.length),runs:SpeechRun[]=[];let i=0,at=0;
 while(i<chars.length){
  const annotation=annotations[at],manual=annotation?.start===i?annotation:null,nextManual=annotation?.start??chars.length;
  const entry=!manual?dictionary.find(e=>i+e.chars.length<=nextManual&&e.chars.every((c,n)=>chars[i+n]===c)):null;
  const stop=manual?manual.end:entry?i+entry.chars.length:i+1,text=chars.slice(i,stop).join(''),alias=manual?.alias??entry?.alias??null,source=manual?'annotation':entry?'dictionary':'original';
  const run:SpeechRun={start:i,end:stop,text,spokenText:alias??text,alias,emphasis:manual?.emphasis??false,pauseBeforeMs:manual?.pauseBeforeMs??0,source};
  const previous=runs.at(-1);if(source==='original'&&previous?.source==='original'){previous.end=stop;previous.text+=text;previous.spokenText+=text;}else runs.push(run);i=stop;if(manual)at++;
 }
 const c=input.controls,pause=(ms:number,sapi=false)=>ms?(sapi?'<silence msec="'+ms+'"/>':'<break time="'+ms+'ms"/>'):'',ssmlBody=runs.map(r=>{let body=r.alias?'<sub alias="'+escape(r.alias)+'">'+escape(r.text)+'</sub>':escape(r.text);if(r.emphasis)body='<emphasis level="strong">'+body+'</emphasis>';return pause(r.pauseBeforeMs)+body;}).join('')+pause(c.trailingPauseMs);
 const rate={'x-slow':-6,slow:-3,medium:0,fast:3,'x-fast':6}[c.rate],pitch={'x-low':-4,low:-2,medium:0,high:2,'x-high':4}[c.pitch],volume={silent:0,'x-soft':20,soft:40,medium:70,loud:85,'x-loud':100}[c.volume],nativeBody=runs.map(r=>pause(r.pauseBeforeMs,true)+(r.emphasis?'<emph>'+escape(r.spokenText)+'</emph>':escape(r.spokenText))).join('')+pause(c.trailingPauseMs,true);
 const wrap=(text:string)=>'<rate absspeed="'+rate+'"><pitch absmiddle="'+pitch+'"><volume level="'+volume+'">'+text+'</volume></pitch></rate>',chunks:{body:string;pauseBeforeMs:number}[]=[];
 for(const r of runs){if(!chunks.length||r.pauseBeforeMs)chunks.push({body:'',pauseBeforeMs:r.pauseBeforeMs});chunks.at(-1)!.body+=r.emphasis?'<emph>'+escape(r.spokenText)+'</emph>':escape(r.spokenText);}
 return {locale:input.locale,text:input.text,runs,ssml:'<speak version="1.1" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="'+input.locale+'"><prosody rate="'+c.rate+'" pitch="'+c.pitch+'" volume="'+c.volume+'">'+ssmlBody+'</prosody></speak>',sapiXml:wrap(nativeBody),nativeChunks:chunks.map(chunk=>({sapiXml:wrap(chunk.body),pauseBeforeMs:chunk.pauseBeforeMs})),controls:c,engineMapping:'sapi-discrete-v1',clonedVoice:false,referenceStyleTransferred:false};
}
