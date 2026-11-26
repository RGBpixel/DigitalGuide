import fs from 'node:fs';
import path from 'node:path';
import {Tokenizer,type Encoding} from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web';
import {AppError,canonical} from '@digitalguide/domain';
import type {PresentationAnswerEngine} from '@digitalguide/contracts';
import {semanticModel} from './semantic-model.js';
import {prepareSemanticPassages,semanticEncodings,normalizedMean} from './neural-semantic.js';
const retrievalIdentity=(engine:ReturnType<typeof semanticModel>['engine'])=>Object.fromEntries(Object.entries(engine).filter(([key])=>key!=='candidatePolicy'));
export async function rankSemanticTexts(root:string,engine:PresentationAnswerEngine['retrieval'],question:string,texts:string[],signal:AbortSignal,onProgress:(fraction:number)=>void){
 const result=await rankSemanticQuestions(root,engine,[question],texts,signal,onProgress);return{scores:result.scores[0],inferences:result.inferences};
}
export async function rankSemanticQuestions(root:string,engine:PresentationAnswerEngine['retrieval'],questions:string[],texts:string[],signal:AbortSignal,onProgress:(fraction:number)=>void){
 if(!questions.length||questions.length>6||!texts.length||texts.length>512)throw new AppError('PRESENTATION_RETRIEVAL_LIMIT','子问或完整讲稿数量超出当前检索范围，不会截断问题。',409);
 const profile=semanticModel(root,true);if(canonical(retrievalIdentity(profile.engine))!==canonical(engine))throw new AppError('PRESENTATION_RETRIEVAL_CHANGED','答疑检索模型或策略已经变化，请重新配置场次。',409);
 signal.throwIfAborted();const tokenizer=new Tokenizer(JSON.parse(fs.readFileSync(path.join(profile.directory,'tokenizer.json'),'utf8')),JSON.parse(fs.readFileSync(path.join(profile.directory,'tokenizer_config.json'),'utf8'))),first=prepareSemanticPassages(tokenizer,questions[0],texts),queries=[first.query,...questions.slice(1).map(q=>semanticEncodings(tokenizer,q,'query: '))],prepared={passages:first.passages,count:first.count+queries.slice(1).reduce((n,p)=>n+p.length,0)};
 if(prepared.count>2048)throw new AppError('SEMANTIC_WORK_LIMIT','全部子问和完整讲稿需要超过2048次语义推理，请缩短范围；不会截断正文。',409);
 ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.logLevel='error';
 const session=await ort.InferenceSession.create(fs.readFileSync(path.join(profile.directory,'model_quantized.onnx')),{executionProviders:['wasm'],graphOptimizationLevel:'all'});let inferences=0;
 try{
  if(session.inputNames.join(',')!=='input_ids,attention_mask,token_type_ids'||!session.outputNames.includes('last_hidden_state'))throw new AppError('SEMANTIC_SIGNATURE','检索模型输入输出签名变化。',409);
  async function embed(parts:Encoding[]){const pooled=new Float64Array(384);let weight=0;
   for(const part of parts){signal.throwIfAborted();const feeds:Record<string,ort.Tensor>={input_ids:new ort.Tensor('int64',BigInt64Array.from(part.ids,BigInt),[1,part.ids.length]),attention_mask:new ort.Tensor('int64',BigInt64Array.from(part.attention_mask,BigInt),[1,part.ids.length]),token_type_ids:new ort.Tensor('int64',BigInt64Array.from(part.token_type_ids!,BigInt),[1,part.ids.length])};let outputs:ort.InferenceSession.OnnxValueMapType|undefined;
    try{outputs=await session.run(feeds,['last_hidden_state']);signal.throwIfAborted();const hidden=outputs.last_hidden_state;if(hidden.type!=='float32'||hidden.dims.join(',')!==`1,${part.ids.length},384`)throw new AppError('SEMANTIC_SIGNATURE','检索向量规格变化。',409);const vector=normalizedMean(hidden.data as Float32Array,part.attention_mask),w=Math.max(1,part.ids.length-4);for(let i=0;i<384;i++)pooled[i]+=vector[i]*w;weight+=w;}finally{for(const value of Object.values(feeds))value.dispose();if(outputs)for(const value of Object.values(outputs))value.dispose();}
    inferences++;onProgress(inferences/prepared.count);
   }
   let norm=0;for(let i=0;i<384;i++){pooled[i]/=weight;norm+=pooled[i]**2;}norm=Math.sqrt(norm);if(norm<1e-12)throw new AppError('SEMANTIC_EMPTY_VECTOR','检索向量为空。',409);for(let i=0;i<384;i++)pooled[i]/=norm;return pooled;
  }
  const queryVectors:Float64Array[]=[];for(const query of queries)queryVectors.push(await embed(query));const vectors:Float64Array[]=[];for(const part of prepared.passages)vectors.push(await embed(part));const scores=queryVectors.map(q=>vectors.map(vector=>q.reduce((n,v,i)=>n+v*vector[i],0)));
  if(canonical(retrievalIdentity(semanticModel(root,true).engine))!==canonical(engine))throw new AppError('PRESENTATION_RETRIEVAL_CHANGED','检索期间模型发生变化，未保存答复。',409);return{scores,inferences};
 }finally{await session.release();}
}
