import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Repository} from '@digitalguide/database';
import {fixtureIds as f} from '../packages/test-fixtures/src/seed.js';
import {aeContractFixture} from '../packages/test-fixtures/src/ae-templates.js';
import {AeTemplates} from '../apps/api/src/ae-templates.js';
import type {Config} from '../apps/api/src/config.js';
import {mediaTools,runMediaTool} from '../packages/media/src/media-tools.js';
const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export async function aeMediaLifecycleFixture(repo:Repository,config:Config){
 const fixture=aeContractFixture(config.dataDir),m=fixture.manifest;
 m.catalogId='adoption-lifecycle';m.name='原创长视频契约来源（非Adobe）';m.output.frameCount=599*24;
 const meta=path.join(fixture.folder,'meta.json');fs.writeFileSync(meta,JSON.stringify(m.output));m.files=m.files.map(entry=>({...entry,size:fs.statSync(path.join(fixture.folder,entry.path)).size,sha256:hash(path.join(fixture.folder,entry.path))}));
 fs.writeFileSync(fixture.manifestFile,JSON.stringify(m,null,2)+'\n');const ref=fixture.runtime.catalog[0];ref.catalogId=m.catalogId;ref.manifestSHA256=hash(fixture.manifestFile);fs.writeFileSync(fixture.configFile,JSON.stringify(fixture.runtime,null,2)+'\n');config.aeConfigFile=fixture.configFile;
 const key=randomUUID()+'.mp4',file=path.join(config.dataDir,'objects',key);
 await runMediaTool(mediaTools(config.root).ffmpeg,['-v','error','-nostdin','-n','-f','lavfi','-i','color=c=0x163c92:s=1920x1080:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','599','-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','ultrafast','-crf','28','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-ac','2','-b:a','64k','-movflags','+faststart',file],AbortSignal.timeout(300000),300000);
 const videoSHA256=hash(file),size=fs.statSync(file).size,s=new AeTemplates(repo,config),actor=repo.principal(f.adminA),source=await s.source(actor,{catalog_id:m.catalogId,catalog_revision:m.revision,manifest_sha256:ref.manifestSHA256,workspace_id:f.workspaceA},true,undefined,false),templateId=repo.transaction(()=>s.register(actor,f.workspaceA,source.entry));
 async function result(name:string){
  const input={workspaceId:f.workspaceA,name,templateId,templateVersion:1,kind:'mp4' as const,data:{format:'json' as const,content:JSON.stringify([{name,parameters:{}}])}},prepared=await s.plan(actor,input);
  return repo.transaction(()=>{const batchId=s.create(actor,input,prepared),job=repo.get<{id:string}>('SELECT id FROM ae_render_jobs WHERE batch_id=?',batchId)!,artifactId=randomUUID(),at=new Date().toISOString();
   // Deliberately seed an already-checked CONTRACT result. This fixture tests the new
   // compiled adoption lifecycle, and is NOT evidence that an AE renderer made this media.
   repo.run("UPDATE ae_render_jobs SET status='succeeded',stage='finished',version=version+1,attempts=1 WHERE id=?",job.id);
   repo.run('INSERT INTO ae_render_attempts VALUES (?,?,?,?,?,?,?,?)',job.id,1,'succeeded',JSON.stringify(prepared.rows[0].parameters),null,at,at,actor.userId);
   repo.run('INSERT INTO ae_render_artifacts VALUES (?,?,?,?,?,?,?,?,?)',artifactId,job.id,'video','原创长视频契约结果（非Adobe）.mp4','video/mp4',key,size,videoSHA256,at);s.refresh(batchId);return{batchId,jobId:job.id,artifactId,version:2};
  });
 }
 return{result,fixture,file,size,videoSHA256,templateId,contractResultSeeded:true,adobeOrActualAeRenderVerified:false};
}
