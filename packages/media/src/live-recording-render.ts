import fs from 'node:fs';
import path from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {AppError} from '@digitalguide/domain';
import type {LiveSegment} from '../../domain/src/live.js';
import {mediaTools,probeLocalMedia,runMediaTool} from './media-tools.js';
export interface LiveRecordingRenderInput{root:string;directory:string;durationMs:number;segments:LiveSegment[];videos:{cueId:string;file:string}[]}
export interface LiveRecordingRenderResult{video:string;poster:string;durationMs:number;helperPid:number;helperEntry:string}
function card(file:string,label:string,text:string,color:string,full=true){const canvas=createCanvas(1280,full?720:64),p=canvas.getContext('2d');p.fillStyle=full?color:'#123c35ee';p.fillRect(0,0,canvas.width,canvas.height);p.fillStyle='#ffffff';p.font='600 25px "Microsoft YaHei", sans-serif';p.fillText(label.slice(0,70),24,42);if(full){p.font='30px "Microsoft YaHei", sans-serif';let line='',y=136,count=0;for(const char of text){if(char==='\n'||p.measureText(line+char).width>1180){p.fillText(line,42,y);line=char==='\n'?'':char;y+=46;if(++count>=11){p.fillText('……完整内容见本场问答记录',42,674);line='';break;}}else line+=char;}if(line)p.fillText(line,42,y);}fs.writeFileSync(file,canvas.toBuffer('image/png'),{flag:'wx'});}
export async function renderLiveRecording(input:LiveRecordingRenderInput,signal:AbortSignal):Promise<LiveRecordingRenderResult>{
 if(input.durationMs<1000||input.durationMs>1800000||input.segments.length>600)throw new AppError('LIVE_RECORDING_LIMIT','本地归档需为一秒至三十分钟，且最多六百段。',409);
 const tools=mediaTools(input.root),parts:string[]=[];let expectedStart=0;
 for(const [index,segment]of input.segments.entries()){
  if(segment.startMs!==expectedStart||segment.durationMs<=0)throw new AppError('LIVE_RECORDING_TIMELINE','播出片段不连续，不能重建归档。',409);expectedStart+=segment.durationMs;
  const frames=Math.round(expectedStart*24/1000)-Math.round(segment.startMs*24/1000);if(frames<=0)continue;signal.throwIfAborted();const duration=(frames/24).toFixed(6),part=path.join(input.directory,'part-'+index+'.mkv'),image=path.join(input.directory,'card-'+index+'.png'),args=['-v','error','-nostdin','-n'];
  if(segment.kind==='video'){
   const source=input.videos.find(v=>v.cueId===segment.cueId);if(!source)throw new AppError('LIVE_RECORDING_INPUT','缺少本段固定节目视频。',409);const probe=await probeLocalMedia(source.file,input.root,signal),silent=segment.muted||segment.frozen||!probe.streams.some(s=>s.codec_type==='audio');
   args.push('-protocol_whitelist','file,pipe','-ss',(segment.sourceInMs/1000).toFixed(6),...(segment.frozen?['-t','0.041667']:[]),'-i',source.file);card(image,'本地模拟直播 · 预制内容 · 来源分类未核验','',segment.backgroundColor,false);args.push('-loop','1','-i',image);if(silent)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
   args.push('-filter_complex',`[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1${segment.frozen?',tpad=stop_mode=clone:stop_duration='+duration:''}[base];[base][1:v]overlay=0:0[v]`,'-map','[v]','-map',silent?'2:a:0':'0:a:0');
  }else{
   card(image,segment.label,segment.text,segment.backgroundColor);args.push('-loop','1','-framerate','24','-i',image,'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-map','0:v:0','-map','1:a:0');
  }
  args.push('-t',duration,'-r','24','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-bf','0','-c:a','pcm_s16le','-ar','48000','-ac','2','-af','apad,atrim=duration='+duration,'-f','matroska',part);
  await runMediaTool(tools.ffmpeg,args,signal,Math.max(60000,Number(duration)*5000));parts.push(part);
 }
 if(expectedStart!==input.durationMs||!parts.length)throw new AppError('LIVE_RECORDING_TIMELINE','归档片段总时长不符。',409);
 const list=path.join(input.directory,'parts.ffconcat');fs.writeFileSync(list,'ffconcat version 1.0\n'+parts.map(f=>"file '"+path.basename(f)+"'").join('\n')+'\n',{flag:'wx'});const video=path.join(input.directory,'recording.mp4'),poster=path.join(input.directory,'poster.png'),duration=(Math.round(input.durationMs*24/1000)/24).toFixed(6);
 await runMediaTool(tools.ffmpeg,['-v','error','-nostdin','-n','-protocol_whitelist','file,pipe','-f','concat','-safe','1','-i',list,'-map','0:v:0','-map','0:a:0','-c:v','copy','-c:a','aac','-b:a','160k','-ar','48000','-af','apad,atrim=duration='+duration,'-t',duration,'-movflags','+faststart','-metadata','comment=DigitalGuide local simulated program timeline reconstruction; not remote stream capture',video],signal,120000);
 const probe=await probeLocalMedia(video,input.root,signal),stream=probe.streams.find(s=>s.codec_type==='video'),actualDuration=Math.round(Number(probe.format.duration)*1000);if(stream?.width!==1280||stream.height!==720||!probe.streams.some(s=>s.codec_type==='audio')||Math.abs(actualDuration-input.durationMs)>120)throw new AppError('LIVE_RECORDING_SPEC','实际归档尺寸、音轨或时长不符合固定时间轴。',409);
 await runMediaTool(tools.ffmpeg,['-v','error','-nostdin','-n','-ss','0.1','-i',video,'-frames:v','1','-update','1',poster],signal);return{video,poster,durationMs:actualDuration,helperPid:process.pid,helperEntry:process.argv[1]||''};
}
