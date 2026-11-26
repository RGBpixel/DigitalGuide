import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {NativeReception} from '../../packages/postgres/src/runtime-reception.js';
import {NativeSpeaker} from '../../packages/postgres/src/runtime-speaker.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeSpeakerHelpers} from './postgres-speaker-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>,api:NativePostgresDatabase;
describe.skipIf(!nativePostgresAvailable)('原生专注对话受控SQL边界',()=>{
 beforeAll(async()=>{x=await nativeRuntimeFixture();api=await NativePostgresDatabase.open(x.result.api,'api');},60000);afterAll(async()=>{await api?.close();await x?.close();});
 async function denied(db:NativePostgresDatabase,sql:string,args:unknown[]=[]){let code:string|undefined;await expect(db.transaction(async()=>{try{await db.query(sql,args);}catch(error){code=(error as{code?:string}).code;throw error;}})).rejects.toThrow();expect(code).toBe('42501');}
 it('API与worker均无九张表原始读取或写入权限，内部迁移助手不能被应用直接调用',async()=>{
  const tables=['speaker_references','speaker_focus_sessions','speaker_segment_decisions','speaker_use_tickets','speaker_ptt_permits','_dg_native_speaker_reference_origins','_dg_native_speaker_actions','_dg_native_speaker_focus_origins','_dg_native_speaker_visit_focus_links'];for(const db of [api,x.workerDb])for(const table of tables){await denied(db,'SELECT * FROM '+table);await denied(db,'DELETE FROM '+table);}
  await denied(api,'SELECT dg_native_speaker_advance($1,$2,$3)',[randomUUID(),'forged',randomUUID()]);await denied(x.workerDb,'SELECT dg_native_speaker_view($1,$2)',[randomUUID(),'0'.repeat(64)]);await denied(api,'SELECT dg_native_people_erase_before_speaker($1,$2)',[randomUUID(),'forged']);
 });
 it('绕过HTTP也不能省略同意、版本或焦点类型校验，失败事务不产生参考',async()=>{
  const h=nativeSpeakerHelpers(x),p=await h.person(),{guest:g}=await h.focusGuest(p),repo=new NativeCoreRepository(api),reception=new NativeReception(repo),speaker=new NativeSpeaker(repo,x.config.sessionSecret),raw=decodeURIComponent(g.cookie.slice(g.cookie.indexOf('=')+1)),proof=reception.credentials(x.config.sessionSecret,x.result.api.runtimeId,g.id,raw),input=await h.startInput(g);
  for(const change of [{consent:false},{sameVisitorConfirmed:false},{noticeVersion:'wrong'},{focusVersion:'0'},{version:'1'}])await expect(api.transaction(async()=>{const hint=await speaker.prelock(g.id,proof.tokenHash);await reception.guest(g.id,proof.tokenHash,proof.csrfHash,true);return speaker.apply(g.id,proof.tokenHash,proof.csrfHash,'start',{...input,...change},hint);})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
  expect((await x.owner(async db=>(await db.query('SELECT id FROM speaker_references WHERE session_id=$1',[g.id])).rows)).length).toBe(0);
 });
});
