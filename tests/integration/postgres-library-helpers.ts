import {randomUUID} from 'node:crypto';
import {expect} from 'vitest';
import {syntheticPng,syntheticToneWav} from '@digitalguide/media';
import type {Asset,StudioClone} from '@digitalguide/contracts';
import type {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
export interface NativeTestPerson {tenant:string;workspace:string;privateWorkspace:string;user:string;headers:{cookie:string;'x-csrf-token':string}}
export function nativeLibraryHelpers(x:Awaited<ReturnType<typeof nativeRuntimeFixture>>){
 async function person(){const p={tenant:randomUUID(),workspace:randomUUID(),privateWorkspace:randomUUID(),user:randomUUID()};await x.owner(async c=>{await c.query('INSERT INTO tenants(id,name) VALUES($1,$2)',[p.tenant,'虚构素材库组织']);for(const w of [p.workspace,p.privateWorkspace])await c.query('INSERT INTO workspaces VALUES($1,$2,$3)',[w,p.tenant,'虚构制作空间']);await c.query('INSERT INTO users VALUES($1,$2)',[p.user,'虚构素材管理员']);await c.query('INSERT INTO memberships VALUES($1,$2,$3,$4)',[p.user,p.tenant,'admin',JSON.stringify([p.workspace,p.privateWorkspace])]);});return{...p,headers:await x.login(p.user)};}
 function post(p:NativeTestPerson,url:string,payload:object,key=randomUUID(),app=x.app){return app.inject({method:'POST',url:'/api/v1'+url,headers:{...p.headers,'idempotency-key':key},payload});}
 async function good<T>(p:NativeTestPerson,url:string,payload:object,key=randomUUID(),app=x.app){const r=await post(p,url,payload,key,app);expect(r.statusCode,r.payload).toBeLessThan(300);return r.json().data as T;}
 async function get<T>(p:NativeTestPerson,url:string,app=x.app){const r=await app.inject({url:'/api/v1'+url,headers:p.headers});expect(r.statusCode,r.payload).toBe(200);return r.json().data as T;}
 async function asset(p:NativeTestPerson,kind:'avatar'|'voice'='avatar',workspace=p.workspace,color:[number,number,number]=[12,120,72]){const buffer=kind==='avatar'?syntheticPng(color):syntheticToneWav(250),u=await good<{uploadId:string}>(p,'/assets/uploads',{workspaceId:workspace,fileName:'原创合成参考',contentBase64:buffer.toString('base64')}),a=await good<Asset>(p,'/assets',{uploadId:u.uploadId,name:'原创合成文件',category:kind});return{...a,uploadId:u.uploadId,buffer};}
 async function consent(p:NativeTestPerson,assetId:string,purpose='train_avatar',expiresAt=new Date(Date.now()+3600_000).toISOString()){return good<{id:string}>(p,'/assets/'+assetId+'/consents',{purpose,subject:'虚构授权人',proof:'仅供开发验证的虚构专项证明',noticeVersion:'local-v1',expiresAt});}
 async function clone(p:NativeTestPerson,kind:'avatar'|'voice'='avatar',simulate='success',expiresAt?:string){const a=await asset(p,kind),c=await consent(p,a.id,'train_'+kind,expiresAt);const clone=await good<StudioClone>(p,'/studio/clones',{workspaceId:p.workspace,name:'明确模拟参考',kind,assetId:a.id,consentId:c.id,simulate});return{asset:a,consent:c,clone};}
 async function cancelQueuedFixtures(){await x.owner(c=>c.query("UPDATE jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=dg_utc_now() WHERE status IN ('queued','retrying')"));}
 return{person,post,good,get,asset,consent,clone,cancelQueuedFixtures};
}
