import {nativeVisitHash} from '../../packages/postgres/src/runtime-visit-hash.js';
import {createHash} from 'node:crypto';
import {canonical} from '@digitalguide/domain';
import type {NativeVisitDeliveryContext} from '../../packages/postgres/src/runtime-visit-worker.js';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeVisitHelpers} from './postgres-visit-helpers.js';
import {NativeVisitWorker} from '../../packages/postgres/src/runtime-visit-worker.js';
describe.skipIf(!nativePostgresAvailable)('原生通知执行上下文定向诊断',()=>{
 let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>;
 beforeAll(async()=>{x=await nativeRuntimeFixture();},120000);afterAll(async()=>{await x?.close();},60000);
 it('原始worker角色上下文及本地完成语句可独立执行',async()=>{const h=nativeVisitHelpers(x),worker=new NativeVisitWorker(x.repo),s=await h.start('local'),confirmed=await h.confirm(s.guest,s.draft);await h.notify(s.guest,confirmed);const lease=await worker.claim();expect(lease).toBeTruthy();let diagnostic:unknown=null,comparison:unknown=null;await x.repo.db.transaction(async()=>{try{const raw=await worker.call<NativeVisitDeliveryContext>('dg_native_visit_delivery_context',[lease!.id,lease!.token]);comparison={sameId:raw.lease.id===lease!.id,sameToken:raw.lease.token===lease!.token,sqlHash:raw.requestHash,nodeHash:nativeVisitHash(raw.request),legacyLocaleHash:createHash('sha256').update(canonical(raw.request)).digest('hex'),requestKeys:Object.keys(raw.request??{})};expect(nativeVisitHash(raw.request)).toBe(raw.requestHash);const context=await worker.context(lease!);await worker.call('dg_native_visit_delivery_finish',[lease!.id,lease!.token,context.requestHash,'submitted','local-inbox:'+lease!.id,null]);}catch(error){diagnostic={code:error&&typeof error==='object'&&'code'in error?String(error.code):null,message:error instanceof Error?error.message:String(error)};throw error;}}).catch(()=>undefined);expect(diagnostic,JSON.stringify(comparison)).toBeNull();});
});
