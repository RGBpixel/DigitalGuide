import {randomUUID} from 'node:crypto';
import {expect} from 'vitest';
import type {Asset,Character,LiveDefinition,LiveOutput,LiveOutputPlan,LivePuppetSettings,PuppetConfiguration} from '@digitalguide/contracts';
import {nativeLiveSpeechHelpers} from './postgres-live-speech-helpers.js';
import type {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
export const nativePuppetConfiguration:PuppetConfiguration={format:'digitalguide-puppet',version:1,outfit:'suit',pose:'standing',bodyColor:'#246158',accentColor:'#D7AE58',faceColor:'#E2C4A8'};
export interface NativeCharacterSourceRef{assetId:string;consentId:string;asset:Asset;consent:{expiresAt:string;revokedAt:string|null};usable:boolean}
export function nativePuppetHelpers(x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,person:()=>NativeTestPerson){
 const s=nativeLiveSpeechHelpers(x,person),a=s.a;
 async function source(kind:'puppet2d'|'mannequin3d'='puppet2d',expiresAt=new Date(Date.now()+3600000).toISOString(),configuration=nativePuppetConfiguration){const input={workspaceId:person().workspace,name:'原创原生参数来源',kind,configuration,rights:{subject:'原创虚构角色',proof:'仅供本机开发验证的原创角色专项使用证明',expiresAt,confirmed:true}},key=randomUUID(),ref=await a.good<NativeCharacterSourceRef>('/studio/characters/factory',input,person(),key);return{ref,input,key};}
 async function character(kind:'puppet2d'|'mannequin3d'='puppet2d',expiresAt?:string){const created=await source(kind,expiresAt),ref=created.ref,input={workspaceId:person().workspace,name:'原创原生讲解员',kind:kind==='puppet2d'?'illustration2d':'model3d',visualStyle:'cartoon',sourceAssetId:ref.assetId,sourceVersion:ref.asset.version,consentId:ref.consentId,parentId:null,costumeLabel:'原创服装',poseLabel:'站姿',expiresAt:ref.consent.expiresAt,note:'虚构参数角色；不代表真人克隆。'},value=await a.good<Character>('/studio/characters',input);return{...created,character:value,characterInput:input};}
 async function prepare(options:{recording?:boolean;placement?:LivePuppetSettings['placement'];character?:Awaited<ReturnType<typeof character>>;definition?:LiveDefinition}={}){const c=options.character??await character(),r=await s.ready(options.definition??s.definition(options.recording??false)),prepared=await s.plan(r.session),settings=a.settings({speechPlanId:prepared.plan.id,puppet:{characterId:c.character.id,characterVersion:c.character.version,placement:options.placement??'left'}}),input={sessionId:r.session.id,sessionVersion:r.session.version,settings},plan=await a.good<LiveOutputPlan>('/live-outputs/preflight',input);expect(plan.canCreate,plan.problems.join('；')).toBe(true);const create={...input,planHash:plan.hash,confirmed:true,rightsConfirmed:true},key=randomUUID(),output=await a.good<LiveOutput>('/live-outputs',create,person(),key);return{...c,...r,characterFixture:c,plan:prepared.plan,settings,input,output,create,key};}
 return{s,a,source,character,prepare,cleanup:s.cleanup};
}
