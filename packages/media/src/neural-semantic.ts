import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {Tokenizer,type Encoding} from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web';
import {AppError} from '@digitalguide/domain';
import type {MediaProcessingPayload,SemanticClipAnalysis} from '@digitalguide/contracts';
import {semanticWindows,selectSemanticWindows} from '../../domain/src/semantic-clips.js';
import {requireSemanticEngine} from './semantic-model.js';
const dimension=384,limit=256;
export function semanticEncodings(tokenizer:Pick<Tokenizer,'encode'>,text:string,prefix:'query: '|'passage: '):Encoding[]{
 const encoded=tokenizer.encode(prefix+text,{return_token_type_ids:true});if(encoded.ids.length<=limit)return[encoded];const chars=Array.from(text);if(chars.length<2)throw new AppError('SEMANTIC_TOKEN_LIMIT','单个字符的分词长度超出模型上限，请检查校对稿。',409);const middle=Math.floor(chars.length/2);return[...semanticEncodings(tokenizer,chars.slice(0,middle).join(''),prefix),...semanticEncodings(tokenizer,chars.slice(middle).join(''),prefix)];
}
export function prepareSemanticPassages(tokenizer:Pick<Tokenizer,'encode'>,queryText:string,texts:string[]){
 const query=semanticEncodings(tokenizer,queryText,'query: '),passages:Encoding[][]=[];let count=query.length;
 for(const text of texts){const parts=semanticEncodings(tokenizer,text,'passage: ');count+=parts.length;if(count>2048)throw new AppError('SEMANTIC_WORK_LIMIT','完整文本需要超过2048次语义推理，请缩短范围或分批处理；不会静默截断正文。',409);passages.push(parts);}
 return{query,passages,count};
}
export function normalizedMean(hidden:Float32Array,attention:number[]){if(hidden.length!==attention.length*dimension)throw new AppError('SEMANTIC_SIGNATURE','语义输出维度不符合已批准模型。',409);const vector=new Float64Array(dimension);let count=0;for(let t=0;t<attention.length;t++)if(attention[t]){count++;for(let i=0;i<dimension;i++){const value=hidden[t*dimension+i];if(!Number.isFinite(value))throw new AppError('SEMANTIC_INVALID_VECTOR','语义模型返回非有限数值，请核对运行时。',409);vector[i]+=value;}}if(!count)throw new AppError('SEMANTIC_EMPTY_VECTOR','语义模型没有有效分词。',409);let norm=0;for(let i=0;i<dimension;i++){vector[i]/=count;norm+=vector[i]**2;}norm=Math.sqrt(norm);if(norm<1e-12)throw new AppError('SEMANTIC_EMPTY_VECTOR','语义模型返回空向量。',409);for(let i=0;i<dimension;i++)vector[i]/=norm;return vector;}
export async function runNeuralSemantic(input:{root:string;payload:MediaProcessingPayload},signal:AbortSignal,onProgress:(fraction:number)=>void):Promise<{metrics:Record<string,number>;semantic:SemanticClipAnalysis}>{
 const {root,payload}=input,c=payload.configuration,source=payload.semanticSource;if(c.operation!=='semantic_split'||c.provider!=='local-media'||!source||!c.semantic)throw new AppError('SEMANTIC_CONFIGURATION','语义检索需要真实本机模型和已确认的带时间校对稿。',409);
 const prepared=semanticWindows(source,c),profile=requireSemanticEngine(root,payload,true);signal.throwIfAborted();ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.logLevel='error';
 const tokenizerStarted=performance.now(),tokenizer=new Tokenizer(JSON.parse(fs.readFileSync(path.join(profile.directory,'tokenizer.json'),'utf8')),JSON.parse(fs.readFileSync(path.join(profile.directory,'tokenizer_config.json'),'utf8'))),tokenizerMs=performance.now()-tokenizerStarted;
 const {query,passages,count}=prepareSemanticPassages(tokenizer,c.instruction.trim(),prepared.windows.map(w=>w.text));
 signal.throwIfAborted();const load=performance.now(),session=await ort.InferenceSession.create(fs.readFileSync(path.join(profile.directory,'model_quantized.onnx')),{executionProviders:['wasm'],graphOptimizationLevel:'all'}),metrics:Record<string,number>={modelVerified:1,wasmExecution:1,runtimeThreads:1,embeddingDimension:dimension,maxTokens:limit,tokenizerMs,modelLoadMs:performance.now()-load,inferences:0,inferenceMs:0,tokens:0,phraseWindows:prepared.windows.length,phrasesInRange:prepared.phrasesInRange,overlongPhrases:prepared.overlong,partialPhrases:prepared.partialPhrases,maximumResidentBytes:process.memoryUsage().rss};
 try{if(session.inputNames.join(',')!=='input_ids,attention_mask,token_type_ids'||!session.outputNames.includes('last_hidden_state'))throw new AppError('SEMANTIC_SIGNATURE','语义模型输入输出签名与固定配置不符。',409);
  async function embed(parts:Encoding[]){const pooled=new Float64Array(dimension);let weight=0;for(const part of parts){signal.throwIfAborted();const mark=performance.now(),feeds:Record<string,ort.Tensor>={input_ids:new ort.Tensor('int64',BigInt64Array.from(part.ids,BigInt),[1,part.ids.length]),attention_mask:new ort.Tensor('int64',BigInt64Array.from(part.attention_mask,BigInt),[1,part.ids.length]),token_type_ids:new ort.Tensor('int64',BigInt64Array.from(part.token_type_ids!,BigInt),[1,part.ids.length])};let outputs:ort.InferenceSession.OnnxValueMapType|undefined;
   try{outputs=await session.run(feeds,['last_hidden_state']);signal.throwIfAborted();const hidden=outputs.last_hidden_state;if(hidden.type!=='float32'||hidden.dims.join(',')!==`1,${part.ids.length},${dimension}`)throw new AppError('SEMANTIC_SIGNATURE','语义模型实际输出规格变化。',409);const vector=normalizedMean(hidden.data as Float32Array,part.attention_mask),w=Math.max(1,part.ids.length-4);for(let i=0;i<dimension;i++)pooled[i]+=vector[i]*w;weight+=w;}finally{for(const value of Object.values(feeds))value.dispose();if(outputs)for(const value of Object.values(outputs))value.dispose();}
   metrics.inferences++;metrics.inferenceMs+=performance.now()-mark;metrics.tokens+=part.ids.length;metrics.maximumResidentBytes=Math.max(metrics.maximumResidentBytes,process.memoryUsage().rss);onProgress(metrics.inferences/count);
  }let norm=0;for(let i=0;i<dimension;i++){pooled[i]/=weight;norm+=pooled[i]**2;}norm=Math.sqrt(norm);if(norm<1e-12)throw new AppError('SEMANTIC_EMPTY_VECTOR','语义汇总向量为空。',409);for(let i=0;i<dimension;i++)pooled[i]/=norm;return pooled;}
  const q=await embed(query),scored:SemanticClipAnalysis['candidates']=[];for(let i=0;i<prepared.windows.length;i++){const vector=await embed(passages[i]),score=Math.max(-1,Math.min(1,q.reduce((n,v,k)=>n+v*vector[k],0)));scored.push({...prepared.windows[i],name:'主题候选',score});}
  const candidates=selectSemanticWindows(scored,c.semantic.maxCandidates),semantic:SemanticClipAnalysis={query:c.instruction.trim(),contentSourceId:source.contentSourceId,reviewVersion:source.reviewVersion,reviewSha256:source.reviewSha256,timing:'phrase',candidates};requireSemanticEngine(root,payload,true);signal.throwIfAborted();return{metrics:{...metrics,recommendationCount:candidates.length,longTextParts:passages.filter(p=>p.length>1).length},semantic};
 }finally{await session.release();}
}
