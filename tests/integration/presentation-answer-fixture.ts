import {randomUUID} from 'node:crypto';
import {blankStudioDocument,type StudioProject,type PresentationPlan,type PresentationSession,type StudioExport,type ExportPlan,type PresentationAnswerJob} from '@digitalguide/contracts';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {runStudioExport} from '../../apps/worker/src/studio-exports.js';
import {shareApi} from './share-helpers.js';
import type {harness} from './helpers.js';
export async function presentationAnswerFixture(h:Awaited<ReturnType<typeof harness>>){
 const api=shareApi(h),doc=blankStudioDocument();doc.canvas={width:1280,height:720,fps:24,transparent:false};doc.speakers[0].avatarAssetId=f.avatarA;doc.speakers[0].voiceAssetId=f.voiceA;doc.segments[0].durationMs=1000;doc.segments[0].title='展厅预约';doc.segments[0].text='数字展厅每周二至周日9:00—17:00开放，周一闭馆。团队需提前两天预约，入场免费。';doc.segments[0].elements=[];
 doc.segments.push({...structuredClone(doc.segments[0]),id:randomUUID(),title:'课程人数',text:'每班课程最多12人，每节45分钟，不提供证书。'});
 const original=await api.good<StudioProject>('/studio/projects',{workspaceId:f.workspaceA,name:'虚构PPT自动答疑',purpose:'presentation',document:doc}),plan=await api.good<PresentationPlan>('/studio/presentations/plans',{projectId:original.id,projectVersion:1,name:'逐页答疑原稿',confirmed:true}),project=await api.good<StudioProject>('/studio/presentations/plans/'+plan.id+'/apply',{version:plan.version,name:'答疑固定讲解工程',confirmed:true,newProjectConfirmed:true,rebuildTimelineConfirmed:true}),settings={preset:'hd',fps:24,transparent:false,omitBackground:false,burnSubtitles:true},review=await api.good<ExportPlan>('/studio/projects/'+project.id+'/export-plan',{version:1,kind:'video',settings,startMs:0,durationMs:null}),output=await api.good<StudioExport>('/studio/projects/'+project.id+'/exports',{version:1,kind:'video',settings,startMs:0,durationMs:null,planHash:review.hash,confirmed:true,rightsConfirmed:true});await runStudioExport(h.repo,h.config);
 const completed=(await api.get('/studio/exports/'+output.id)).json().data as StudioExport;if(completed.status!=='succeeded')throw new Error(JSON.stringify(completed));const artifact=completed.artifacts.find(a=>a.kind==='video')!,session=await api.good<PresentationSession>('/studio/presentations/sessions',{projectId:project.id,projectVersion:1,exportId:output.id,artifactId:artifact.id,name:'原断点自动答疑场次',confirmed:true});
 const getSession=async()=>(await api.get('/studio/presentations/sessions/'+session.id)).json().data as PresentationSession;
 const jobs=async()=>(await api.get('/studio/presentations/sessions/'+session.id+'/answers')).json().data as PresentationAnswerJob[];
 return{api,original,project,session,getSession,jobs};
}
