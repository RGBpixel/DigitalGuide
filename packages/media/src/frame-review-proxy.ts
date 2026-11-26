import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {AppError} from '@digitalguide/domain';
import type {FrameReviewMedia} from '@digitalguide/contracts';
import {mediaTools,probeLocalMedia,runMediaTool} from './media-tools.js';
import {mp4InputOptions} from './video-source.js';
import {fileDigest} from './files.js';
export interface ReviewProxyInput{root:string;source:string;destination:string;width:number;height:number;fps:24|25|30|60;frames:number;timelineStartMs:number;alpha:boolean;signal:AbortSignal;onProgress:(n:number)=>void}
function encode(input:ReviewProxyInput,args:string[]){
  if(input.signal.aborted)return Promise.reject(new AppError('REVIEW_CANCELLED','审阅副本已停止。',409));
  return new Promise<void>((resolve,reject)=>{const child=spawn(mediaTools(input.root).ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let failed=false,aborted=false,tail='';
    const stop=()=>{aborted=true;child.kill();},timer=setTimeout(()=>{failed=true;child.kill();},1800000);input.signal.addEventListener('abort',stop,{once:true});
    child.stdout.on('data',(b:Buffer)=>{tail+=b.toString('ascii');if(tail.length>32768){failed=true;child.kill();return;}const lines=tail.split('\n');tail=lines.pop()||'';for(const line of lines){const m=/^frame=(\d+)\s*$/.exec(line);if(m)input.onProgress(Math.min(.98,+m[1]/input.frames));}});child.stderr.on('data',()=>{/* Paths and source content do not enter application logs. */});child.once('error',()=>{failed=true;});child.once('close',code=>{clearTimeout(timer);input.signal.removeEventListener('abort',stop);if(code!==0||failed||aborted)reject(new AppError(aborted?'REVIEW_CANCELLED':'REVIEW_PROXY_FAILED',aborted?'审阅副本已停止。':'审阅副本处理失败或超时，请核对成片或拆分后重试。',409));else resolve();});if(input.signal.aborted)stop();
  });
}
async function countFrames(file:string,root:string,signal:AbortSignal){const raw=await runMediaTool(mediaTools(root).ffprobe,['-v','error',...mp4InputOptions,'-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames','-of','json',file],signal,1800000),data=JSON.parse(raw) as {streams:{nb_read_frames:string}[]};const n=Number(data.streams[0]?.nb_read_frames);if(!Number.isSafeInteger(n)||n<1)throw new AppError('REVIEW_FRAME_COUNT','成片没有可验证的完整视频帧。',409);return n;}
export async function createFrameReviewProxy(input:ReviewProxyInput):Promise<FrameReviewMedia>{
  const sourceProbe=await probeLocalMedia(input.source,input.root,input.signal),video=sourceProbe.streams.find(s=>s.codec_type==='video'),audio=sourceProbe.streams.find(s=>s.codec_type==='audio'),[n,d]=(video?.avg_frame_rate||'').split('/').map(Number);
  if(!video||video.width!==input.width||video.height!==input.height||n/d!==input.fps||!['h264','prores'].includes(video.codec_name)||Math.abs(Number(video.duration||sourceProbe.format.duration)-input.frames/input.fps)>1/input.fps+.002)throw new AppError('REVIEW_SOURCE_SPECS','原成片的帧率、规格或时长与固定输出计划不符。',409);
  if(await countFrames(input.source,input.root,input.signal)!==input.frames)throw new AppError('REVIEW_SOURCE_FRAMES','原成片完整帧数不符，没有生成错位审阅副本。',409);
  const scale=Math.min(1,1920/Math.max(input.width,input.height)),width=Math.max(2,Math.floor(input.width*scale/2)*2),height=Math.max(2,Math.floor(input.height*scale/2)*2),graph=`color=c=0xEEF2F0:s=${width}x${height}:r=${input.fps},format=rgba[base];[0:v:0]setpts=PTS-STARTPTS,scale=${width}:${height}:flags=lanczos,setsar=1,format=rgba[fg];[base][fg]overlay=shortest=1:format=auto,format=yuv420p[v]`;
  await encode(input,['-v','error','-nostdin','-n','-threads','2','-xerror',...mp4InputOptions,'-i',input.source,'-filter_complex',graph,'-map','[v]','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','21','-threads','2','-r',String(input.fps),'-frames:v',String(input.frames),'-c:a','aac','-ac','2','-ar','48000','-b:a','128k','-map_metadata','-1','-movflags','+faststart','-fs','536870913','-progress','pipe:1','-nostats',input.destination]);
  const digest=await fileDigest(input.destination,input.signal);if(digest.size>536870912)throw new AppError('REVIEW_PROXY_LIMIT','审阅副本超过512MB，请拆分成片后重新生成。',409);const p=await probeLocalMedia(input.destination,input.root,input.signal),v=p.streams.find(s=>s.codec_type==='video'),a=p.streams.find(s=>s.codec_type==='audio'),[outN,outD]=(v?.avg_frame_rate||'').split('/').map(Number);
  if(v?.codec_name!=='h264'||v.width!==width||v.height!==height||outN/outD!==input.fps||!!a!==!!audio||a&&a.codec_name!=='aac'||await countFrames(input.destination,input.root,input.signal)!==input.frames)throw new AppError('REVIEW_PROXY_INVALID','审阅副本的完整帧数或声音与原成片不一致，未提供播放。',409);
  if(!fs.existsSync(input.destination))throw new AppError('REVIEW_PROXY_MISSING','审阅副本未能保存。',409);
  return{width,height,fps:input.fps,frames:input.frames,durationMs:Math.round(input.frames/input.fps*1000),timelineStartMs:input.timelineStartMs,hasAudio:!!audio,...digest,flattenedAlpha:input.alpha,originalWidth:input.width,originalHeight:input.height};
}
