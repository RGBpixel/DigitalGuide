import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {contentWritingEngine,contentWritingRequest} from '@digitalguide/contracts';
import {runContentWritingReviewed} from '../packages/providers/src/content-writing-reviewed.js';
import {writingText} from '../packages/test-fixtures/src/content-writing.js';

const root=process.cwd(),folder=path.resolve(process.argv[2]||'docs/evidence/T24/writing-calendar/model-failed-compiled-reproduction'),priorFile='docs/evidence/T24/writing-calendar/compiled-release/proof.json',proof=JSON.parse(fs.readFileSync(priorFile,'utf8')) as {result:string;dataDir:string;ids:{job:string};entrySHA256:Record<string,string>};
assert.equal(proof.result,'FAIL');const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');for(const [file,sha]of Object.entries(proof.entrySHA256))assert.equal(hash(file),sha);
const db=new DatabaseSync(path.join(proof.dataDir,'digitalguide.sqlite'),{readOnly:true});let request,engine;
try{const row=db.prepare('SELECT status,attempts,error_code,request,engine FROM studio_content_writing_jobs WHERE id=?').get(proof.ids.job) as {status:string;attempts:number;error_code:string;request:string;engine:string};assert.equal(row.status,'failed');assert.equal(row.attempts,2);assert.equal(row.error_code,'CONTENT_WRITING_REPAIR_NUMBER');request=contentWritingRequest.parse(JSON.parse(row.request));engine=contentWritingEngine.parse(JSON.parse(row.engine));assert.equal(request.sources[0].text,writingText);}finally{db.close();}
fs.mkdirSync(folder,{recursive:true});assert.ok(!fs.existsSync(path.join(folder,'probe.json')));
const sourceSHA256=Object.fromEntries(['packages/domain/src/writing-calendar.ts','packages/domain/src/writing-review.ts','packages/providers/src/content-writing-reviewed.ts','packages/providers/src/writing-inference.ts','packages/contracts/src/writing-review.ts'].map(file=>[file,hash(file)]));
fs.writeFileSync(path.join(folder,'source-at-execution.json'),JSON.stringify({checkedAt:new Date().toISOString(),sourceSHA256,compiledEntrySHA256:proof.entrySHA256,sameOriginalFailedJobInput:true},null,2)+'\n',{flag:'wx'});
let calls=0;const startedAt=new Date().toISOString();
try{const native=await runContentWritingReviewed({root,directory:path.join(folder,'private-work'),request,engine},new AbortController().signal,progress=>console.log(JSON.stringify({progress})),call=>fs.writeFileSync(path.join(folder,'call-'+String(++calls).padStart(2,'0')+'.json'),JSON.stringify(call,null,2)+'\n',{flag:'wx'}));fs.writeFileSync(path.join(folder,'probe.json'),JSON.stringify({result:'PASS_DIAGNOSTIC_NATIVE_PIPELINE_ONLY',startedAt,checkedAt:new Date().toISOString(),priorFile,originalFailedJobId:proof.ids.job,originalJobNotRetriedOrRewritten:true,request,native,calls,sourceSHA256,originalFailureNotRelabeled:true,generalFactualQualityVerified:false,realExternalActions:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'PASS_DIAGNOSTIC_NATIVE_PIPELINE_ONLY',calls}));}
catch(error){fs.writeFileSync(path.join(folder,'probe.json'),JSON.stringify({result:'FAIL',startedAt,checkedAt:new Date().toISOString(),priorFile,originalFailedJobId:proof.ids.job,originalJobNotRetriedOrRewritten:true,request,engine,calls,sourceSHA256,error:error instanceof Error?error.stack:String(error),generalFactualQualityVerified:false,realExternalActions:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'FAIL',calls}));throw error;}
