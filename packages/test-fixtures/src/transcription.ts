import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {speechTextInput} from '@digitalguide/contracts';
import {systemSpeechVoices,synthesizeSystemSpeech} from '../../providers/src/system-speech.js';
import {mediaTools,runMediaTool} from '../../media/src/media-tools.js';
export const transcriptionFixtureText='您好，欢迎来到公司。今天介绍产品。请告诉我您的问题。';
export async function transcriptionVideoFixture(directory:string,root=process.cwd()){
  fs.mkdirSync(directory,{recursive:true});const voice=(await systemSpeechVoices(root)).find(v=>v.locale==='zh-CN');if(!voice)throw new Error('The actual Chinese TTS fixture requires an installed zh-CN voice.');
  const pauseAt=transcriptionFixtureText.indexOf('今天'),speech=speechTextInput.parse({text:transcriptionFixtureText,locale:'zh-CN',annotations:[{start:pauseAt,end:pauseAt+2,pauseBeforeMs:2200}],controls:{trailingPauseMs:600}}),rendered=await synthesizeSystemSpeech({root,dataDir:directory,workDir:path.join(directory,'speech'),voiceId:voice.id,speech}),file=path.join(directory,randomUUID()+'.mp4');
  await runMediaTool(mediaTools(root).ffmpeg,['-v','error','-nostdin','-n','-f','lavfi','-i','color=c=0x173B50:s=640x360:r=25,drawbox=x=40:y=40:w=560:h=280:color=0xDAE9DB:t=fill','-i',rendered.audioFile,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','128k','-t',(rendered.format.durationMs/1000).toFixed(3),'-movflags','+faststart',file],undefined,30000);return{file,audioFile:rendered.audioFile,text:transcriptionFixtureText,voice:rendered.voice,sourceDurationMs:rendered.format.durationMs};
}
export function characterErrorRate(expected:string,actual:string){const normalize=(s:string)=>[...s.replace(/[\s\p{P}\p{S}]/gu,'')],a=normalize(expected),b=normalize(actual);let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(row[j]+1,next[j-1]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length]/Math.max(1,a.length);}
