import {randomUUID} from 'node:crypto';
import type {OfficeRelay,OfficeNotification,CalendarEvent} from '@digitalguide/contracts';
import {NativeOfficeWorker} from '../../packages/postgres/src/runtime-office-worker.js';
import {nativeLibraryHelpers,type NativeTestPerson} from './postgres-library-helpers.js';
import type {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
export function nativeOfficeHelpers(x:Awaited<ReturnType<typeof nativeRuntimeFixture>>){
 const h=nativeLibraryHelpers(x),worker=new NativeOfficeWorker(x.repo);
 async function colleague(p:NativeTestPerson,role:'admin'|'editor'|'reviewer'|'viewer'='viewer',workspace=p.workspace){const user=randomUUID();await x.owner(async c=>{await c.query('INSERT INTO users VALUES($1,$2)',[user,'虚构同事'+role]);await c.query('INSERT INTO memberships VALUES($1,$2,$3,$4)',[user,p.tenant,role,JSON.stringify([workspace])]);});return{...p,user,headers:await x.login(user)};}
 const getRelay=(p:NativeTestPerson,id:string)=>h.get<OfficeRelay>(p,'/office/relays/'+id),getEvent=(p:NativeTestPerson,id:string)=>h.get<CalendarEvent>(p,'/office/calendar/'+id);
 async function relay(p:NativeTestPerson,to:NativeTestPerson,extra:object={}){const input={workspaceId:p.workspace,recipientId:to.user,subject:'原创虚构私密口信',body:'原创虚构机密正文，仅供本人查看。',confidentiality:'private',channel:'local',scheduledAt:null,expiresAt:new Date(Date.now()+60_000).toISOString(),...extra},meta=await h.good<{id:string;version:number;status:string}>(p,'/office/relays',input);return{input,meta,row:await getRelay(p,meta.id)};}
 async function confirm(p:NativeTestPerson,id:string,version=1){return h.good<{id:string;version:number;status:string}>(p,'/office/relays/'+id+'/send',{version,confirmed:true});}
 async function inbox(p:NativeTestPerson){return(await h.get<{items:OfficeNotification[]}>(p,'/office/inbox?workspaceId='+p.workspace+'&limit=100')).items;}
 async function event(p:NativeTestPerson,attendees:NativeTestPerson[],extra:object={}){const input={workspaceId:p.workspace,title:'原创虚构内部会议',description:'只向受邀同事提供的虚构说明。',location:'虚构一号会议室',startsAt:new Date(Date.now()+90_000).toISOString(),endsAt:new Date(Date.now()+180_000).toISOString(),timezone:'Asia/Shanghai',attendeeIds:attendees.map(a=>a.user),reminderMinutes:0,channel:'local',confirmed:true,...extra},meta=await h.good<{id:string;version:number;status:string}>(p,'/office/calendar',input);return{input,meta,row:await getEvent(p,meta.id)};}
 async function drain(max=30){let n=0;while(n<max&&await worker.runOne())n++;return n;}
 return{...h,colleague,relay,confirm,inbox,event,getRelay,getEvent,drain,worker};
}
