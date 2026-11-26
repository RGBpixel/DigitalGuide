import fs from 'node:fs';
import path from 'node:path';
import type {MediaProcessingPayload,MediaProcessingReport} from '@digitalguide/contracts';
import {isVideoMediaType,mediaFileExtension,storedPngMaximumBytes} from '@digitalguide/contracts';
import {AppError} from '@digitalguide/domain';
import {mediaProcessingPlan} from '../../domain/src/media-processing.js';
import {mediaTools,runMediaTool} from './media-tools.js';
import {mp4InputOptions,inspectVideoSource} from './video-source.js';
import {inspectAlphaVideoSource,createAlphaBrowserPreview} from './alpha-video-source.js';
import {inspectMedia,inspectStoredPng} from './index.js';
import {fileDigest} from './files.js';
import {runNeuralSegmentation} from './neural-segmentation.js';
import {runNeuralTracking} from './neural-tracking.js';
import {runNeuralSemantic} from './neural-semantic.js';
import {runNeuralRestoration} from './neural-restoration.js';
import {runGazeCorrection} from './gaze-processing.js';
import {runNeuralDenoising} from './neural-denoising.js';
export interface ProcessedMediaFile {name:string;mediaType:string;file:string;size:number;sha256:string;specs:Record<string,number>;sourceStartMs:number;sourceDurationMs:number|null;alpha:boolean;posterFile?:string;previewFile?:string}
export interface MediaProcessingResult {files:ProcessedMediaFile[];report:MediaProcessingReport}
export interface MediaProcessingInput {payload:MediaProcessingPayload;file:string;directory:string;root:string}
export async function processLocalMedia(input:MediaProcessingInput,signal:AbortSignal,onProgress:(fraction:number)=>void):Promise<MediaProcessingResult>{
  const {payload,file,directory,root}=input,c=payload.configuration,s=payload.source,plan=mediaProcessingPlan(payload),video=isVideoMediaType(s.mediaType),image=s.mediaType==='image/png';
  if(c.provider!=='local-media')throw new AppError('MEDIA_PROVIDER_INVALID','原生处理仅接受本地媒体方案。',409);
  const original=await fileDigest(file,signal);if(original.size!==s.size||original.sha256!==s.sha256)throw new AppError('MEDIA_SOURCE_BYTES_CHANGED','原素材字节已变化，请重新核对来源。',409);
  fs.mkdirSync(directory,{recursive:true});const tools=mediaTools(root),sourceOptions=video?mp4InputOptions:['-protocol_whitelist','file,pipe','-f',image?'png_pipe':'wav'],files:ProcessedMediaFile[]=[],metrics:Record<string,number>={sourceBytes:s.size};
  if(c.operation==='semantic_split'){const result=await runNeuralSemantic({root,payload},signal,onProgress),after=await fileDigest(file,signal);if(after.sha256!==s.sha256||after.size!==s.size)throw new AppError('MEDIA_SOURCE_BYTES_CHANGED','分析期间原视频字节已变化，未登记候选。',409);return{files:[],report:{provider:'local-media',simulated:false,realAlgorithm:true,summary:'已用本机多语言语义模型检索带时间校对稿；请回看候选、明确选择后建立实际分段方案。',metrics:{...metrics,...result.metrics},recommendations:result.semantic.candidates.map(({name,startMs,durationMs})=>({name,startMs,durationMs})),semantic:result.semantic,warnings:plan.warnings}};}
  if(c.operation==='scene_suggest'){
    const raw=await runMediaTool(tools.ffmpeg,['-v','error','-nostdin','-threads','2',...sourceOptions,'-i',file,'-map','0:v:0','-an','-vf',`select='gt(scene,${c.threshold})',metadata=print:file=-`,'-fps_mode','vfr','-f','null','-'],signal,1800000);
    const duration=s.specs.durationMs,cuts=[...new Set([...raw.matchAll(/pts_time:([0-9.e+-]+)/g)].map(m=>Math.round(Number(m[1])*1000)))].filter(t=>Number.isFinite(t)&&t>0&&t<duration).sort((a,b)=>a-b),points=[0];
    for(const cut of cuts)if(cut-points.at(-1)!>=c.minClipMs&&duration-cut>=c.minClipMs)points.push(cut);points.push(duration);
    const recommendations:MediaProcessingReport['recommendations']=[];for(let i=0;i<points.length-1;i++){const length=points[i+1]-points[i],count=Math.ceil(length/c.maxClipMs);for(let n=0;n<count;n++){const start=points[i]+Math.round(n*length/count),end=points[i]+Math.round((n+1)*length/count);recommendations.push({name:'镜头候选 '+(recommendations.length+1),startMs:start,durationMs:end-start});}}
    if(recommendations.length>1200)throw new AppError('MEDIA_SCENE_LIMIT','镜头候选超过1200段，请提高阈值或缩短原片。',409);onProgress(1);return{files:[],report:{provider:'local-media',simulated:false,realAlgorithm:true,summary:'已分析实际画面的镜头变化；请人工选择候选后建立分段方案。',metrics:{...metrics,detectedChanges:cuts.length,recommendationCount:recommendations.length},recommendations,warnings:plan.warnings}};
  }
  let tracking:MediaProcessingReport['tracking'],gaze:MediaProcessingReport['gaze'];
  for(const [index,o] of plan.outputs.entries()){
    const destination=path.join(directory,'output-'+index+'.'+mediaFileExtension(o.mediaType)),filters:string[]=image?['format=rgba']:[],audioFilters:string[]=[];let filterComplex:string|undefined;
    if(c.operation==='denoise')audioFilters.push(`afftdn=nr=${c.noiseReduction}:nf=${c.noiseFloor}:tn=${c.trackNoise?1:0}`);
    if(c.operation==='key')filterComplex=`[0:v:0]format=rgba,split[raw][mask];[mask]alphaextract[original];[raw]colorkey=0x${c.color.slice(1)}:${c.similarity}:${c.blend},split[keyed][k];[k]alphaextract[new];[original][new]blend=all_mode=multiply[alpha];[keyed][alpha]alphamerge,scale=${o.width}:${o.height},format=${image?'rgba':'yuva444p10le'}[v]`;
    if(c.operation==='reframe'){
      const w=Math.max(2,Math.floor(s.specs.width*c.crop.width/2)*2),h=Math.max(2,Math.floor(s.specs.height*c.crop.height/2)*2),x=Math.min(s.specs.width-w,Math.floor(s.specs.width*c.crop.x/2)*2),y=Math.min(s.specs.height-h,Math.floor(s.specs.height*c.crop.y/2)*2);
      filters.push(`crop=${w}:${h}:${x}:${y}`,`scale=${o.width}:${o.height}:force_original_aspect_ratio=${c.fit==='cover'?'increase':'decrease'}`,...(c.fit==='cover'?[`crop=${o.width}:${o.height}`]:[`pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2:color=${o.alpha?'black@0':'black'}`]));
    }
    if(c.operation==='enhance'){
      const enhance=[...(c.deinterlace&&video?['yadif=mode=send_frame']:[]),...(c.denoise?[`hqdn3d=${c.denoise}:${c.denoise}:${c.denoise*1.5}:${c.denoise*1.5}`]:[]),`eq=contrast=${c.contrast}:brightness=${c.brightness}:saturation=${c.saturation}`,...(c.sharpen?[`unsharp=5:5:${c.sharpen}:5:5:0`]:[]),`scale=${o.width}:${o.height}`];
      if(o.alpha){filterComplex=`[0:v:0]format=rgba,split[color][mask];[mask]alphaextract,scale=${o.width}:${o.height}[a];[color]format=yuv444p,${enhance.join(',')}[rgb];[rgb][a]alphamerge,format=${image?'rgba':'yuva444p10le'}[v]`;}else filters.push(...enhance);
    }
    if(video&&!filterComplex)filters.push(`scale=${o.width}:${o.height}`);
    const maxBytes=o.mediaType==='video/quicktime'?1073741824:video?134217728:image?storedPngMaximumBytes:8388608,args=['-v','error','-nostdin','-n','-max_alloc','67108864','-threads','2',...sourceOptions,'-i',file,...(!image?['-ss',(o.startMs/1000).toFixed(3),'-t',(o.durationMs!/1000).toFixed(3)]:[]),'-filter_threads','1','-filter_complex_threads','1'];
    if(image||video){if(filterComplex)args.push('-filter_complex',filterComplex,'-map','[v]');else args.push('-map','0:v:0',...(filters.length?['-vf',filters.join(',')]:[]));if(image)args.push('-an','-frames:v','1','-update','1');else{args.push('-map','0:a:0?',...(o.alpha?['-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','16']:['-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p']),'-threads','2','-r',String(Math.min(60,s.specs.fps)), '-c:a','aac','-ar',String(payload.semanticBasis&&s.specs.hasAudio?s.specs.sampleRate:48000),'-ac',String(payload.semanticBasis&&s.specs.hasAudio?s.specs.channels:2),'-movflags','+faststart');}}
    else args.push('-map','0:a:0','-vn','-c:a','pcm_s16le','-ar',String(s.specs.sampleRate),'-ac',String(s.specs.channels));
    if(audioFilters.length)args.push('-af',audioFilters.join(','));args.push('-fs',String(maxBytes+1),destination);
    if(c.operation==='neural_denoise')Object.assign(metrics,await runNeuralDenoising({root,payload,file,destination,directory,alpha:o.alpha},signal,value=>onProgress((index+value)/plan.outputs.length)));
    else if(c.operation==='gaze'){const result=await runGazeCorrection({root,payload,file,destination,directory,alpha:o.alpha},signal,value=>onProgress((index+value)/plan.outputs.length));Object.assign(metrics,result.metrics);gaze=result.gaze;}
    else if(c.operation==='restore')Object.assign(metrics,await runNeuralRestoration({root,payload,file,destination,alpha:o.alpha},signal,value=>onProgress((index+value)/plan.outputs.length)));
    else if(c.operation==='segmentation')Object.assign(metrics,await runNeuralSegmentation({root,payload,file,destination,width:o.width!,height:o.height!,startMs:o.startMs,durationMs:o.durationMs},signal,value=>onProgress((index+value)/plan.outputs.length)));
    else if(c.operation==='subject_tracking'){const result=await runNeuralTracking({root,payload,file,destination,outWidth:o.width!,outHeight:o.height!,startMs:o.startMs,durationMs:o.durationMs,alpha:o.alpha},signal,value=>onProgress((index+value)/plan.outputs.length));Object.assign(metrics,result.metrics);tracking=result.tracking;}
    else await runMediaTool(tools.ffmpeg,args,signal,1800000);
    const size=fs.statSync(destination).size;if(!size||size>maxBytes)throw new AppError('MEDIA_OUTPUT_LIMIT','输出超过素材格式大小上限，请缩短区间或降低尺寸。',409);
    let specs:Record<string,number>,posterFile:string|undefined,previewFile:string|undefined;
    if(video){const inspectDir=path.join(directory,'inspect-'+index),inspection=o.alpha?await inspectAlphaVideoSource(destination,inspectDir,root,signal,()=>{}):await inspectVideoSource(destination,inspectDir,root,signal,()=>{});specs=inspection.specs;posterFile=inspection.posterFile;if(Math.abs(specs.durationMs-o.durationMs!)>Math.max(120,2000/s.specs.fps))throw new AppError('MEDIA_OUTPUT_TRUNCATED','输出时长与确认区间不符，未登记截断的素材；请缩短范围后重试。',409);if(o.alpha){previewFile=path.join(inspectDir,'browser-preview.mp4');await createAlphaBrowserPreview(destination,previewFile,root,signal);}}
    else{const bytes=fs.readFileSync(destination),inspected=image?inspectStoredPng(bytes):inspectMedia(bytes);if(inspected.mediaType!==o.mediaType)throw new AppError('MEDIA_OUTPUT_INVALID','处理结果格式与方案不符。',409);specs=inspected.specs;if(!image&&Math.abs(specs.durationMs-o.durationMs!)>10)throw new AppError('MEDIA_OUTPUT_TRUNCATED','声音结果未覆盖完整确认区间，请缩短后重试。',409);}
    if(['gaze','subject_tracking','restore','neural_denoise'].includes(c.operation)&&video&&s.specs.hasAudio){if(specs.channels!==s.specs.channels||specs.sampleRate!==s.specs.sampleRate)throw new AppError(c.operation==='neural_denoise'?'DENOISING_AUDIO_CHANGED':c.operation==='restore'?'RESTORATION_AUDIO_CHANGED':c.operation==='gaze'?'GAZE_AUDIO_CHANGED':'TRACKING_AUDIO_CHANGED',c.operation==='neural_denoise'?'神经降噪结果的通道或采样率与原片不符，未登记结果。':c.operation==='restore'?'修复结果的原声通道或采样率与原片不符，未登记结果。':c.operation==='gaze'?'眼部纠偏结果的原声通道或采样率与原片不符，未登记结果。':'跟踪结果的原声通道或采样率与原片不符，未登记结果。',409);metrics.originalAudioChannels=specs.channels;metrics.originalAudioSampleRate=specs.sampleRate;}
    if(o.width&&(specs.width!==o.width||specs.height!==o.height))throw new AppError('MEDIA_OUTPUT_DIMENSIONS','处理结果尺寸与确认方案不符，未登记素材。',409);
    files.push({name:o.name,mediaType:o.mediaType,file:destination,size,sha256:(await fileDigest(destination,signal)).sha256,specs,sourceStartMs:o.startMs,sourceDurationMs:o.durationMs,alpha:o.alpha,...(posterFile?{posterFile}:{}),...(previewFile?{previewFile}:{})});onProgress((index+1)/plan.outputs.length);
  }
  metrics.outputBytes=files.reduce((n,f)=>n+f.size,0);metrics.outputCount=files.length;return{files,report:{provider:'local-media',simulated:false,realAlgorithm:true,summary:c.operation==='neural_denoise'?'已实际运行本机DeepFilterNet3人声降噪，补偿模型延迟并保留原采样率与通道；请对照原声核对尾音、音色和音乐。':c.operation==='gaze'?(metrics.framesCorrected?'已实际运行本机关键点辅助眼眶内几何纠偏；未生成眼睛，请逐帧核对自然度。':'已实际检测并保留原眼部像素，本区间未发生几何纠偏；请查看闭眼或无需移动记录。'):c.operation==='restore'?(metrics.tileInferences?'已实际运行本机Real-ESRGAN逐帧超分修复，保留原声与透明度；请对照原片核对推测纹理和时序。':'所选区间没有可见像素，已保留透明度并检查输出；本任务未执行神经推理。'):c.operation==='segmentation'?'已实际运行本机U²-Net-P前景分割并检查透明结果，原素材保留；请逐段核对边缘与时序。':c.operation==='subject_tracking'?'已实际跟随起始点选前景并重新构图，保留原声；请逐段核对目标、轨迹和失锁记录。':'实际本地媒体加工和完整格式检查已完成，原素材保留。',metrics,recommendations:[],warnings:plan.warnings,...(tracking?{tracking}:{}),...(gaze?{gaze}:{})}};
}

