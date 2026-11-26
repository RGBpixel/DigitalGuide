import fs from 'node:fs';
import {inspectCollectionFile,type CollectionInspectionInput} from './collection-inspection.js';
// Private server-written file, never an HTTP command or executable supplied by a user.
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8')) as {input:CollectionInspectionInput;resultFile:string;progressFile:string};
let last=-1;
try {
 const result=await inspectCollectionFile(request.input,new AbortController().signal,value=>{const percent=Math.floor(value*100);if(percent>last){last=percent;fs.appendFileSync(request.progressFile,JSON.stringify({progress:value})+'\n');}});
 fs.writeFileSync(request.resultFile,JSON.stringify(result),{flag:'wx',mode:0o600});
}catch{process.exitCode=1;}
