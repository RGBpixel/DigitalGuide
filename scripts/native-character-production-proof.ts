import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium,expect,type Browser} from '@playwright/test';
import {blankStudioDocument,type Asset,type Character,type CharacterJob,type ExportPlan,type StudioExport,type StudioProject} from '../packages/contracts/src/index.js';
import {syntheticToneWav} from '../packages/media/src/index.js';
import {nativeCharacterProductionBrowser} from './native-character-production-browser.js';
import {NativeContentProofRuntime,proofUntil,proofHash,type NativeProofProcess} from './postgres-content-proof-runtime.js';

const label=process.argv[2];assert.match(label,/^[a-z][a-z0-9-]+$/);
const priorFile=process.argv[3],priorDirectory=priorFile?path.dirname(path.resolve(priorFile)):null,c=priorFile?await NativeContentProofRuntime.resume('docs/evidence/T20/postgres-character-production/'+label,priorFile):await NativeContentProofRuntime.create('docs/evidence/T20/postgres-character-production/'+label),workspace='20000000-0000-4000-8000-000000000001';
let browser:Browser|undefined,failure:unknown,worker:NativeProofProcess|undefined,killArmed=false,killed:{jobId:string;attempt:number;issuedAt:string;issued:boolean}|undefined;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function download(url:string,name:string){assert.ok(url.startsWith('/api/v1/'));const response=await fetch('http://127.0.0.1:'+c.apiA+url,{headers:c.headers});assert.equal(response.status,200,'File request '+url);const bytes=Buffer.from(await response.arrayBuffer()),file=path.join(c.out,name);fs.writeFileSync(file,bytes,{flag:'wx'});return{file,sha256:hash(bytes),size:bytes.length};}
function tool(exe:string,args:string[]){return execFileSync(exe,args,{windowsHide:true,timeout:45000,maxBuffer:8388608});}
async function catalogue(){return c.owner(async db=>{const result:Record<string,unknown>={};for(const table of ['studio_characters','studio_character_versions','character_motion_plans','character_motion_versions','character_jobs','_dg_native_character_inputs','_dg_native_character_outputs','_dg_native_character_assets'])result[table]=(await db.query('SELECT to_jsonb(t) AS value FROM '+table+' t ORDER BY to_jsonb(t)::text')).rows.map(r=>r.value);return result;});}

