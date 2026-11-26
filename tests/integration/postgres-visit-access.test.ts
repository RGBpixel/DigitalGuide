import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeVisitHelpers} from './postgres-visit-helpers.js';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {NativeVisits} from '../../packages/postgres/src/runtime-visits.js';
import {NativeReception} from '../../packages/postgres/src/runtime-reception.js';
describe.skipIf(!nativePostgresAvailable)('原生来访受控SQL边界和专用角色',()=>{
 let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,apiDb:NativePostgresDatabase;
 beforeAll(async()=>{x=await nativeRuntimeFixture();apiDb=await NativePostgresDatabase.open(x.result.api,'api');},120000);afterAll(async()=>{await apiDb?.close();await x?.close();},60000);
 async function denied(db:NativePostgresDatabase,sql:string){let state:string|undefined;await expect(db.transaction(async()=>{try{await db.query(sql);}catch(error){state=error&&typeof error==='object'&&'code'in error?String(error.code):undefined;throw error;}})).rejects.toMatchObject({code:'PG_OPERATION_FAILED'});expect(state).toBe('42501');}
 it('API和worker不能直接读取或删改来访私表，只能调用各自受控函数',async()=>{for(const db of [apiDb,x.workerDb])for(const table of ['visits','visit_deliveries','_dg_native_visit_origins','_dg_native_visit_drafts','_dg_native_visit_erasure_receipts','_dg_native_visit_delivery_attempts','mock_notification_submissions']){await denied(db,'SELECT * FROM '+table);await denied(db,'DELETE FROM '+table);}await denied(apiDb,'SELECT dg_native_visit_delivery_claim()');await denied(apiDb,"SELECT dg_native_visit_internal_delivery('not-a-visit')");await denied(x.workerDb,"SELECT dg_native_visit_staff_view('not-a-visit',false)");});
 it('受控删除函数也要求当前焦点及明确同意，缺字段不能绕过HTTP契约',async()=>{const h=nativeVisitHelpers(x),s=await h.start('local'),core=new NativeCoreRepository(apiDb),service=new NativeVisits(core,x.config.sessionSecret),reception=new NativeReception(core),proof=reception.credentials(x.config.sessionSecret,x.result.api.runtimeId,s.guest.id,decodeURIComponent(s.guest.cookie.slice(s.guest.cookie.indexOf('=')+1)));for(const input of [{version:1,confirmed:true},{version:1,focusVersion:0},{version:1,focusVersion:0,confirmed:false}])await expect(apiDb.transaction(async()=>{await service.prelock(s.guest.id,proof.tokenHash);await reception.guest(s.guest.id,proof.tokenHash,proof.csrfHash,true);await service.apply(s.guest.id,proof.tokenHash,proof.csrfHash,'erase',input,{});})).rejects.toMatchObject({code:'VALIDATION_FAILED'});expect((await h.currentVisit(s.guest)).visit).toMatchObject({guestName:s.input.guestName,dataErased:false,version:1});});
});
