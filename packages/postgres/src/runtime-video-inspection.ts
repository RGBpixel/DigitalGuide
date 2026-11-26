import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError,canonical} from '../../domain/src/index.js';
import {alphaVideoSpecsSchema,videoSpecsSchema} from '../../contracts/src/index.js';
import {inspectMedia} from '../../media/src/index.js';
import {runVideoInspection} from '../../media/src/run-video-inspection.js';
import {createAlphaBrowserPreview} from '../../media/src/alpha-video-source.js';
import {mp4InputOptions} from '../../media/src/video-source.js';
import {mediaTools,runMediaTool,probeLocalMedia} from '../../media/src/media-tools.js';
import {assertNoLinks} from '../../recovery/src/files.js';
import {NativePrivateObjects,type NativeObject} from './runtime-objects.js';

export interface NativeCheckedVideo {mediaType:'video/mp4'|'video/quicktime';specs:Record<string,number>;poster:NativeObject;preview:NativeObject|null;warnings:string[]}
export async function prepareNativeVideo(objects:NativePrivateObjects,file:string,directory:string,root:string,alpha:boolean,signal:AbortSignal,progress:(n:number)=>void,inspector=runVideoInspection):Promise<NativeCheckedVideo>{
 assertNoLinks(file);assertNoLinks(directory,true);await fs.promises.mkdir(directory,{recursive:true,mode:0o700});assertNoLinks(directory);
 const inspected=await inspector({file,directory,root,alphaVideo:alpha},signal,n=>progress(n*.75));
 const raw=JSON.parse(await runMediaTool(mediaTools(root).ffprobe,['-v','error','-max_alloc','67108864',...mp4InputOptions,'-show_entries','stream=codec_type,codec_name,codec_tag_string,pix_fmt,width,height,avg_frame_rate,r_frame_rate,duration,sample_rate,channels:stream_side_data=rotation:format=duration','-of','json',file],signal,20000)) as {streams:{codec_type:string;codec_name:string;codec_tag_string?:string;pix_fmt?:string;width?:number;height?:number;avg_frame_rate?:string;r_frame_rate?:string;duration?:string;sample_rate?:string;channels?:number;side_data_list?:{rotation?:number}[]}[];format:{duration:string}};
 const videos=raw.streams.filter(s=>s.codec_type==='video'),audios=raw.streams.filter(s=>s.codec_type==='audio'),v=videos[0],a=audios[0],rate=(s?:string)=>{const[n,d]=(s??'').split('/').map(Number);return n/d;},rotation=v?.side_data_list?.find(s=>s.rotation!==undefined)?.rotation??0;
 if(videos.length!==1||audios.length>1||raw.streams.length!==1+audios.length||!v||raw.streams.some(s=>s.duration&&(!Number.isFinite(+s.duration)||+s.duration>601)))throw new AppError('VIDEO_INSPECTION_INVALID','父进程探测的视频流、音轨或时长不符合要求。',422);
 const specs=(alpha?alphaVideoSpecsSchema:videoSpecsSchema).parse({width:Math.abs(rotation)%180===90?v.height:v.width,height:Math.abs(rotation)%180===90?v.width:v.height,codedWidth:v.width,codedHeight:v.height,durationMs:Math.round(Number(raw.format.duration)*1000),fps:rate(v.avg_frame_rate)||rate(v.r_frame_rate),rotation,hasAudio:a?1:0,sampleRate:a?Number(a.sample_rate):0,channels:a?.channels??0,...(alpha?{alpha:1,bitDepth:Number(v.pix_fmt?.match(/^yuva444p(10|12|16)le$/)?.[1])}:{})});
 if(canonical(specs)!==canonical(inspected.specs)||![-270,-180,-90,0,90,180,270,360,-360].includes(rotation)||(alpha?(v.codec_name!=='prores'||!['ap4h','ap4x'].includes(v.codec_tag_string??'')||rotation!==0||(a&&!['pcm_s16le','aac'].includes(a.codec_name))):(v.codec_name!=='h264'||!['yuv420p','yuvj420p'].includes(v.pix_fmt??'')||(a&&a.codec_name!=='aac'))))throw new AppError('VIDEO_INSPECTION_INVALID','实际原件的编码、方向、Alpha或规格与检查回执不一致。',422);
 const posterPath=path.join(directory,'poster.png');if(path.resolve(inspected.posterFile)!==path.resolve(posterPath))throw new AppError('VIDEO_INSPECTION_INVALID','视频封面位置不属于本次检查目录。',422);assertNoLinks(posterPath);if(fs.statSync(posterPath).size>8388608)throw new AppError('VIDEO_INSPECTION_INVALID','视频封面超过允许大小。',422);const image=inspectMedia(fs.readFileSync(posterPath));if(image.mediaType!=='image/png'||image.specs.width>640||image.specs.height>640)throw new AppError('VIDEO_INSPECTION_INVALID','视频封面不是受支持的实际PNG。',422);const poster=await objects.install(posterPath,8388608,signal);
 let preview:NativeObject|null=null;if(alpha){const previewPath=path.join(directory,randomUUID()+'.mp4');await createAlphaBrowserPreview(file,previewPath,root,signal);const probe=await probeLocalMedia(previewPath,root,signal),video=probe.streams.find(s=>s.codec_type==='video'),duration=Number(probe.format.duration)*1000;if(video?.codec_name!=='h264'||!video.width||!video.height||video.width>640||video.height>640||!Number.isFinite(duration)||Math.abs(duration-specs.durationMs)>160)throw new AppError('VIDEO_INSPECTION_INVALID','网页播放代理规格不符合要求。',422);preview=await objects.install(previewPath,134217728,signal);}
 progress(1);return{mediaType:alpha?'video/quicktime':'video/mp4',specs,poster,preview,warnings:z.array(z.string().max(500)).max(20).parse(inspected.warnings)};
}
