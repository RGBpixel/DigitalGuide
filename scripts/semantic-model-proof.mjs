import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {Tokenizer} from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web';

const root=process.cwd(),directory=path.join(root,'storage/tools/semantic-e5'),started=performance.now();
const folder=path.resolve(process.argv[2]||'docs/evidence/T24/semantic-clips/model-quality');fs.mkdirSync(folder,{recursive:true});const output=path.join(folder,'proof.json');if(fs.existsSync(output))throw new Error('Use a fresh evidence directory.');
const cases=[
 {name:'cross_language_front_desk',query:'How should a receptionist welcome a guest and contact the employee they are visiting?',expected:1,passages:['锅中放入花椒和辣椒，热油后炒出香味，再加入豆腐，最后撒上葱花。','客人来到公司大堂时，接待员先问好，询问预约情况和来访目的，然后联系受访同事下楼迎接。','夜空中的木星是一颗气态巨行星，拥有多颗卫星和巨大的风暴。']},
 {name:'payment_paraphrase',query:'顾客吃完饭以后怎样结账？',expected:2,passages:['服务员根据口味推荐新菜，给客人安排靠窗的座位，并告知厨房准备餐食。','门口的工作人员先核实访客预约，再联络办公室里负责接待的同事。','用餐结束后，收银员核对消费明细，展示应付金额，让食客扫码或刷卡支付，并提供电子发票。']},
 {name:'media_semantics',query:'不重新拍摄，怎样把已有的长视频做成一组短片？',expected:0,passages:['先把原片的讲话转成带时间的文字，再按内容选取完整段落，保留相应画面和原声，分别输出片段。','录制前应调整灯光和摄像机角度，确认收音设备后再开始现场演讲。','餐厅准备各类蔬菜和肉类，根据订单的先后顺序安排厨师出餐。']}
];
// 固定后再执行；用于验证同义改写和中英检索，不代表通用召回率。
const criteria={topOneMustMatch:true,minimumGap:0.01,dimension:384};
let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw new Error('Inference network forbidden');};
ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.logLevel='error';
let session;
try{
 const tokenizerStarted=performance.now(),tokenizer=new Tokenizer(JSON.parse(fs.readFileSync(path.join(directory,'tokenizer.json'),'utf8')),JSON.parse(fs.readFileSync(path.join(directory,'tokenizer_config.json'),'utf8'))),tokenizerMs=performance.now()-tokenizerStarted;
 const modelStarted=performance.now();session=await ort.InferenceSession.create(fs.readFileSync(path.join(directory,'model_quantized.onnx')),{executionProviders:['wasm'],graphOptimizationLevel:'all'});const modelMs=performance.now()-modelStarted;
 const signature={inputs:session.inputNames,outputs:session.outputNames,inputMetadata:session.inputMetadata,outputMetadata:session.outputMetadata};
 const timings=[];
 async function embed(text,prefix){const mark=performance.now(),encoded=tokenizer.encode(prefix+text,{return_token_type_ids:true}),feeds={};for(const name of session.inputNames){const values=name==='input_ids'?encoded.ids:encoded[name];if(!values)throw new Error('Unknown input '+name);feeds[name]=new ort.Tensor('int64',BigInt64Array.from(values,BigInt),[1,values.length]);}const outputs=await session.run(feeds),hidden=outputs.last_hidden_state;if(!hidden||hidden.dims[0]!==1||hidden.dims[1]!==encoded.ids.length||hidden.dims[2]!==384)throw new Error('Unexpected embedding shape');const pooled=new Float64Array(384);let count=0;for(let t=0;t<encoded.ids.length;t++){if(!encoded.attention_mask[t])continue;count++;for(let i=0;i<384;i++)pooled[i]+=hidden.data[t*384+i];}let norm=0;for(let i=0;i<384;i++){pooled[i]/=count;norm+=pooled[i]**2;}norm=Math.sqrt(norm);for(let i=0;i<384;i++)pooled[i]/=norm;timings.push({tokens:encoded.ids.length,ms:performance.now()-mark});return pooled;}
 const results=[];
 for(const entry of cases){const query=await embed(entry.query,'query: '),scores=[];for(let i=0;i<entry.passages.length;i++){const passage=await embed(entry.passages[i],'passage: ');scores.push({index:i,score:query.reduce((s,v,k)=>s+v*passage[k],0)});}scores.sort((a,b)=>b.score-a.score);const gap=scores[0].score-scores[1].score;results.push({...entry,scores,gap,pass:scores[0].index===entry.expected&&gap>=criteria.minimumGap});}
 const report={result:results.every(x=>x.pass)&&networkAttempts===0?'PASS':'FAIL',checkedAt:new Date().toISOString(),criteria,signature,results,networkAttempts,tokenizerMs,modelMs,timings,totalMs:performance.now()-started,memory:process.memoryUsage(),runtime:'onnxruntime-web-wasm-1.31.1',tokenizer:'@huggingface/tokenizers-0.2.0',threads:1};fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,signature:signature.inputs,modelMs,tokenizerMs,totalMs:report.totalMs,memory:report.memory,results:results.map(x=>({name:x.name,pass:x.pass,gap:x.gap,scores:x.scores}))}));if(report.result!=='PASS')process.exitCode=1;
}catch(error){fs.writeFileSync(output,JSON.stringify({result:'FAIL',error:String(error),stack:error.stack,totalMs:performance.now()-started,memory:process.memoryUsage()},null,2));console.error(error);process.exitCode=1;}finally{if(session)await session.release();}
