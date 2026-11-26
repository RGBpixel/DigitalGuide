import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeVisitHelpers} from './postgres-visit-helpers.js';
import {NativeVisitWorker} from '../../packages/postgres/src/runtime-visit-worker.js';
describe.skipIf(!nativePostgresAvailable)('原生来访原等待期限的实际经过',()=>{
 let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>;
 beforeAll(async()=>{x=await nativeRuntimeFixture();},120000);afterAll(async()=>{await x?.close();},60000);
 it('原60秒内轮询和送达回执不续期，真实到期后暂停自动服务并转人工',async()=>{
  const h=nativeVisitHelpers(x),s=await h.start('mock'),confirmed=await h.confirm(s.guest,s.draft),submitted=await h.notify(s.guest,confirmed),worker=new NativeVisitWorker(x.repo);
  await worker.runOne();const initial=await h.currentVisit(s.guest),session=(await h.current(s.guest)).session,deadline=initial.visit!.hostDeadline!;
  expect(initial.visit!.status).toBe('waiting_host');expect(deadline).toBe(submitted.visit!.hostDeadline);
  const row=(await h.inbox(s.p,false)).items[0];await h.good(s.p,'/visits/'+row.id+'/mock-receipt',{version:row.delivery!.version,status:'delivered'});
  expect((await h.currentVisit(s.guest)).visit!.hostDeadline).toBe(deadline);
  while(Date.now()<Date.parse(deadline)-200){const current=await h.currentVisit(s.guest);expect(current.visit!.status).toBe('waiting_host');expect(current.visit!.hostDeadline).toBe(deadline);expect((await h.current(s.guest)).session.activityAt).toBe(session.activityAt);await new Promise(r=>setTimeout(r,Math.min(1000,Math.max(1,Date.parse(deadline)-Date.now()-200))));}
  let current=await h.currentVisit(s.guest);const observationEnd=Date.parse(deadline)+5000;
  while(current.visit!.status!=='escalated'&&Date.now()<observationEnd){await new Promise(r=>setTimeout(r,50));current=await h.currentVisit(s.guest);}
  expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(deadline));expect(current.visit).toMatchObject({status:'escalated',guestName:'',guidance:null,hostDeadline:deadline});
  const after=(await h.current(s.guest)).session;expect(after).toMatchObject({status:'human',focusVersion:session.focusVersion+1,activityAt:session.activityAt});
  const history=(await h.inbox(s.p,false)).items[0];expect(history).toMatchObject({escalatedReason:'host_timeout',delivery:{status:'delivered',availability:'withdrawn'}});
 },80000);
});
