import {expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {ContentSource,ContentBrief,ContentWritingEngine,ContentWritingJob} from '@digitalguide/contracts';
import {ContentWriting} from '../../apps/api/src/content-writing.js';
import * as native from '../../packages/providers/src/run-content-writing.js';
import {contentWritingHash} from '../../packages/domain/src/content-writing-model.js';
import {writingText,writingBrief,writingContractResult} from '../../packages/test-fixtures/src/content-writing.js';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {shareApi,type ShareHarness} from './share-helpers.js';
import {contentWritingModel} from '../../packages/providers/src/content-writing-model.js';
export async function writingFixture(h:ShareHarness,policy:ContentWritingEngine['policy']='source-script-variants-v1'){const original=shareApi(h),api={...original,good:async<T>(url:string,body:object,headers=h.headers,key=randomUUID()):Promise<T>=>{const r=await original.post(url,body,headers,key);expect(r.statusCode,r.body).toBe(200);return r.json().data;}},source=await api.good<ContentSource>('/studio/content/sources',{workspaceId:f.workspaceA,name:'原创资料脚本源',kind:'text',text:writingText,rights:{subject:'原创虚构作者',proof:'原创合成资料用于本机脚本测试',expiresAt:'2099-01-01T00:00:00.000Z',confirmed:true}}),brief=await api.good<ContentBrief>('/studio/content/briefs',{workspaceId:f.workspaceA,...writingBrief}),engine=(await contentWritingModel(h.config.root,false,policy)).writingEngine as ContentWritingEngine,cap={available:true,engine,engineHash:contentWritingHash(engine),reason:null,notice:'契约测试能力；实际模型质量另做真实推理验证。'};vi.spyOn(ContentWriting.prototype,'capabilities').mockResolvedValue(cap);const input={workspaceId:f.workspaceA,name:'资料口播测试',sources:[{id:source.id,version:1}],briefId:brief.id,briefVersion:1,topic:writingBrief.topics[0],instruction:'保留条件和否定，给出不同开场。',variantCount:2,targetDurationMs:30000,language:'zh-CN',engineHash:cap.engineHash,confirmed:true},create=(body:object=input)=>api.good<ContentWritingJob>('/studio/content/writing/jobs',body),job=async(id:string)=>(await api.get('/studio/content/writing/jobs/'+id)).json().data as ContentWritingJob;return{api,source,brief,input,cap,create,job};}
export function contractWriting(){return vi.spyOn(native,'runContentWriting').mockImplementation(async(input,_signal,progress)=>{progress(.4);return writingContractResult(input.request,input.engine);});}
export function expectNoNativeClaim(h:ShareHarness){expect(h.repo.all('SELECT * FROM native_model_leases')).toEqual([]);}
