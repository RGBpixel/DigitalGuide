import fs from 'node:fs';
import path from 'node:path';
import {AppError,canonical} from '@digitalguide/domain';
import type {RestorationEngine,MediaProcessingPayload} from '@digitalguide/contracts';
import {localFileHash,localOnnxRuntime} from './local-onnx-runtime.js';
export const restorationModelSHA256='7b10e80021ec3e0ff35017ae5022791879d93a799b2e201e1010a37510202266';
export const restorationCheckpointSHA256='8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292';
export const restorationModelSize=4866420;
export function restorationModel(root:string,force=false):{file:string;engine:RestorationEngine}{
 try{const file=path.resolve(root,'storage/tools/restoration/realesr-general-x4v3-fp32.onnx');if(!fs.existsSync(file))throw new AppError('RESTORATION_NOT_INSTALLED','本机尚未安装超分修复模型，请运行 pnpm setup:restoration 后重试。',409);if(fs.statSync(file).size!==restorationModelSize||localFileHash(file,force)!==restorationModelSHA256)throw new AppError('RESTORATION_MODEL_CHANGED','本机修复模型的字节校验不符，请核对固定安装包；不会改用模拟结果。',409);return{file,engine:{modelId:'realesr-general-x4v3-fp32',modelSha256:restorationModelSHA256,sourceCheckpointSha256:restorationCheckpointSHA256,...localOnnxRuntime(force),preprocessing:'rgb01-reflect36-tile256-area-alpha-bilinear-blend-v1',nativeScale:4,tileSize:256,tilePadding:36}};}catch(error){if(error instanceof AppError)throw error;throw new AppError('RESTORATION_RUNTIME_UNAVAILABLE','本机修复运行时无法读取，请按锁文件安装依赖并运行 pnpm setup:restoration。',409);}
}
export function requireRestorationEngine(root:string,payload:MediaProcessingPayload,force=false){const actual=restorationModel(root,force);if(!payload.engine||canonical(payload.engine)!==canonical(actual.engine))throw new AppError('RESTORATION_ENGINE_CHANGED','修复模型、运行时或分块/透明策略已变化，请重新保存并审阅当前方案。',409);return actual;}
export function restorationCapability(root:string){try{return{available:true,engine:restorationModel(root).engine,reason:null,notice:'实际本机Real-ESRGAN逐帧修复与1/2/4倍输出，透明度单独保留。模型会推测纹理，需回看，未经真实老片或实时质量验收。'};}catch(error){if(!(error instanceof AppError))throw error;return{available:false,engine:null,reason:error.message,notice:'需安装固定本机超分模型；常规滤镜和明确模拟不作为神经修复。'};}}
