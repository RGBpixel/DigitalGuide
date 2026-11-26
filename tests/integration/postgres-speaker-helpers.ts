import {randomUUID} from 'node:crypto';
import type {SceneApp,SpeakerFocusView,GuestVisitView,ReceptionHost} from '@digitalguide/contracts';
import type {NativeTestPerson} from './postgres-library-helpers.js';
import type {NativeGuest} from './postgres-reception-helpers.js';
import type {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeVisitHelpers} from './postgres-visit-helpers.js';
export function nativeSpeakerHelpers(x:Awaited<ReturnType<typeof nativeRuntimeFixture>>){
 const h=nativeVisitHelpers(x);
 async function focusGuest(p:NativeTestPerson,provider:'mock-focus-final'|'mock-focus-early'|'external-focus'='mock-focus-final'){
  const source=await h.profile(p),made=await h.good<{id:string}>(p,'/scene-apps',{workspaceId:p.workspace,profileId:source.profile.id,name:'原创专注接待应用',scene:'reception',channelKey:'focus-'+randomUUID().slice(0,8),audience:'public',welcomeText:'欢迎来到原创声音参考测试区。',tools:['knowledge.search'],speakerProvider:provider,targetSpeechProvider:provider==='external-focus'?'external-target-speech':'mock-target-speech'}),scene=await h.get<SceneApp>(p,'/scene-apps/'+made.id),g=await h.guest(p,{sceneAppId:scene.id});return{...g,source,scene};
 }
 async function focus(g:NativeGuest){const r=await h.guestGet(g,'/speaker-focus');if(r.statusCode!==200)throw new Error(r.payload);return r.json().data as SpeakerFocusView;}
 async function focusInput(g:NativeGuest,extra:object={}){const s=(await h.current(g)).session;return{version:s.version,focusVersion:s.focusVersion,...extra};}
 const startInput=(g:NativeGuest)=>focusInput(g,{mode:'temporary',sameVisitorConfirmed:true,consent:true,noticeVersion:'speaker-v1'});
 async function focusOp(g:NativeGuest,action:string,input:object={}){return h.goodGuest<SpeakerFocusView>(g,'/speaker-focus'+(action?'/'+action:''),await focusInput(g,input));}
 async function visit(g:NativeGuest,p:NativeTestPerson){const recipient=await h.colleague(p,'editor'),alias='原创受访-'+randomUUID().slice(0,8),host=await h.good<ReceptionHost>(p,'/reception-hosts',{workspaceId:p.workspace,alias,recipientId:recipient.user,enabled:true}),s=(await h.current(g)).session,draft=await h.goodGuest<GuestVisitView>(g,'/visit',{guestName:'原创临时参考访客',company:'原创虚构单位',hostName:alias,purpose:'原创参考与业务一致性',appointmentRef:'',version:null,focusVersion:s.focusVersion,channel:'local'});return{host,recipient,draft};}
 return{...h,focusGuest,focus,focusInput,startInput,focusOp,visit};
}
