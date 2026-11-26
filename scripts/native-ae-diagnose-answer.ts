import fs from 'node:fs';
import path from 'node:path';
import {runPresentationComposedNative} from '../packages/providers/src/presentation-composed-native.js';
import type {PresentationAnswerRunInput} from '../packages/providers/src/presentation-answer-native.js';
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).input as PresentationAnswerRunInput,directory=path.join(path.dirname(input.directory),'diagnostic-'+Date.now()),report='docs/evidence/T20/postgres-ae-render/answer-diagnostic.json',abort=new AbortController(),timer=setTimeout(()=>abort.abort(),240000);let result:unknown;
try{const value=await runPresentationComposedNative({...input,directory},abort.signal,n=>console.log(JSON.stringify({progress:n})));result={result:'PASS',directory,answer:value};}catch(e){result={result:'FAIL',directory,error:e instanceof Error?{name:e.name,message:e.message,stack:e.stack,code:Reflect.get(e,'code')}:String(e)};}finally{clearTimeout(timer);}fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
