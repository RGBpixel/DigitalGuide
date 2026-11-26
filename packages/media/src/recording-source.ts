import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {AppError} from '@digitalguide/domain';
import {mediaTools,runMediaTool} from './media-tools.js';
import {inspectVideoSource,mp4InputOptions,type VideoInspection} from './video-source.js';
async function recordingTiming(binary:string,inputOptions:string[],file:string,signal:AbortSignal,audioRate:number){
  return new Promise<{frames:number;fps:number;spanMs:number;durationMs:number;audioFrames:number}>((resolve,reject)=>{
    const child=spawn(binary,['-v','error','-max_alloc','67108864','-threads','2',...inputOptions,'-show_frames','-show_entries','frame=media_type,best_effort_timestamp_time,duration_time,nb_samples:frame_side_data=','-of','compact=p=0:nk=0',file],{windowsHide:true,stdio:['ignore','pipe','pipe'],signal});
    let tail='',frames=0,audioFrames=0,first=0,last=0,end=0,videoDuration=0,bytes=0,errors=0,invalid=false,failure:Error|undefined;const timer=setTimeout(()=>{invalid=true;child.kill();},1800000);
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;tail+=chunk.toString('ascii');if(bytes>67108864||tail.length>65536){invalid=true;child.kill();return;}const lines=tail.split('\n');tail=lines.pop()||'';for(const line of lines){if(!line.trim())continue;const f=Object.fromEntries(line.trim().split('|').map(part=>part.split('='))),pts=Number(f.best_effort_timestamp_time),duration=Number(f.duration_time)||0;if(!Number.isFinite(pts)||pts<-.25||pts>600.5||!Number.isFinite(duration)||duration<0||duration>1){invalid=true;child.kill();return;}if(f.media_type==='video'){if(pts<0||(frames&&pts<last-.002)){invalid=true;child.kill();return;}if(!frames)first=pts;last=pts;frames++;videoDuration=duration;if(frames>36060){invalid=true;child.kill();return;}}else if(f.media_type==='audio'){audioFrames++;if(audioFrames>600600){invalid=true;child.kill();return;}}else{invalid=true;child.kill();return;}const samples=Number(f.nb_samples)||0;end=Math.max(end,pts+(f.media_type==='audio'&&audioRate?samples/audioRate:duration));}});
    child.stderr.on('data',(chunk:Buffer)=>{errors+=chunk.length;if(errors>65536){invalid=true;child.kill();}});child.once('error',e=>{failure=e;});
    child.once('close',code=>{clearTimeout(timer);const span=last-first,rate=frames>1&&span>0?(frames-1)/span:0,durationMs=Math.ceil(Math.max(end,last+(videoDuration||rate&&1/rate||0))*1000);if(code!==0||failure||invalid||frames<1||(frames>1&&span<=0)||!Number.isFinite(rate)||rate>60.5||durationMs>600000)reject(new AppError('RECORDING_TIMING_LIMIT','录制实际帧时间不完整、超过约60帧/秒或10分钟；未按不可靠的容器帧率字段放行。',422));else resolve({frames,fps:rate,spanMs:Math.round(span*1000),durationMs,audioFrames});});
  });
}
// MediaRecorder WebM may have no duration/index. Decode to EOF with runtime limits, then inspect MP4.
export async function inspectRecordingSource(file:string,directory:string,root:string,signal:AbortSignal,onProgress:(fraction:number)=>void,durationHintMs:number|null=null):Promise<VideoInspection>{
  const stat=fs.statSync(file),head=Buffer.alloc(12),fd=fs.openSync(file,'r');try{fs.readSync(fd,head,0,12,0);}finally{fs.closeSync(fd);}
  const webm=head.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])),mp4=head.toString('ascii',4,8)==='ftyp';
  if(stat.size<32||stat.size>134217728||(!webm&&!mp4))throw new AppError('INVALID_RECORDING','录制文件需为128 MB内的WebM或MP4，不接受仅更改后缀的文件。',422);
  const inputOptions=webm?['-protocol_whitelist','file,pipe','-f','matroska']:mp4InputOptions,tools=mediaTools(root);
  const raw=await runMediaTool(tools.ffprobe,['-v','error','-max_alloc','67108864',...inputOptions,'-show_entries','stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate,avg_frame_rate,sample_rate,channels:stream_side_data=rotation:format=duration','-of','json',file],signal,20000);
  type Stream={codec_type:string;codec_name:string;pix_fmt?:string;width?:number;height?:number;avg_frame_rate?:string;r_frame_rate?:string;sample_rate?:string;channels?:number;side_data_list?:{rotation?:number}[]};
  const probe=JSON.parse(raw) as {streams:Stream[];format:{duration?:string}},videos=probe.streams.filter(s=>s.codec_type==='video'),audios=probe.streams.filter(s=>s.codec_type==='audio'),video=videos[0],audio=audios[0];
  const fraction=(value?:string)=>{const [a,b]=(value||'0/1').split('/').map(Number);return b?a/b:0;},headerFps=fraction(video?.avg_frame_rate)||fraction(video?.r_frame_rate),duration=Number(probe.format.duration)||0;
  if(videos.length!==1||audios.length>1||probe.streams.length!==videos.length+audios.length||!(webm?['vp8','vp9']:['h264']).includes(video?.codec_name)||!['yuv420p','yuvj420p','yuv444p','gbrp'].includes(video?.pix_fmt||'')||(audio&&(!(webm?['opus','vorbis']:['aac']).includes(audio.codec_name)||![1,2].includes(audio.channels||0)||Number(audio.sample_rate)<8000||Number(audio.sample_rate)>96000)))throw new AppError('RECORDING_CODEC_UNSUPPORTED','录制需为VP8/VP9加Opus/Vorbis的WebM，或H.264加AAC的MP4，最多一条画面和一条单/双声道声音。',422);
  const rotation=video.side_data_list?.find(s=>s.rotation!==undefined)?.rotation||0;
  if(!video.width||!video.height||video.width<16||video.height<16||video.width>4096||video.height>4096||video.width*video.height>16777216||!Number.isFinite(headerFps)||headerFps<0||!Number.isFinite(duration)||duration<0||duration>600||![0,90,180,270].includes((rotation%360+360)%360))throw new AppError('RECORDING_LIMIT','录制最多10分钟、约60帧/秒、4096像素单边及正交旋转；未知时长将在实际转换时检查。',422);
  const timing=await recordingTiming(tools.ffprobe,inputOptions,file,signal,audio?Number(audio.sample_rate):0);
  const useHint=!audio&&!duration&&durationHintMs!==null&&durationHintMs>timing.durationMs;
  if(durationHintMs!==null&&(!Number.isInteger(durationHintMs)||durationHintMs<100||durationHintMs>600000))throw new AppError('RECORDING_DURATION_HINT','本机录制计时无效，请重新核对原片。',422);
  const targetMs=Math.max(timing.durationMs,duration*1000,useHint?durationHintMs!:0);
  if(targetMs<100||targetMs>600000)throw new AppError('RECORDING_DURATION_MISSING','原片未记录足够的有效时间。无声静态录制需本机录制计时，请从录制恢复入口上传，或转换为包含明确时长的MP4。',422);
  const normalizedFile=path.join(directory,'recording.mp4');
  await new Promise<void>((resolve,reject)=>{
    const args=['-v','error','-nostdin','-n','-max_alloc','67108864','-threads','2','-filter_threads','1','-xerror',...inputOptions,'-i',file,'-map','0:v:0',...(audio?['-map','0:a:0']:['-an']),'-map_metadata','-1','-map_chapters','-1','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=30,tpad=stop_mode=clone:stop_duration=600','-t',String(Math.ceil(targetMs*30/1000)/30),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-r','30','-threads','2',...(audio?['-c:a','aac','-b:a','160k','-ar','48000','-ac','2']:[]),'-movflags','+faststart','-stats_period','0.5','-progress','pipe:1',normalizedFile];
    const child=spawn(tools.ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],signal});let tail='',frames=0,errorBytes=0,invalid=false,spawnError:Error|undefined;
    const timer=setTimeout(()=>{invalid=true;child.kill();},1800000);
    child.stdout.on('data',(chunk:Buffer)=>{tail+=chunk.toString('ascii');if(tail.length>16384){invalid=true;child.kill();return;}const lines=tail.split('\n');tail=lines.pop()||'';for(const line of lines){const [key,value]=line.trim().split('=');if(key==='frame'){frames=+value;if(!Number.isFinite(frames)||frames>18060){invalid=true;child.kill();}}if(key==='out_time_us'){const ms=+value/1000;if(!Number.isFinite(ms)||ms>600500){invalid=true;child.kill();}else onProgress(Math.min(.7,Math.max(0,ms/(duration?duration*1000:600000))*.7));}}if(fs.existsSync(normalizedFile)&&fs.statSync(normalizedFile).size>134217728){invalid=true;child.kill();}});
    child.stderr.on('data',(chunk:Buffer)=>{errorBytes+=chunk.length;if(errorBytes>65536){invalid=true;child.kill();}});
    child.once('error',e=>{spawnError=e;});child.once('close',code=>{clearTimeout(timer);if(code!==0||spawnError||invalid||frames<1)reject(new AppError('RECORDING_CONVERSION_FAILED','录制未能完整转换、已取消或超过10分钟/128 MB限制；未保存截短结果。',422));else resolve();});
  });
  if(fs.statSync(normalizedFile).size>134217728)throw new AppError('RECORDING_OUTPUT_TOO_LARGE','转换后超过128 MB，请降低录制分辨率或缩短录制。',422);
  const inspected=await inspectVideoSource(normalizedFile,directory,root,signal,p=>onProgress(.7+p*.3));
  if(duration&&Math.abs(inspected.specs.durationMs-duration*1000)>350)throw new AppError('RECORDING_DURATION_MISMATCH','原片与转换结果的时长不一致，请检查文件完整性。',422);
  return {...inspected,normalizedFile,sourceContainer:webm?'webm':'mp4',sourceSpecs:{width:video.width,height:video.height,fps:timing.fps,headerFps,decodedFrames:timing.frames,videoSpanMs:timing.spanMs,decodedDurationMs:timing.durationMs,durationHintMs:durationHintMs||0,usedDurationHint:useHint?1:0,durationMs:Math.round(duration*1000),hasAudio:audio?1:0,sampleRate:audio?Number(audio.sample_rate):0,channels:audio?.channels||0},warnings:['实际完整转换并检查为30fps H.264/AAC MP4，保留上传原片和两份SHA供核对。',...(!duration?['浏览器原片未声明总时长；已测量实际音视频帧时间，结果时长另行检查。']:[]),...(useHint?['无声原片缺少总时长，末帧按本次浏览器本机计时保持；这是计时提示，不是媒体识别或权限凭据。']:[]),...(headerFps>60.5?['容器帧率字段不是实际录制帧率；已解码并按帧时间测量校验。']:[]),...(audio?[]:['原片没有声音；系统不会自动补造配音。'])]};
}
