import {expect} from 'vitest';
import type {PracticeDefinition,PracticeScenario,PracticeRelease,PracticeRun} from '@digitalguide/contracts';
import {practicePreset} from '@digitalguide/contracts';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {shareApi,type ShareHarness} from './share-helpers.js';
export async function practiceSetup(h:ShareHarness,preset:PracticeDefinition['preset']='reception'){
 const api=shareApi(h),profile=await api.post('/profiles',{workspaceId:f.workspaceA,name:'原创虚构训练角色',avatarAssetId:f.avatarA,voiceAssetId:f.voiceA,scenes:['learning','reception','live']});expect(profile.statusCode,profile.body).toBe(201);
 const definition=practicePreset(preset,profile.json().data.id),scenario=await api.good<PracticeScenario>('/practice/scenarios',{workspaceId:f.workspaceA,name:'原创训练方案',definition}),plan=await api.good<{hash:string;canPublish:boolean}>('/practice/scenarios/'+scenario.id+'/publish-plan',{version:scenario.version});expect(plan.canPublish).toBe(true);const release=await api.good<PracticeRelease>('/practice/scenarios/'+scenario.id+'/publish',{version:scenario.version,planHash:plan.hash,confirmed:true});return{...api,definition,scenario,release,profileId:profile.json().data.id as string};
}
export async function practiceStart(h:ShareHarness,release:PracticeRelease,headers:ShareHarness['headers'],shared=false){return shareApi(h).good<PracticeRun>('/practice/releases/'+release.id+'/runs',{sharedFeedback:shared,simulationAcknowledged:true,retentionAcknowledged:true,confirmed:true},headers);}
export function practiceReply(run:PracticeRun,body='请问您拜访哪位同事？'){return{version:run.version,observedQuestionId:run.currentQuestion!.id,body,confirmed:true};}
export function practiceNext(run:PracticeRun){return{version:run.version,observedQuestionId:run.currentQuestion!.id,turnId:run.turns.at(-1)!.id,confirmed:true};}
