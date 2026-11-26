import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {AppError,canonical} from '@digitalguide/domain';
import type {SegmentationEngine,MediaEngine,TrackingEngine,MediaProcessingPayload} from '@digitalguide/contracts';

export const segmentationModelSHA256='309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';
export const segmentationModelSize=4574861;
const require=createRequire(import.meta.url),hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const hashes=new Map<string,{stamp:string;hash:string}>();
function fileHash(file:string,force:boolean){const stat=fs.statSync(file),stamp=stat.size+':'+stat.mtimeMs+':'+stat.ctimeMs,prior=hashes.get(file);if(!force&&prior?.stamp===stamp)return prior.hash;const result=hash(fs.readFileSync(file));hashes.set(file,{stamp,hash:result});return result;}
export function segmentationModel(root:string,force=false):{file:string;engine:SegmentationEngine}{
 try{
  const file=path.resolve(root,'storage/tools/u2netp/u2netp.onnx');
  if(!fs.existsSync(file))throw new AppError('SEGMENTATION_NOT_INSTALLED','本机尚未安装前景分割模型，请运行 pnpm setup:segmentation 后重试。',409);
  if(fs.statSync(file).size!==segmentationModelSize||fileHash(file,force)!==segmentationModelSHA256)throw new AppError('SEGMENTATION_MODEL_CHANGED','本机分割模型字节校验不符，请重新核对安装包；不会改用模拟结果。',409);
  const entry=require.resolve('onnxruntime-web'),directory=path.dirname(entry),metadata=JSON.parse(fs.readFileSync(path.join(directory,'../package.json'),'utf8')) as {version:string};
  if(metadata.version!=='1.31.1')throw new AppError('SEGMENTATION_RUNTIME_CHANGED','本机推理运行时版本与批准配置不同，请按锁文件恢复依赖后重新审阅。',409);
  const files=['ort.node.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'];
  const runtimeSha256=hash(canonical(files.map(name=>({name,sha256:fileHash(path.join(directory,name),force)}))));
  return{file,engine:{modelId:'u2netp-rembg-v0',modelSha256:segmentationModelSHA256,runtime:'onnxruntime-web-wasm',runtimeVersion:'1.31.1',runtimeSha256,preprocessing:'u2netp-rgba-bilinear-maxnorm-v1'}};
 }catch(error){if(error instanceof AppError)throw error;throw new AppError('SEGMENTATION_RUNTIME_UNAVAILABLE','本机分割运行时缺失或无法读取，请按锁文件安装依赖并运行 pnpm setup:segmentation。',409);}
}
export function requireSegmentationEngine(root:string,engine:MediaEngine|undefined,force=false){const actual=segmentationModel(root,force);if(!engine||canonical(engine)!==canonical(actual.engine))throw new AppError('SEGMENTATION_ENGINE_CHANGED','分割模型、预处理或推理运行时已变化，请重新保存方案并审阅当前指纹。',409);return actual;}
export function trackingModel(root:string,force=false):{file:string;engine:TrackingEngine}{const actual=segmentationModel(root,force);return{file:actual.file,engine:{...actual.engine,trackingPolicy:'u2netp-components-motion-crop-v1'}};}
export function requireForegroundEngine(root:string,payload:MediaProcessingPayload,force=false){if(payload.configuration.operation!=='subject_tracking')return requireSegmentationEngine(root,payload.engine,force);const actual=trackingModel(root,force);if(!payload.engine||canonical(payload.engine)!==canonical(actual.engine))throw new AppError('TRACKING_ENGINE_CHANGED','跟踪模型、运行时或策略版本已变化，请重新保存并审阅当前方案。',409);return actual;}
export function segmentationCapability(root:string){try{return{available:true,engine:segmentationModel(root).engine,reason:null,execution:'本机 CPU · 单线程 WebAssembly',modelInputWidth:320,modelInputHeight:320,foregroundClasses:'通用显著前景，不识别人脸、身份或特定人物'};}catch(error){if(!(error instanceof AppError))throw error;return{available:false,engine:null,reason:error.message,execution:'本机 CPU · 单线程 WebAssembly',modelInputWidth:320,modelInputHeight:320,foregroundClasses:'通用显著前景，不识别人脸、身份或特定人物'};}}
