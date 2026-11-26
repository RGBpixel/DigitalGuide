import {expect} from 'vitest';
import type {LiveDefinition,LiveSession,LiveOutput,LiveOutputSettings,LiveOutputPlan} from '@digitalguide/contracts';
import {liveOutputSettings} from '@digitalguide/contracts';
import {shareApi,type ShareHarness} from './share-helpers.js';
import {liveProgram} from './live-helpers.js';
import {liveDefinitionFixture} from '../../packages/test-fixtures/src/live.js';
export const outputSettings=(extra:Partial<LiveOutputSettings>={}):LiveOutputSettings=>liveOutputSettings.parse({schemaVersion:1,presentation:{title:'原创连续节目',caption:'本地实际合流验证'},...extra});
export async function prepareOutput(h:ShareHarness,d:LiveDefinition=liveDefinitionFixture(),settings=outputSettings()){
 const api=shareApi(h),{program,plan}=await liveProgram(h,d),session=await api.good<LiveSession>('/live-sessions',{programId:program.id,programVersion:program.version,planHash:plan.hash,kind:'broadcast_simulation',confirmed:true,rightsConfirmed:true}),input={sessionId:session.id,sessionVersion:session.version,settings},mediaPlan=await api.good<LiveOutputPlan>('/live-outputs/preflight',input);expect(mediaPlan.canCreate,mediaPlan.problems.join('；')).toBe(true);const output=await api.good<LiveOutput>('/live-outputs',{...input,planHash:mediaPlan.hash,confirmed:true,rightsConfirmed:true});return{session,output,program,mediaPlan,settings};
}
export async function startOutput(h:ShareHarness,session:LiveSession){return shareApi(h).good<LiveSession>('/live-sessions/'+session.id+'/start',{version:session.version,planHash:session.snapshotHash,confirmed:true});}
export async function waitOutput<T>(read:()=>T|Promise<T>,condition:(value:T)=>boolean,timeout=20000){const until=Date.now()+timeout;let last:T;do{last=await read();if(condition(last))return last;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<until);throw new Error('连续媒体等待超时：'+JSON.stringify(last!));}
