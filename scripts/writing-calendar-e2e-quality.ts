import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import type {ContentWritingRequest,ContentWritingResult} from '@digitalguide/contracts';
import {writingText} from '../packages/test-fixtures/src/content-writing.js';
import {fixtureIds as f} from '../packages/test-fixtures/src/seed.js';
const folder='docs/evidence/T24/writing-calendar/browser-release',report=JSON.parse(fs.readFileSync(folder+'/e2e-results.json','utf8')) as {stats:{startTime:string;duration:number;expected:number;unexpected:number}};
assert.equal(report.stats.expected,6);assert.equal(report.stats.unexpected,0);
const earliest=Date.parse(report.stats.startTime)-90000,latest=Date.parse(report.stats.startTime)+report.stats.duration+30000;
const candidates:{directory:string;row:{id:string;workspace_id:string;status:string;request:string;result:string;evidence:string;created_at:string}}[]=[];
for(const entry of fs.readdirSync('storage/e2e-runs',{withFileTypes:true})){
  if(!entry.isDirectory())continue;const directory=path.resolve('storage/e2e-runs',entry.name),stat=fs.statSync(directory),created=stat.birthtimeMs||stat.mtimeMs;
  if(created<earliest||created>latest||!fs.existsSync(path.join(directory,'digitalguide.sqlite')))continue;
  const db=new DatabaseSync(path.join(directory,'digitalguide.sqlite'),{readOnly:true});
  try{for(const value of db.prepare('SELECT id,workspace_id,status,request,result,evidence,created_at FROM studio_content_writing_jobs WHERE created_at>=? AND created_at<=?').all(new Date(earliest).toISOString(),new Date(latest).toISOString())){
    const row=value as typeof candidates[number]['row'],request=JSON.parse(row.request) as ContentWritingRequest;
    if(row.workspace_id===f.workspaceA&&request.sources.length===1&&request.sources[0].text===writingText&&request.sources[0].title.startsWith('浏览器原创资料'))candidates.push({directory,row});
  }}finally{db.close();}
}
assert.equal(candidates.length,1);const {directory,row}=candidates[0],request=JSON.parse(row.request) as ContentWritingRequest,result=JSON.parse(row.result) as ContentWritingResult,evidence=JSON.parse(row.evidence);
assert.equal(row.status,'succeeded');assert.equal(evidence.engine.policy,'source-script-reviewed-v3');assert.equal(evidence.offlineCpu,true);
fs.writeFileSync(folder+'/actual-model-job.json',JSON.stringify({recordedAt:new Date().toISOString(),scope:'Post-run quality inspection of the uniquely matched project-owned synthetic E2E fixture; not access to real withdrawn content.',isolatedOwnedSyntheticFixture:true,sourceWithdrawnInTest:true,jobId:row.id,isolatedDirectory:directory,request,result,evidence,generalFactualQualityVerified:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({jobId:row.id,modelOutcome:evidence.review.outcome,variants:result.variants.map(v=>({title:v.title,angle:v.angle,sections:v.sections.map(s=>s.text)}))},null,2));
