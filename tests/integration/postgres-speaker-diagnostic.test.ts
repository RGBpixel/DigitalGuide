import {describe,it,expect} from 'vitest';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {NativeReception} from '../../packages/postgres/src/runtime-reception.js';
import {NativeSpeaker} from '../../packages/postgres/src/runtime-speaker.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeSpeakerHelpers} from './postgres-speaker-helpers.js';
describe.skipIf(!nativePostgresAvailable)('原生同人重锁原始约束诊断',()=>{
 it('已有本人资料时同人开始应保留资料且原子推进焦点',async()=>{
  const x=await nativeRuntimeFixture(),db=await NativePostgresDatabase.open(x.result.api,'api'),repo=new NativeCoreRepository(db),speaker=new NativeSpeaker(repo,x.config.sessionSecret),reception=new NativeReception(repo),h=nativeSpeakerHelpers(x);
  try{const p=await h.person(),{guest:g}=await h.focusGuest(p);await h.goodGuest(g,'/memory',{displayName:'原创约束诊断访客',roles:['visitor'],consent:true,noticeVersion:'memory-v1',retentionDays:30,focusVersion:0});const input=await h.startInput(g),raw=decodeURIComponent(g.cookie.slice(g.cookie.indexOf('=')+1)),proof=reception.credentials(x.config.sessionSecret,x.result.api.runtimeId,g.id,raw);
   const result=await db.transaction(async()=>{try{const hint=await speaker.prelock(g.id,proof.tokenHash);await reception.guest(g.id,proof.tokenHash,proof.csrfHash,true);return await speaker.apply(g.id,proof.tokenHash,proof.csrfHash,'start',input,hint);}catch(error){const e=error as{code?:string;message?:string;detail?:string;where?:string};console.log(JSON.stringify({syntheticOnlyDiagnostic:true,code:e.code,message:e.message,detail:e.detail,where:e.where,rawCredentialsOrTextLogged:false}));throw error;}});expect(result).toMatch(/^[a-f0-9-]{36}$/);
  }finally{await db.close();await x.close();}
 },60000);
});