try{
 let previous:(Awaited<ReturnType<typeof nativeCharacterProductionBrowser>>&{voice:Asset})|undefined;
 let voice:Asset,project:StudioProject;
 if(priorDirectory){await c.prepareResume();previous=JSON.parse(fs.readFileSync(path.join(priorDirectory,'fixture.json'),'utf8'));voice=previous!.voice;project=previous!.project;}
 else{await c.prepare();const voiceBytes=syntheticToneWav(1200),uploaded=await c.good<{uploadId:string}>('/assets/uploads',{workspaceId:workspace,fileName:'原创1200毫秒纯音幅度参考.wav',contentBase64:voiceBytes.toString('base64')});voice=await c.good<Asset>('/assets',{uploadId:uploaded.uploadId,name:'原创幅度参考纯音',category:'voice'});const document=blankStudioDocument();document.canvas={width:1280,height:720,fps:24,transparent:false};document.segments[0].durationMs=3000;document.segments[0].text='原创角色本地制作与审核应用。';project=await c.good<StudioProject>('/studio/projects',{workspaceId:workspace,name:'原生浏览器形象工程',purpose:'video',document});}
 c.save('scenario.json',{projectId:project.id,voiceAssetId:voice.id,voiceSHA256:voice.sha256,syntheticOnly:true});
 const onLine=(line:string,child:NativeProofProcess['child'])=>{let value:{event?:string;jobId?:string;attempt?:number};try{value=JSON.parse(line);}catch{return;}if(killArmed&&value.event==='native_character_claimed'&&value.jobId){killArmed=false;killed={jobId:value.jobId,attempt:value.attempt??0,issuedAt:new Date().toISOString(),issued:child.kill('SIGKILL')};}};
 worker=c.worker('owned-character-production-worker',onLine);
 c.start('built-character-web',process.execPath,[path.join(c.workspace,'node_modules/vite/bin/vite.js'),'preview','--config',path.join(c.workspace,'apps/web/vite.config.ts'),'--outDir',path.join(c.compiledRoot,'dist/web'),'--host','127.0.0.1','--port',String(c.web),'--strictPort'],{API_PORT:String(c.apiA),WEB_PORT:String(c.web)});
 const origin='http://127.0.0.1:'+c.web;await proofUntil(()=>fetch(origin).then(r=>r.status),v=>v===200);
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1100}}),at=c.cookie.indexOf('=');await context.addCookies([{name:c.cookie.slice(0,at),value:c.cookie.slice(at+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage(),browserErrors:string[]=[];page.on('pageerror',e=>browserErrors.push(e.message));
 let ui:Awaited<ReturnType<typeof nativeCharacterProductionBrowser>>;
 if(previous&&priorDirectory){ui=previous;await page.goto('/studio/characters?tab=production&project='+project.id+'&character='+ui.character.id);await expect(page.getByRole('article',{name:'形象任务',exact:true}).first()).toContainText('已写入工程v2');c.save('browser-resume.json',{result:'PASS',earlierBrowserReport:path.join(priorDirectory,'browser.json'),earlierBrowserReportSHA256:proofHash(path.join(priorDirectory,'browser.json')),sameCharacterId:ui.character.id,sameProjectId:project.id,sameMotionJobId:ui.applied.id,originalActionsNotReExecuted:true});c.add('built_original_character_application_visible_after_same_instance_resume');}
 else{ui=await nativeCharacterProductionBrowser(c,page,{projectId:project.id,voiceId:voice.id});for(const name of JSON.parse(fs.readFileSync(path.join(c.out,'browser.json'),'utf8')).checks as string[])c.add(name);}
 c.save('fixture.json',{...ui,voice});
 console.log(JSON.stringify({stage:'built_browser_pipeline_verified',motionJobId:ui.applied.id}));

 const motion=await download('/api/v1/studio/character-jobs/'+ui.applied.id+'/file','actual-motion.mp4');assert.equal(motion.sha256,ui.applied.outputs[0].sha256);if(priorDirectory)assert.equal(motion.sha256,proofHash(path.join(priorDirectory,'actual-motion.mp4')));
 const motionProbe=JSON.parse(tool(c.tools.ffprobe,['-v','error','-show_entries','stream=codec_type,codec_name,width,height,nb_frames:format=duration','-of','json',motion.file]).toString('utf8'));
 assert.ok(motionProbe.streams.some((v:{codec_name:string;width:number;height:number})=>v.codec_name==='h264'&&v.width===512&&v.height===768));
 for(const [time,name]of [['1.100','actual-motion-1100.png'],['1.600','actual-motion-1600.png']])tool(c.tools.ffmpeg,['-v','error','-nostdin','-n','-ss',time,'-i',motion.file,'-frames:v','1',path.join(c.out,name)]);
 const exportBody={version:ui.project.version,kind:'video',settings:{preset:'hd',fps:24,transparent:false,omitBackground:false,burnSubtitles:false},startMs:0,durationMs:2000},exportPlan=await c.good<ExportPlan>('/studio/projects/'+project.id+'/export-plan',exportBody);
 let queued:StudioExport;if(priorDirectory){const existing=await c.get<StudioExport[]>('/studio/projects/'+project.id+'/exports');assert.equal(existing.length,1);queued=existing[0];}else queued=await c.good<StudioExport>('/studio/projects/'+project.id+'/exports',{...exportBody,planHash:exportPlan.hash,confirmed:true,rightsConfirmed:true});
 const exported=await proofUntil(()=>c.get<StudioExport>('/studio/exports/'+queued.id),v=>['succeeded','failed','cancelled'].includes(v.status),120000);assert.equal(exported.status,'succeeded',exported.errorMessage??'');const artifact=exported.artifacts.find(v=>v.kind==='video')!;assert.ok(artifact);
 const exportUrl='/api/v1/studio/exports/'+exported.id+'/files/'+artifact.id,actualExport=await download(exportUrl,'actual-applied-export.mp4');assert.equal(actualExport.sha256,artifact.sha256);if(priorDirectory)assert.equal(actualExport.sha256,proofHash(path.join(priorDirectory,'actual-applied-export.mp4')));
 const exportProbe=JSON.parse(tool(c.tools.ffprobe,['-v','error','-show_entries','stream=codec_type,codec_name,width,height,sample_rate,channels,nb_frames:format=duration','-of','json',actualExport.file]).toString('utf8'));assert.ok(exportProbe.streams.some((v:{codec_name:string;width:number;height:number})=>v.codec_name==='h264'&&v.width===exportPlan.width&&v.height===exportPlan.height));assert.ok(exportProbe.streams.some((v:{codec_type:string;codec_name:string})=>v.codec_type==='audio'&&v.codec_name==='aac'));
 const pcmFile=path.join(c.out,'actual-applied-export.pcm');tool(c.tools.ffmpeg,['-v','error','-nostdin','-n','-i',actualExport.file,'-vn','-ac','1','-ar','48000','-f','s16le',pcmFile]);const pcm=fs.readFileSync(pcmFile),rms=(startMs:number,endMs:number)=>{let sum=0,n=0;for(let i=Math.round(startMs*48);i<Math.min(Math.round(endMs*48),pcm.length/2);i++){const value=pcm.readInt16LE(i*2)/32768;sum+=value*value;n++;}assert.ok(n>0);return Math.sqrt(sum/n);},earlyRms=rms(100,1000),lateRms=rms(1600,1900);assert.ok(earlyRms>.01);assert.ok(lateRms<.001);
 c.save('actual-media.json',{result:'PASS',motion:{...motion,probe:motionProbe,jobId:ui.applied.id,actualFrames:['actual-motion-1100.png','actual-motion-1600.png']},export:{...actualExport,probe:exportProbe,exportId:exported.id,artifactId:artifact.id,actualAppliedAssetId:ui.applied.outputs[0].assetId},audio:{sourceMs:1200,exportMs:2000,earlyRms,lateRms,plannedSilentTail:true,physicalPlaybackVerified:false},realCloneOrPhonemeClaimed:false});
 c.add('actual_motion_file_applied_asset_native_h264_aac_export_and_planned_audio_interval',{motionSHA256:motion.sha256,exportSHA256:actualExport.sha256,earlyRms,lateRms});
 const viewer=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1000}}),viewerAt=c.viewerCookie.indexOf('=');await viewer.addCookies([{name:c.viewerCookie.slice(0,viewerAt),value:c.viewerCookie.slice(viewerAt+1),url:origin,httpOnly:true,sameSite:'Strict'}]);const viewerPage=await viewer.newPage();await viewerPage.goto('/studio/characters');await expect(viewerPage.getByRole('region',{name:'形象登记',exact:true}).getByRole('button',{name:'保存形象登记',exact:true})).toBeDisabled();await viewerPage.screenshot({path:path.join(c.out,'actual-character-viewer.png'),fullPage:true});await viewer.close();c.add('built_viewer_character_management_remains_read_only');

 // The same compiled private instance continues through interruption and restart.
 await verifyRecoveryAndWithdrawal(ui,actualExport,exportUrl,page,browserErrors);
 assert.deepEqual(browserErrors,[]);
}catch(e){failure=e;c.save('diagnostic-failure.json',{error:e instanceof Error?e.stack:String(e),killed});}
finally{await browser?.close();await c.finish(failure);}

