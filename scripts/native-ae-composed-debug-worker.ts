import fs from 'node:fs';
import {runPresentationComposedNative} from '../packages/providers/src/presentation-composed-native.js';
import type {PresentationAnswerRunInput} from '../packages/providers/src/presentation-answer-native.js';
const task=JSON.parse(fs.readFileSync(process.argv[2],'utf8')) as {input:PresentationAnswerRunInput;resultFile:string;progressFile:string};
try{const result=await runPresentationComposedNative(task.input,new AbortController().signal,n=>fs.appendFileSync(task.progressFile,JSON.stringify({progress:n})+'\n'));fs.writeFileSync(task.resultFile,JSON.stringify({result}),{flag:'wx'});}catch(e){fs.writeFileSync(task.resultFile,JSON.stringify({error:e instanceof Error?{name:e.name,code:Reflect.get(e,'code'),message:e.message,stack:e.stack}:String(e)}),{flag:'wx'});}
