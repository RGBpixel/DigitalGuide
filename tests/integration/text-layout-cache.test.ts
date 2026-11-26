import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {PNG} from 'pngjs';
import {blankStudioDocument,type StudioProject} from '@digitalguide/contracts';
import {canonical} from '@digitalguide/domain';
import {syntheticPng} from '@digitalguide/media';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {StudioService} from '../../apps/api/src/studio-service.js';
import {runStudioPreview} from '../../apps/worker/src/studio-previews.js';
import * as storyboard from '../../packages/media/src/storyboard-preview.js';
import {harness} from './helpers.js';
let h:Awaited<ReturnType<typeof harness>>;
beforeEach(async()=>{h=await harness();});afterEach(async()=>{vi.restoreAllMocks();await h.close();});
async function post<T>(url:string,body:object){const r=await h.app.inject({method:'POST',url:'/api/v1'+url,payload:body,headers:{...h.headers,'idempotency-key':randomUUID()}});expect(r.statusCode,r.body).toBeGreaterThanOrEqual(200);expect(r.statusCode,r.body).toBeLessThan(300);return r.json().data as T;}
async function current(id:string){return(await h.app.inject({url:'/api/v1/studio/projects/'+id,headers:h.headers})).json().data as StudioProject;}
describe('R-077 SQLite旧文字排版预览缓存',()=>{
 it('保留旧缓存夹具但拒绝展示；实际重新绘制一次后只复用当前策略缓存',async()=>{
  const document=blankStudioDocument();document.segments[0].text='The museum is closed on Wednesdays.';const project=await post<StudioProject>('/studio/projects',{workspaceId:f.workspaceA,name:'原创文字排版缓存复验',purpose:'video',document}),service=new StudioService(h.repo,h.config.providerMode,h.config.appEnv,h.config.dataDir),principal=h.repo.principal(f.adminA),segment=project.document.segments[0],resources=service.resources(principal,f.workspaceA,'video',project.document,segment.id),oldFingerprint=createHash('sha256').update(canonical({canvas:project.document.canvas,brand:project.document.brand,segment,speaker:project.document.speakers.find(s=>s.id===segment.speakerId)||null,resources})).digest('hex');
  const oldId=randomUUID(),key=randomUUID()+'.png',old=syntheticPng([100,20,20]),dimensions=PNG.sync.read(old),file=path.join(h.config.dataDir,'objects',key);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,old,{flag:'wx'});h.repo.run("INSERT INTO studio_preview_frames(id,project_id,segment_id,fingerprint,storage_key,status,width,height,created_at) VALUES(?,?,?,?,?,'ready',?,?,?)",oldId,project.id,segment.id,oldFingerprint,key,dimensions.width,dimensions.height,new Date().toISOString());
  expect((await current(project.id)).frames[0]).toMatchObject({id:oldId,status:'stale'});expect((await h.app.inject({url:'/api/v1/studio/previews/'+oldId,headers:h.headers})).statusCode).toBe(409);const renderer=vi.spyOn(storyboard,'renderStoryboard');
  const generate=async()=>{const plan=await post<{hash:string}>('/studio/projects/'+project.id+'/plan',{version:project.version});await post('/studio/projects/'+project.id+'/previews',{version:project.version,planHash:plan.hash,confirmed:true,segmentIds:[segment.id]});expect(await runStudioPreview(h.repo,h.config)).toBe(true);return(await current(project.id)).frames.find(f=>f.status==='ready')!;};
  const first=await generate();expect(first.id).not.toBe(oldId);expect(first.fingerprint).not.toBe(oldFingerprint);expect(renderer).toHaveBeenCalledTimes(1);const second=await generate();expect(second.id).toBe(first.id);expect(renderer).toHaveBeenCalledTimes(1);expect(h.repo.all('SELECT id FROM studio_preview_frames WHERE project_id=?',project.id)).toHaveLength(2);expect(fs.readFileSync(file).equals(old)).toBe(true);expect((await current(project.id)).document).toEqual(project.document);expect((await current(project.id)).version).toBe(project.version);
 });
});
