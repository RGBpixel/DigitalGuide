import {randomUUID} from 'node:crypto';
import type {GuestVisitView,ReceptionHost,InternalVisit,Page} from '@digitalguide/contracts';
import {nativeReceptionHelpers,type NativeGuest} from './postgres-reception-helpers.js';
import type {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
export function nativeVisitHelpers(x:Awaited<ReturnType<typeof nativeRuntimeFixture>>){
 const h=nativeReceptionHelpers(x);
 const view=(g:NativeGuest)=>h.guestGet(g,'/visit');
 async function currentVisit(g:NativeGuest){const r=await view(g);if(r.statusCode!==200)throw new Error(r.payload);return r.json().data as GuestVisitView;}
 async function start(channel:'local'|'mock'='mock',alias='原创受访人甲'){const p=await h.person(),receiver=await h.colleague(p,'editor'),host=await h.good<ReceptionHost>(p,'/reception-hosts',{workspaceId:p.workspace,alias,recipientId:receiver.user,enabled:true}),g=await h.guest(p),input={guestName:'原创虚构访客甲',company:'原创虚构单位',hostName:alias,purpose:'原创虚构业务交流',appointmentRef:'原创演示预约引用',version:null,focusVersion:g.guest.view.session.focusVersion,channel};const draft=await h.goodGuest<GuestVisitView>(g.guest,'/visit',input);return{p,receiver,host,...g,input,draft};}
 async function confirm(g:NativeGuest,v:GuestVisitView,key?:ReturnType<typeof randomUUID>){if(!v.visit||!v.confirmation)throw new Error('Fixture has no confirmation');return h.goodGuest<GuestVisitView>(g,'/visit/confirm',{version:v.visit.version,focusVersion:v.visit.focusVersion,confirmationToken:v.confirmation.token,expiresAt:v.confirmation.expiresAt,noticeVersion:'visit-v1',confirmed:true,channel:v.visit.notificationChannel},key);}
 async function notify(g:NativeGuest,v:GuestVisitView,key?:ReturnType<typeof randomUUID>){return h.goodGuest<GuestVisitView>(g,'/visit/notify',{version:v.visit!.version,focusVersion:v.visit!.focusVersion,channel:v.visit!.notificationChannel},key);}
 async function inbox(p:NativeTestPerson,ownOnly=true){return h.get<Page<InternalVisit>>(p,'/visits'+(ownOnly?'/inbox':'')+'?workspaceId='+p.workspace+'&limit=100');}
 return{...h,view,currentVisit,start,confirm,notify,inbox};
}
