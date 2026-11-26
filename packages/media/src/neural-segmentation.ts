import fs from 'node:fs';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {PNG} from 'pngjs';
import * as ort from 'onnxruntime-web';
import {AppError} from '@digitalguide/domain';
import type {MediaProcessingPayload} from '@digitalguide/contracts';
import {requireSegmentationEngine} from './segmentation-model.js';
import {mediaTools} from './media-tools.js';
import {mp4InputOptions} from './video-source.js';

const side=320,pixels=side*side,mean=[.485,.456,.406],std=[.229,.224,.225];
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export function sampleBilinear(data:Uint8Array|Float32Array,width:number,height:number,channels:number,x:number,y:number,channel:number){
 const px=Math.max(0,Math.min(width-1,x)),py=Math.max(0,Math.min(height-1,y)),x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(x0+1,width-1),y1=Math.min(y0+1,height-1),dx=px-x0,dy=py-y0;
 return(data[(y0*width+x0)*channels+channel]*(1-dx)+data[(y0*width+x1)*channels+channel]*dx)*(1-dy)+(data[(y1*width+x0)*channels+channel]*(1-dx)+data[(y1*width+x1)*channels+channel]*dx)*dy;
}
export function segmentationTensor(rgba:Uint8Array,width:number,height:number){
 if(rgba.length!==width*height*4||width<1||height<1)throw new AppError('SEGMENTATION_FRAME','分割帧长度与画面规格不一致。',409);
 const values=new Float32Array(pixels*3);let maximum=0;
 for(let y=0;y<side;y++)for(let x=0;x<side;x++){const sx=(x+.5)*width/side-.5,sy=(y+.5)*height/side-.5,alpha=sampleBilinear(rgba,width,height,4,sx,sy,3)/255;for(let c=0;c<3;c++){const v=sampleBilinear(rgba,width,height,4,sx,sy,c)*alpha;values[c*pixels+y*side+x]=v;maximum=Math.max(maximum,v);}}
 for(let c=0;c<3;c++)for(let i=0;i<pixels;i++)values[c*pixels+i]=(values[c*pixels+i]/Math.max(maximum,1e-6)-mean[c])/std[c];
 return values;
}
export function applySegmentationMask(rgba:Buffer,width:number,height:number,prediction:Float32Array,strength:number){
 if(prediction.length!==pixels||rgba.length!==width*height*4)throw new AppError('SEGMENTATION_OUTPUT','分割遮罩维度与确认模型不符。',409);
 let lo=Infinity,hi=-Infinity;for(const value of prediction){if(!Number.isFinite(value))throw new AppError('SEGMENTATION_OUTPUT','分割模型返回了无效数值，未登记结果。',409);lo=Math.min(lo,value);hi=Math.max(hi,value);}if(hi-lo<1e-7)throw new AppError('SEGMENTATION_NO_MASK','模型没有给出可分离的前景遮罩，请核对原画面或使用其他处理方案。',409);
 const mask=new Float32Array(pixels);for(let i=0;i<pixels;i++)mask[i]=(prediction[i]-lo)/(hi-lo);const output=Buffer.from(rgba),gamma=2**((strength-.5)*4);let cleared=0,retained=0,soft=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4,alpha=Math.round(rgba[at+3]*clamp(sampleBilinear(mask,side,side,1,(x+.5)*side/width-.5,(y+.5)*side/height-.5,0))**gamma);output[at+3]=alpha;if(alpha===0){output[at]=0;output[at+1]=0;output[at+2]=0;cleared++;}else if(alpha===255)retained++;else soft++;}
 return{output,cleared,retained,soft};
}
export async function runNeuralSegmentation(input:{root:string;payload:MediaProcessingPayload;file:string;destination:string;width:number;height:number;startMs:number;durationMs:number|null},signal:AbortSignal,onProgress:(fraction:number)=>void){
 const {root,payload,file,destination,width,height,startMs,durationMs}=input,c=payload.configuration;if(c.operation!=='segmentation'||c.provider!=='local-media')throw new AppError('SEGMENTATION_CONFIGURATION','本地分割只接受已审阅的真实模型方案。',409);
 const strength=c.strength,profile=requireSegmentationEngine(root,payload.engine,true);signal.throwIfAborted();ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.logLevel='error';
 const opened=performance.now(),session=await ort.InferenceSession.create(fs.readFileSync(profile.file),{executionProviders:['wasm'],graphOptimizationLevel:'all'}),metrics:Record<string,number>={modelVerified:1,modelInputWidth:side,modelInputHeight:side,runtimeThreads:1,wasmExecution:1,modelLoadMs:performance.now()-opened,framesInferred:0,inferenceMs:0,transparentPixels:0,opaquePixels:0,softAlphaPixels:0};
 if(session.inputNames[0]!=='input.1'||session.outputNames[0]!=='1959'){await session.release();throw new AppError('SEGMENTATION_SIGNATURE','模型输入输出签名与批准配置不符。',409);}
 async function frame(bytes:Buffer){signal.throwIfAborted();const started=performance.now(),tensor=new ort.Tensor('float32',segmentationTensor(bytes,width,height),[1,3,side,side]),output=await session.run({[session.inputNames[0]]:tensor},[session.outputNames[0]]),mask=output[session.outputNames[0]];signal.throwIfAborted();if(mask.type!=='float32'||mask.dims.join(',')!=='1,1,320,320')throw new AppError('SEGMENTATION_OUTPUT','实际模型输出规格不符合固定遮罩签名。',409);const result=applySegmentationMask(bytes,width,height,mask.data as Float32Array,strength);metrics.framesInferred++;metrics.inferenceMs+=performance.now()-started;metrics.transparentPixels+=result.cleared;metrics.opaquePixels+=result.retained;metrics.softAlphaPixels+=result.soft;return result.output;}
 try{
  if(payload.source.mediaType==='image/png'){const png=PNG.sync.read(fs.readFileSync(file));if(png.width!==width||png.height!==height)throw new AppError('SEGMENTATION_FRAME','原图片规格已变化。',409);const rgba=await frame(png.data);signal.throwIfAborted();png.data=rgba;fs.writeFileSync(destination,PNG.sync.write(png),{flag:'wx'});onProgress(1);}
  else{
   const fps=Math.min(60,payload.source.specs.fps),duration=durationMs!,expectedFrames=Math.max(1,Math.ceil(duration*fps/1000-1e-6)),tools=mediaTools(root),time=(startMs/1000).toFixed(3),length=(duration/1000).toFixed(3),frameBytes=width*height*4;
   const decode=['-v','error','-nostdin','-threads','2',...mp4InputOptions,'-ss',time,'-i',file,'-t',length,'-map','0:v:0','-an','-vf',`fps=${fps},scale=${width}:${height},format=rgba`,'-threads','2','-f','rawvideo','pipe:1'];
   const encode=['-v','error','-nostdin','-n','-threads','2','-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-probesize','32','-i','pipe:0',...(payload.source.specs.hasAudio?[...mp4InputOptions,'-ss',time,'-i',file]:[]),'-t',length,'-map','0:v:0',...(payload.source.specs.hasAudio?['-map','1:a:0','-c:a','aac','-ar','48000','-ac','2']:['-an']),'-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','16','-threads','2','-fs','1073741825',destination];
   const children:ChildProcessWithoutNullStreams[]=[];
   function child(args:string[]){const p=spawn(tools.ffmpeg,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],signal});p.stdin.on('error',()=>{});p.stderr.resume();p.stdout.pause();children.push(p);const closed=new Promise<{code:number|null;error?:Error}>(resolve=>{let error:Error|undefined;p.on('error',e=>{error=e;});p.once('close',code=>resolve({code,error}));});return{process:p,closed};}
   const decoder=child(decode),encoder=child(encode);encoder.process.stdout.resume();const pending=Buffer.allocUnsafe(frameBytes);let filled=0;
   try{
    for await(const data of decoder.process.stdout){signal.throwIfAborted();const chunk=data as Buffer;let offset=0;while(offset<chunk.length){const take=Math.min(frameBytes-filled,chunk.length-offset);chunk.copy(pending,filled,offset,offset+take);filled+=take;offset+=take;if(filled===frameBytes){const rgba=await frame(pending);filled=0;if(metrics.framesInferred>expectedFrames+1)throw new AppError('SEGMENTATION_FRAME_COUNT','解码帧数超出确认区间，未登记结果。',409);await new Promise<void>((resolve,reject)=>encoder.process.stdin.write(rgba,error=>error?reject(error):resolve()));onProgress(Math.min(.99,metrics.framesInferred/expectedFrames));}}}
    encoder.process.stdin.end();const [d,e]=await Promise.all([decoder.closed,encoder.closed]);signal.throwIfAborted();if(d.code!==0||e.code!==0||d.error||e.error||filled||Math.abs(metrics.framesInferred-expectedFrames)>1||!metrics.framesInferred)throw new AppError('SEGMENTATION_VIDEO_INCOMPLETE','分割视频未覆盖完整确认区间，请核对原片、时长或可用空间后重试。',409);metrics.expectedFrames=expectedFrames;metrics.outputFps=fps;onProgress(1);
   }finally{for(const p of children)if(p.exitCode===null&&p.signalCode===null)p.kill();await Promise.allSettled([decoder.closed,encoder.closed]);}
  }
  requireSegmentationEngine(root,payload.engine,true);signal.throwIfAborted();return metrics;
 }finally{await session.release();}
}
