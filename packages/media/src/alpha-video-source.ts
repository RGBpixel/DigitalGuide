import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {alphaVideoSpecsSchema} from '@digitalguide/contracts';
import {AppError} from '@digitalguide/domain';
import {mediaTools,runMediaTool} from './media-tools.js';
import {mp4InputOptions,type VideoInspection} from './video-source.js';
import {inspectMedia} from './index.js';
export async function inspectAlphaVideoSource(file:string,directory:string,root:string,signal:AbortSignal,onProgress:(value:number)=>void):Promise<VideoInspection>{
  const size=fs.statSync(file).size;if(size<32||size>1073741824)throw new AppError('ALPHA_VIDEO_LIMIT','透明视频必须是1 GB以内的ProRes 4444 MOV。',422);
  const tools=mediaTools(root),raw=await runMediaTool(tools.ffprobe,['-v','error','-max_alloc','67108864',...mp4InputOptions,'-show_entries','stream=codec_type,codec_name,codec_tag_string,pix_fmt,width,height,avg_frame_rate,duration,sample_rate,channels:stream_side_data=rotation:format=duration','-of','json',file],signal,20000);
  const p=JSON.parse(raw) as {streams:{codec_type:string;codec_name:string;codec_tag_string?:string;pix_fmt?:string;width?:number;height?:number;avg_frame_rate?:string;duration?:string;sample_rate?:string;channels?:number;side_data_list?:{rotation?:number}[]}[];format:{duration:string}},v=p.streams.find(s=>s.codec_type==='video'),a=p.streams.find(s=>s.codec_type==='audio'),[n,d]=(v?.avg_frame_rate||'').split('/').map(Number),bits=v?.pix_fmt?.match(/^yuva444p(10|12|16)le$/);
  if(p.streams.filter(s=>s.codec_type==='video').length!==1||p.streams.filter(s=>s.codec_type==='audio').length>1||p.streams.length!==(a?2:1)||v?.codec_name!=='prores'||!['ap4h','ap4x'].includes(v.codec_tag_string||'')||!bits||(a&&!['aac','pcm_s16le'].includes(a.codec_name))||v.side_data_list?.some(s=>s.rotation))throw new AppError('ALPHA_VIDEO_CODEC','仅支持直立的ProRes 4444/4444 XQ透明视频，至多一条AAC或PCM16原声。',422);
  const result=alphaVideoSpecsSchema.safeParse({width:v.width,height:v.height,codedWidth:v.width,codedHeight:v.height,durationMs:Math.round(+p.format.duration*1000),fps:n/d,rotation:0,hasAudio:a?1:0,sampleRate:a?Number(a.sample_rate):0,channels:a?.channels||0,alpha:1,bitDepth:Number(bits[1])});
  if(!result.success||p.streams.some(s=>s.duration&&(!Number.isFinite(+s.duration)||+s.duration>601)))throw new AppError('ALPHA_VIDEO_LIMIT','透明视频最多10分钟、60帧/秒、4096像素单边及双声道，请拆分或转换。',422);const specs=result.data;
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(tools.ffmpeg,['-v','error','-nostdin','-max_alloc','67108864','-threads','2','-xerror',...mp4InputOptions,'-i',file,'-map','0:v:0',...(a?['-map','0:a:0']:[]),'-stats_period','0.5','-progress','pipe:1','-f','null','-'],{windowsHide:true,stdio:['ignore','pipe','pipe'],signal});
    let tail='',bytes=0,frames=0,invalid=false,spawnError:Error|undefined;const timer=setTimeout(()=>{invalid=true;child.kill();},1800000);
    child.stdout.on('data',(b:Buffer)=>{tail+=b.toString('ascii');if(tail.length>16384){invalid=true;child.kill();return;}const lines=tail.split('\n');tail=lines.pop()||'';for(const line of lines){const[k,value]=line.trim().split('=');if(k==='frame'){frames=+value;if(!Number.isFinite(frames)||frames>36060){invalid=true;child.kill();}}if(k==='out_time_us'){const ms=+value/1000;if(Number.isFinite(ms)){if(ms>602000){invalid=true;child.kill();}onProgress(Math.min(.92,Math.max(0,ms/specs.durationMs)*.92));}}}});
    child.stderr.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>65536){invalid=true;child.kill();}});child.once('error',e=>{spawnError=e;});child.once('close',code=>{clearTimeout(timer);if(spawnError)reject(spawnError);else if(code!==0||invalid||frames<1)reject(new AppError('ALPHA_VIDEO_DECODE','透明视频未能完整解码，请检查原片。',422));else resolve();});
  });
  fs.mkdirSync(directory,{recursive:true});const posterFile=path.join(directory,'poster.png');await runMediaTool(tools.ffmpeg,['-v','error','-nostdin','-n','-threads','2',...mp4InputOptions,'-i',file,'-map','0:v:0','-an','-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease,format=rgba','-update','1',posterFile],signal,30000);inspectMedia(fs.readFileSync(posterFile));onProgress(1);
  return{specs,posterFile,warnings:['这是实际ProRes 4444透明素材；网页播放代理合成浅色背景，工程渲染和原文件保留透明通道。']};
}
export async function createAlphaBrowserPreview(file:string,destination:string,root:string,signal:AbortSignal){
  await runMediaTool(mediaTools(root).ffmpeg,['-v','error','-nostdin','-n','-threads','2',...mp4InputOptions,'-i',file,'-filter_complex_threads','1','-filter_complex','[0:v:0]scale=640:640:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2,split[fg][base];[base]drawbox=color=0xE8EEE8:t=fill:replace=1[bg];[bg][fg]overlay=shortest=1:format=auto,format=yuv420p[v]','-map','[v]','-map','0:a:0?','-r','30','-c:v','libx264','-threads','2','-preset','veryfast','-crf','24','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',destination],signal,1800000);
  if(fs.statSync(destination).size>134217728)throw new AppError('ALPHA_PREVIEW_LIMIT','透明素材播放代理超过128 MB，请缩短原片。',422);
}
