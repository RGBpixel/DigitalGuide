import {approveShareFixtureGovernance} from './share-governance-fixture.js';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import type {StudioProject,StudioExport,StudioReview,DistributionVariant,DistributionReview,ShareDraft,ShareRelease,ShareIssued} from '@digitalguide/contracts';
import {fixtureIds as f} from '../packages/test-fixtures/src/seed.js';
import {shareVideoDocument,shareDefinitionFixture} from '../packages/test-fixtures/src/shares.js';
export interface ShareFixtureApi{post:<T>(step:string,url:string,body:object)=>Promise<T>;reviewerPost:<T>(step:string,url:string,body:object)=>Promise<T>;get:<T>(url:string)=>Promise<T>}
export async function makeShareFixture(api:ShareFixtureApi,embedOrigins:string[]=[]){
 const {post,reviewerPost,get}=api,project=await post<StudioProject>('project','/studio/projects',{workspaceId:f.workspaceA,name:'原创互动视频 · 私域分享演示',purpose:'video',document:shareVideoDocument()}),input={version:project.version,kind:'video',settings:{preset:'hd',fps:24,transparent:false,omitBackground:false,burnSubtitles:true},startMs:0,durationMs:6000};
 const plan=await post<{hash:string}>('video-plan','/studio/projects/'+project.id+'/export-plan',input),queued=await post<StudioExport>('video-export','/studio/projects/'+project.id+'/exports',{...input,planHash:plan.hash,confirmed:true,rightsConfirmed:true});let output=queued;const end=Date.now()+120000;
 while(output.status!=='succeeded'&&Date.now()<end){assert.ok(!['failed','cancelled'].includes(output.status),output.errorMessage||output.status);await delay(250);output=await get<StudioExport>('/studio/exports/'+output.id);}assert.equal(output.status,'succeeded');
 const delivery=await post<StudioReview>('delivery-review','/studio/projects/'+project.id+'/reviews',{version:project.version,stage:'delivery',exportId:output.id,reviewerId:f.reviewerA,confirmed:true});
 await reviewerPost('delivery-decision','/studio/reviews/'+delivery.id+'/decision',{version:1,decision:'approve',confirmed:true,note:'原创合成素材，独立开发账号仅批准本地演示。'});
 const variant=await post<DistributionVariant>('variant','/distribution/variants',{workspaceId:f.workspaceA,exportId:output.id,platform:'custom',title:'从视频到互动 · DigitalGuide',description:'这是原创合成的本地演示：选择章节、跳转热点，或挑选你想了解的内容。没有连接真实发布渠道。',tags:['原创','互动演示'],coverAssetId:f.avatarA,aiDisclosure:'AI辅助制作 · 原创合成素材，非真人克隆',rightsConfirmed:true});
 const review=await post<DistributionReview>('variant-review','/distribution/variants/'+variant.id+'/reviews',{version:1,reviewerId:f.reviewerA,confirmed:true});await reviewerPost('variant-decision','/distribution/reviews/'+review.id+'/decision',{version:1,decision:'approve',confirmed:true,note:'本地自定义传播版本；无真实发布或观众数据。'});
 await approveShareFixtureGovernance(api,variant);
 const draft=await post<ShareDraft>('draft','/shares',{workspaceId:f.workspaceA,name:'互动视频与私域嵌入 · 原创演示',variantId:variant.id,definition:shareDefinitionFixture()}),release=await post<ShareRelease>('release','/shares/'+draft.id+'/publish',{version:draft.version,planHash:draft.plan.hash,confirmed:true,rightsConfirmed:true}),issued=await post<ShareIssued>('link','/share-releases/'+release.id+'/links',{version:1,title:'本地演示观看',access:'unlisted',expiresAt:new Date(Date.now()+29*86400000).toISOString(),embedOrigins,recordingEnabled:true,retentionDays:7,confirmed:true});
 return{project,output,variant,draft,release,issued};
}
