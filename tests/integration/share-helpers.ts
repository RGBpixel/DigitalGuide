import {expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {StudioProject,StudioExport,StudioReview,DistributionVariant,DistributionReview,ShareDraft,ShareRelease,ShareIssued,SharePlayer,ShareDefinition} from '@digitalguide/contracts';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {shareVideoDocument,shareDefinitionFixture} from '../../packages/test-fixtures/src/shares.js';
import {runStudioExport} from '../../apps/worker/src/studio-exports.js';
import {harness} from './helpers.js';
export type ShareHarness=Awaited<ReturnType<typeof harness>>;
export function shareApi(h:ShareHarness){
 const post=(url:string,body:object,headers=h.headers,key:string=randomUUID())=>h.app.inject({method:'POST',url:'/api/v1'+url,payload:body,headers:{...headers,origin:h.config.webOrigin,'idempotency-key':key}});
 const get=(url:string,headers=h.headers)=>h.app.inject({url:'/api/v1'+url,headers});
 const good=async<T>(url:string,body:object,headers=h.headers)=>{const r=await post(url,body,headers);expect(r.statusCode,r.body).toBe(200);return r.json().data as T;};
 return{post,get,good};
}
export async function shareSource(h:ShareHarness){
 const {good,get}=shareApi(h),reviewer=await h.login(f.reviewerA),project=await good<StudioProject>('/studio/projects',{workspaceId:f.workspaceA,name:'原创互动分享底片',purpose:'video',document:shareVideoDocument()}),input={version:project.version,kind:'video',settings:{preset:'hd',fps:24,transparent:false,omitBackground:false,burnSubtitles:true},startMs:0,durationMs:6000};
 const plan=await good<{hash:string}>('/studio/projects/'+project.id+'/export-plan',input),queued=await good<StudioExport>('/studio/projects/'+project.id+'/exports',{...input,planHash:plan.hash,confirmed:true,rightsConfirmed:true});await runStudioExport(h.repo,h.config);
 const output=(await get('/studio/exports/'+queued.id)).json().data as StudioExport;expect(output.status,output.errorMessage||'').toBe('succeeded');
 const delivery=await good<StudioReview>('/studio/projects/'+project.id+'/reviews',{version:1,stage:'delivery',exportId:output.id,reviewerId:f.reviewerA,confirmed:true});await good('/studio/reviews/'+delivery.id+'/decision',{version:delivery.version,decision:'approve',confirmed:true,note:'原创合成素材，本地分享验证'},reviewer);
 let variant=await good<DistributionVariant>('/distribution/variants',{workspaceId:f.workspaceA,exportId:output.id,platform:'custom',title:'原创数字人视频 · 互动分享示例',description:'原创合成底片，用于本地互动与嵌入验证。',tags:['原创'],coverAssetId:f.avatarA,aiDisclosure:'AI辅助制作 · 原创合成示例，非真人克隆',rightsConfirmed:true});
 const review=await good<DistributionReview>('/distribution/variants/'+variant.id+'/reviews',{version:variant.version,reviewerId:f.reviewerA,confirmed:true});await good('/distribution/reviews/'+review.id+'/decision',{version:review.version,decision:'approve',confirmed:true,note:'批准用于本地私域组件验证'},reviewer);
 variant=(await get('/distribution/variants/'+variant.id)).json().data as DistributionVariant;expect(variant.approved).toBe(true);return{project,output,variant,reviewer};
}
export async function sharePublished(h:ShareHarness,definition:ShareDefinition=shareDefinitionFixture()){
 const source=await shareSource(h),{good}=shareApi(h),draft=await good<ShareDraft>('/shares',{workspaceId:f.workspaceA,name:'内部分享草稿名不得对外暴露',variantId:source.variant.id,definition}),release=await good<ShareRelease>('/shares/'+draft.id+'/publish',{version:draft.version,planHash:draft.plan.hash,confirmed:true,rightsConfirmed:true});return{...source,draft,release};
}
export function shareInvite(h:ShareHarness,r:ShareRelease,values:object={}){return shareApi(h).good<ShareIssued>('/share-releases/'+r.id+'/links',{version:r.version,title:'内部邀请名称不公开',access:'unlisted',expiresAt:new Date(Date.now()+86400000).toISOString(),embedOrigins:[],recordingEnabled:true,retentionDays:7,confirmed:true,...values});}
export async function shareJoinViewer(h:ShareHarness,issued:ShareIssued){
 const {post,get}=shareApi(h),base='/external/shares/'+issued.link.id,access=new URL(issued.url).hash.slice('#access='.length),joined=await post(base+'/join',issued.link.access==='unlisted'?{access}:{},{} as ShareHarness['headers']);expect(joined.statusCode,joined.body).toBe(200);
 const cookie=joined.headers['set-cookie']!.toString().split(';')[0],context=(await get(base+'/context',{cookie} as ShareHarness['headers'])).json().data as SharePlayer;
 return{base,headers:{cookie,'x-csrf-token':context.state.csrfToken},context,access};
}
