import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {AppError,canonical} from '@digitalguide/domain';
import type {SemanticEngine,MediaProcessingPayload} from '@digitalguide/contracts';
import {localFileHash,localOnnxRuntime} from './local-onnx-runtime.js';
export const semanticFiles=[
 {name:'model_quantized.onnx',upstream:'onnx/model_quantized.onnx',size:118308185,sha256:'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'},
 {name:'tokenizer.json',upstream:'tokenizer.json',size:17082730,sha256:'0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39'},
 {name:'tokenizer_config.json',upstream:'tokenizer_config.json',size:443,sha256:'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b'},
 {name:'config.json',upstream:'config.json',size:658,sha256:'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1'}
] as const;
const require=createRequire(import.meta.url);
export function semanticModel(root:string,force=false):{directory:string;engine:SemanticEngine}{
 try{const directory=path.resolve(root,'storage/tools/semantic-e5');for(const file of semanticFiles){const target=path.join(directory,file.name);if(!fs.existsSync(target))throw new AppError('SEMANTIC_MODEL_NOT_INSTALLED','本机尚未安装语义检索模型，请运行 pnpm setup:semantic 后重试。',409);if(fs.statSync(target).size!==file.size||localFileHash(target,force)!==file.sha256)throw new AppError('SEMANTIC_MODEL_CHANGED','本机语义模型或分词数据的字节校验不符，请核对安装包；不会返回模拟成功。',409);}
  // 使用与 ESM 消费路径相同的 mjs 文件，避免只锁定未使用的 CJS 入口。
  const cjs=require.resolve('@huggingface/tokenizers'),entry=path.join(path.dirname(cjs),'tokenizers.mjs'),metadata=JSON.parse(fs.readFileSync(path.join(path.dirname(cjs),'../package.json'),'utf8')) as {version:string};if(metadata.version!=='0.2.0')throw new AppError('SEMANTIC_TOKENIZER_CHANGED','本机分词运行时版本已变化，请按锁文件恢复依赖后重新审阅。',409);
  return{directory,engine:{modelId:'multilingual-e5-small-quantized',modelSha256:semanticFiles[0].sha256,tokenizerSha256:semanticFiles[1].sha256,tokenizerConfigSha256:semanticFiles[2].sha256,modelConfigSha256:semanticFiles[3].sha256,...localOnnxRuntime(force),tokenizerVersion:'0.2.0',tokenizerRuntimeSha256:localFileHash(entry,force),pooling:'masked-mean-l2-query-passage-v1',maxTokens:256,candidatePolicy:'whole-phrase-window-nms-v1'}};
 }catch(error){if(error instanceof AppError)throw error;throw new AppError('SEMANTIC_RUNTIME_UNAVAILABLE','本机语义运行时无法读取，请按锁文件安装依赖并运行 pnpm setup:semantic。',409);}
}
export function requireSemanticEngine(root:string,payload:MediaProcessingPayload,force=false){const actual=semanticModel(root,force);if(!payload.engine||canonical(payload.engine)!==canonical(actual.engine))throw new AppError('SEMANTIC_ENGINE_CHANGED','语义模型、分词、运行时或候选策略已变化，请重新保存并审阅当前方案。',409);return actual;}
export function semanticCapability(root:string){try{return{available:true,engine:semanticModel(root).engine,reason:null,notice:'本机多语言语义检索，根据已确认的短语时间生成主题候选；需要人工核对，不预测传播效果。'};}catch(error){if(!(error instanceof AppError))throw error;return{available:false,engine:null,reason:error.message,notice:'需安装本机语义模型并提供已确认的带时间校对稿。'};}}