async function verifyRecoveryAndWithdrawal(ui:Awaited<ReturnType<typeof nativeCharacterProductionBrowser>>,actualExport:{sha256:string},exportUrl:string,page:import('@playwright/test').Page,browserErrors:string[]){
 const recoveryProject=await c.good<StudioProject>('/studio/projects',{workspaceId:workspace,name:'同一任务自然租约恢复验证',purpose:'video',document:blankStudioDocument()});
 const body={characterVersion:ui.character.version,operation:'reference',projectId:recoveryProject.id,projectVersion:recoveryProject.version,segmentId:recoveryProject.document.segments[0].id,startMs:0,durationMs:1000,motionPlanId:null,motionPlanVersion:null,confirmed:true};
 killArmed=true;const queued=await c.good<CharacterJob>('/studio/characters/'+ui.character.id+'/render',body);await proofUntil(async()=>killed,v=>!!v,30000);assert.equal(killed!.jobId,queued.id);assert.equal(killed!.attempt,1);assert.equal(killed!.issued,true);await c.stop(worker!,'SIGKILL');
 const before=await c.owner(async db=>(await db.query('SELECT id,status,attempts,input_hash,input_snapshot,created_at,lease_until,lease_token FROM character_jobs WHERE id=$1',[queued.id])).rows[0]);assert.equal(before.status,'rendering');assert.equal(Number(before.attempts),1);assert.ok(Date.now()<Date.parse(before.lease_until));
 const priorLeaseSHA256=hash(Buffer.from(before.lease_token));worker=c.worker('owned-character-recovery-worker');
 const recovered=await proofUntil(()=>c.get<CharacterJob>('/studio/character-jobs/'+queued.id),v=>['succeeded','failed','stale'].includes(v.status),90000);assert.equal(recovered.status,'succeeded',recovered.errorMessage??recovered.staleReason??'');assert.equal(recovered.attempts,2);
 const after=await c.owner(async db=>(await db.query('SELECT j.id,j.attempts,j.input_hash,j.input_snapshot,j.created_at,j.updated_at,o.lease_token FROM character_jobs j JOIN _dg_native_character_outputs o ON o.job_id=j.id WHERE j.id=$1',[queued.id])).rows[0]);for(const field of ['id','input_hash','input_snapshot','created_at'])assert.equal(after[field],before[field]);assert.notEqual(hash(Buffer.from(after.lease_token)),priorLeaseSHA256);assert.ok(Date.parse(after.updated_at)>=Date.parse(before.lease_until));
 const recoveredFile=await download('/api/v1/studio/character-jobs/'+queued.id+'/file','actual-recovered-reference.png');
 c.save('worker-recovery.json',{result:'PASS',jobId:queued.id,kill:killed,originalAttempts:1,finalAttempts:recovered.attempts,originalLeaseUntil:before.lease_until,recoveredAt:after.updated_at,originalInputHash:before.input_hash,finalInputHash:after.input_hash,originalCreatedAt:before.created_at,finalCreatedAt:after.created_at,originalLeaseTokenSHA256:priorLeaseSHA256,newLeaseTokenSHA256:hash(Buffer.from(after.lease_token)),sameTaskAndInput:true,originalLeaseNaturallyExpired:true,manualDeadlineOrCounterChanges:false,recoveredFile});
 c.add('actual_owned_worker_sigkill_same_task_recovers_after_original_natural_lease_without_reset',{jobId:queued.id,attempts:2,originalLeaseUntil:before.lease_until});
 await proofUntil(()=>c.owner(async db=>Number((await db.query('SELECT count(*) AS n FROM _dg_native_character_leases')).rows[0].n)),n=>n===0,30000);
 const beforeRestart=await catalogue(),keys=c.keys.map(v=>({...v}));await c.stop(worker!);
 for(const api of c.running.filter(p=>p.label.startsWith('api')&&p.child.exitCode===null&&p.child.signalCode===null))await c.stop(api);
 await c.cluster.stop();await c.cluster.start();await c.api('api-a-after-character-pg-restart');await c.api('api-b-after-character-pg-restart',c.apiB);worker=c.worker('owned-character-after-pg-restart');
 assert.deepEqual(await catalogue(),beforeRestart);for(const key of keys)assert.equal(proofHash(path.join(c.nativeDir,key.name)),key.sha256);
 const recoveredAgain=await fetch('http://127.0.0.1:'+c.apiA+'/api/v1/studio/character-jobs/'+queued.id+'/file',{headers:c.headers});assert.equal(recoveredAgain.status,200);assert.equal(hash(Buffer.from(await recoveredAgain.arrayBuffer())),recoveredFile.sha256);
 const exportAgain=await fetch('http://127.0.0.1:'+c.apiA+exportUrl,{headers:c.headers});assert.equal(exportAgain.status,200);assert.equal(hash(Buffer.from(await exportAgain.arrayBuffer())),actualExport.sha256);
 c.save('restart-preservation.json',{result:'PASS',samePrivateInstance:true,sameCompiledApplications:true,originalCatalogueRowsExact:true,keysExact:true,recoveredJobId:queued.id,recoveredReferenceSHA256:recoveredFile.sha256,exportSHA256:actualExport.sha256});c.add('actual_api_and_postgres_restart_preserves_character_plans_jobs_results_assets_keys_and_exact_files');
 await page.reload();await expect(page.getByRole('region',{name:'形象动作制作',exact:true})).toBeVisible();
 await c.good('/consents/'+ui.ref.consentId+'/revoke',{});
 const paths=['/api/v1/studio/character-jobs/'+ui.applied.id+'/file','/api/v1/studio/character-jobs/'+queued.id+'/file','/api/v1/assets/'+ui.applied.outputs[0].assetId+'/content',exportUrl],blocked=[];
 for(const url of paths){const response=await fetch('http://127.0.0.1:'+c.apiA+url,{headers:c.headers});assert.ok(response.status>=400&&response.status<500,url);blocked.push({path:url,status:response.status});}
 assert.equal((await c.get<CharacterJob>('/studio/character-jobs/'+queued.id)).status,'stale');assert.equal((await c.get<Character>('/studio/characters/'+ui.character.id)).sourceAvailable,false);
 await page.goto('/studio/characters');const registry=page.getByRole('region',{name:'形象登记',exact:true});await registry.getByRole('combobox',{name:'选择形象',exact:true}).selectOption(ui.character.id);await expect(registry.getByText(/独立形象使用授权已撤回/)).toBeVisible();await registry.screenshot({path:path.join(c.out,'actual-character-withdrawn.png')});
 c.save('source-withdrawal.json',{result:'PASS',consentId:ui.ref.consentId,characterId:ui.character.id,blocked,oldTasksPermanentlyStale:true,previouslyDownloadedCopiesNotRemotelyErased:true,browserErrors});c.add('independent_use_withdrawal_blocks_original_recovered_asset_and_export_media_with_visible_reason');
}
