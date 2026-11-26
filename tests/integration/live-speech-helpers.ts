import {randomUUID} from 'node:crypto';
import {expect} from 'vitest';
import type {LiveDefinition,LiveSession,LiveSpeechPlan,LiveSpeechSession,LiveSpeechJob,LiveOutput,LiveOutputPlan,LiveQuestion,SystemVoice} from '@digitalguide/contracts';
import {liveDefinitionFixture} from '../../packages/test-fixtures/src/live.js';
import {runLiveSpeechJob} from '../../apps/worker/src/live-speech.js';
import {shareApi,type ShareHarness} from './share-helpers.js';
import {liveProgram} from './live-helpers.js';
import {outputSettings} from './live-output-helpers.js';
export async function speechSession(h:ShareHarness,d:LiveDefinition=liveDefinitionFixture()){
 const api=shareApi(h),{program,plan}=await liveProgram(h,d),session=await api.good<LiveSession>('/live-sessions',{programId:program.id,programVersion:program.version,planHash:plan.hash,kind:'broadcast_simulation',confirmed:true,rightsConfirmed:true});
 const getSession=async()=>(await api.get('/live-sessions/'+session.id)).json().data as LiveSession,speech=async()=>(await api.get('/live-sessions/'+session.id+'/speech')).json().data as LiveSpeechSession;
 return{api,session,getSession,speech,control:async(action:string,extra:object={})=>{const s=await getSession();return api.good<LiveSession>('/live-sessions/'+s.id+'/control',{version:s.version,epoch:s.epoch,action,...extra,confirmed:true});},job:async(id:string)=>(await api.get('/live-speech-jobs/'+id)).json().data as LiveSpeechJob};
}
export async function speechPlan(h:ShareHarness,p:Awaited<ReturnType<typeof speechSession>>,run=true){
 const cap=(await p.api.get('/live-speech/capabilities?workspaceId='+p.session.workspaceId)).json().data as {available:boolean;voices:SystemVoice[];reason:string|null};expect(cap.available,cap.reason||'').toBe(true);const voice=cap.voices.find(v=>v.locale==='zh-CN')||cap.voices[0],input={sessionVersion:p.session.version,voiceId:voice.id,confirmed:true,rightsConfirmed:true},key=randomUUID(),response=await p.api.post('/live-sessions/'+p.session.id+'/speech-plans',input,h.headers,key);expect(response.statusCode,response.body).toBe(200);const plan=response.json().data as LiveSpeechPlan;if(run)while(await runLiveSpeechJob(h.repo,h.config)){/* Each cue is a persistent job. */}const getPlan=async()=>(await p.api.get('/live-speech-plans/'+plan.id)).json().data as LiveSpeechPlan;return{plan:await getPlan(),getPlan,input,key,voice};
}
export async function speechOutput(p:Awaited<ReturnType<typeof speechSession>>,planId:string){const settings=outputSettings({speechPlanId:planId}),body={sessionId:p.session.id,sessionVersion:p.session.version,settings},plan=await p.api.good<LiveOutputPlan>('/live-outputs/preflight',body);expect(plan.canCreate,plan.problems.join('；')).toBe(true);const output=await p.api.good<LiveOutput>('/live-outputs',{...body,planHash:plan.hash,confirmed:true,rightsConfirmed:true});return output;}
export async function speechQuestion(p:Awaited<ReturnType<typeof speechSession>>,text='已审核的实际语音答复。'){
 const s=await p.getSession();let q=await p.api.good<LiveQuestion>('/live-sessions/'+s.id+'/audience-events',{destinationId:s.destinations[0].id,eventId:randomUUID(),participantRef:randomUUID(),nickname:'原创合成提问者',kind:'question',text:'请介绍本地播音。',synthetic:true});q=await p.api.good('/audience-questions/'+q.id+'/moderate',{version:q.version,decision:'queue',confirmed:true});return p.api.good<LiveQuestion>('/audience-questions/'+q.id+'/answer',{version:q.version,kind:'manual',text,confirmed:true});
}
export async function speechReply(h:ShareHarness,p:Awaited<ReturnType<typeof speechSession>>,planId:string,kind:'answer'|'manual',value:string|LiveQuestion){const s=await p.getSession(),j=await p.api.good<LiveSpeechJob>('/live-sessions/'+s.id+'/speech-jobs',{planId,sessionVersion:s.version,epoch:s.epoch,kind,...(typeof value==='string'?{text:value}:{questionId:value.id,questionVersion:value.version}),confirmed:true});await runLiveSpeechJob(h.repo,h.config);const ready=await p.job(j.id);expect(ready.status,ready.errorMessage||'').toBe('succeeded');return ready;}
export async function playSpeech(p:Awaited<ReturnType<typeof speechSession>>,j:LiveSpeechJob){const s=await p.getSession();return p.api.good<LiveSession>('/live-speech-jobs/'+j.id+'/play',{sessionVersion:s.version,epoch:s.epoch,jobVersion:j.version,confirmed:true});}
