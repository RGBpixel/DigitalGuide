import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {speechTextInput} from '@digitalguide/contracts';
import {systemSpeechVoices,synthesizeSystemSpeech} from '../../providers/src/system-speech.js';
import {mediaTools,runMediaTool} from '../../media/src/media-tools.js';
export const semanticFixtureTexts=['锅里放油，加入花椒和辣椒，再把豆腐煮熟，最后撒上葱花。','客人来到公司大堂，接待员先问好，询问预约和来访目的，然后联系受访同事下楼迎接。','木星是一颗气态巨行星，拥有多颗卫星，大气中有持续很久的巨大风暴。'];
export async function semanticVideoFixture(directory:string,root=process.cwd()){
 fs.mkdirSync(directory,{recursive:true});const voice=(await systemSpeechVoices(root)).find(v=>v.locale==='zh-CN');if(!voice)throw new Error('需要本机已安装的中文系统配音。');const audios:string[]=[],segments:{id:string;startMs:number;endMs:number;text:string}[]=[];let position=0;
 for(const [i,text] of semanticFixtureTexts.entries()){const speech=speechTextInput.parse({text,locale:'zh-CN',controls:{trailingPauseMs:600}}),rendered=await synthesizeSystemSpeech({root,dataDir:directory,workDir:path.join(directory,'speech-'+i),voiceId:voice.id,speech});audios.push(rendered.audioFile);segments.push({id:randomUUID(),startMs:Math.round(position),endMs:Math.round(position+rendered.format.durationMs),text});position+=rendered.format.durationMs;}
 const audio=path.join(directory,'whole.wav'),file=path.join(directory,'source.mp4'),tools=mediaTools(root);await runMediaTool(tools.ffmpeg,['-v','error','-nostdin','-n',...audios.flatMap(file=>['-i',file]),'-filter_complex','[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]','-map','[out]','-c:a','pcm_s16le',audio],undefined,30000);await runMediaTool(tools.ffmpeg,['-v','error','-nostdin','-n','-f','lavfi','-i','color=c=0x173B50:s=640x360:r=12,drawbox=x=40:y=40:w=560:h=280:color=0xDAE9DB:t=fill','-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','128k','-t',(position/1000).toFixed(3),'-movflags','+faststart',file],undefined,30000);return{file,audioFile:audio,segments,sourceDurationMs:Math.round(position),text:semanticFixtureTexts.join('\n'),synthetic:true,notice:'原创文字与系统配音、色块。已知逐段配音边界用于自动校正测试，不是人工听审或识别准确率证明。'};
}
