import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect} from 'vitest';
import {blankStudioDocument,type StudioProject,type StudioExport,type ExportPlan,type PresentationPlan,type PresentationSession,type PresentationAnswerJob} from '@digitalguide/contracts';
import {compileSpeech} from '@digitalguide/domain';
import {NativeMediaWorker} from '../../packages/postgres/src/runtime-media-worker.js';
import {inspectSystemWav} from '../../packages/providers/src/system-speech.js';
import {composedContractResult} from './presentation-composition-fixture.js';
import type {synthesizeSystemSpeech} from '../../packages/providers/src/system-speech.js';
import type {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import type {nativeLibraryHelpers,NativeTestPerson} from './postgres-library-helpers.js';

export const answerBase='/studio/presentations',answerQuestion='周一可以来吗？入场多少钱？';
export async function nativeAnswerSource(x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,h:ReturnType<typeof nativeLibraryHelpers>,p:NativeTestPerson){
 const voice=await h.asset(p,'voice'),doc=blankStudioDocument();doc.canvas={width:640,height:360,fps:24,transparent:false};doc.speakers[0].voiceAssetId=voice.id;const page=doc.segments[0];page.durationMs=1000;page.title='展厅预约';page.text='数字展厅每周二至周日9:00—17:00开放，周一闭馆。团队需提前两天预约，入场免费。';page.elements=[];page.backgroundColor='#204060';doc.segments.push({...structuredClone(page),id:randomUUID(),title:'课程人数',text:'每班课程最多12人，每节45分钟，不提供证书。'});
 const original=await h.good<StudioProject>(p,'/studio/projects',{workspaceId:p.workspace,name:'虚构原生答疑原稿',purpose:'presentation',document:doc}),plan=await h.good<PresentationPlan>(p,answerBase+'/plans',{projectId:original.id,projectVersion:1,name:'固定答疑逐页方案',confirmed:true}),project=await h.good<StudioProject>(p,answerBase+'/plans/'+plan.id+'/apply',{version:1,name:'原生答疑完整MP4工程',confirmed:true,newProjectConfirmed:true,rebuildTimelineConfirmed:true});
 const input={version:project.version,kind:'video' as const,settings:{preset:'hd' as const,fps:24 as const,transparent:false,omitBackground:false,burnSubtitles:true},startMs:0,durationMs:null},review=await h.good<ExportPlan>(p,'/studio/projects/'+project.id+'/export-plan',input),queued=await h.good<StudioExport>(p,'/studio/projects/'+project.id+'/exports',{...input,planHash:review.hash,confirmed:true,rightsConfirmed:true});await new NativeMediaWorker(x.repo).runOne();const output=await h.get<StudioExport>(p,'/studio/exports/'+queued.id);expect(output.status,output.errorMessage??'').toBe('succeeded');const artifact=output.artifacts.find(a=>a.kind==='video')!;
 return{original,project,output,artifact,body:{projectId:project.id,projectVersion:project.version,exportId:output.id,artifactId:artifact.id,name:'原生本机答疑场次',confirmed:true}};
}
export async function nativeAnswerMember(x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,p:NativeTestPerson,role:'admin'|'editor'|'viewer'='viewer',workspaceIds=[p.workspace]){const user=randomUUID();await x.owner(async c=>{await c.query('INSERT INTO users VALUES($1,$2)',[user,'虚构答疑成员']);await c.query('INSERT INTO memberships VALUES($1,$2,$3,$4)',[user,p.tenant,role,JSON.stringify(workspaceIds)]);});return{...p,user,headers:await x.login(user)};}
// These are contract-only audio/model fixtures, not SAPI/model quality evidence.
export const nativeAnswerContractEngines={answer:async(...args:Parameters<typeof import('../../packages/providers/src/run-presentation-answer.js').runPresentationAnswer>)=>composedContractResult(args[0]),speech:(async input=>{
 const rate=22050,samples=rate,pcm=Buffer.alloc(samples*2);for(let i=0;i<samples;i++)pcm.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*330*i/rate)),i*2);const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);const bytes=Buffer.concat([header,pcm]),audioFile=path.join(input.workDir,randomUUID()+'.wav');await fs.promises.writeFile(audioFile,bytes,{flag:'wx'});const {pcm:discard,...format}=inspectSystemWav(bytes);void discard;
 return{audioFile,format,voice:{id:input.voiceId,name:'契约测试系统声音',locale:input.speech.locale},provider:'windows-sapi' as const,clonedVoice:false as const,referenceStyleTransferred:false as const,compilation:compileSpeech(input.speech)};
 }) as typeof synthesizeSystemSpeech};
export type NativeAnswerFixtureSource=Awaited<ReturnType<typeof nativeAnswerSource>>;
export type NativeAnswerCase={p:NativeTestPerson;session:PresentationSession;job:PresentationAnswerJob;questionBody:{version:number;observedPageId:string;body:string;confirmed:true}};
