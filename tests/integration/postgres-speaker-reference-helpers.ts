import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {SpeakerReference,SpeakerFocusView} from '@digitalguide/contracts';
import type {NativeSpeakerUse} from '../../packages/postgres/src/runtime-speaker.js';
import type {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
import type {NativeGuest} from './postgres-reception-helpers.js';
import {nativeSpeakerHelpers} from './postgres-speaker-helpers.js';
export function nativeSpeakerReferenceHelpers(x:Awaited<ReturnType<typeof nativeRuntimeFixture>>){
 const migration='075-native-speaker-references.sql',sha256=createHash('sha256').update(fs.readFileSync('migrations/postgres/'+migration)).digest('hex'),freeze='docs/evidence/T20/postgres-speaker-focus/reference-migration-freeze.json';
 if(fs.existsSync(freeze))assert.equal(JSON.parse(fs.readFileSync(freeze,'utf8')).sha256,sha256);else fs.writeFileSync(freeze,JSON.stringify({result:'PASS_COMMITTED_MIGRATION_FROZEN',recordedAt:new Date().toISOString(),migration,sha256,firstCommittedPrivateSchema:x.result.schema,firstCluster:x.cluster.root,runtimeVersionAtCommit:72,nextPostgresMigration:'076',appliedFilesMayNotBeEdited:true},null,2)+'\n',{flag:'wx'});
 const h=nativeSpeakerHelpers(x);
 const enrollInput=(p:NativeTestPerson,extra:object={})=>({workspaceId:p.workspace,label:'本人的原创合成参考',purpose:'speaker_focus',consent:true,noticeVersion:'speaker-v1',retentionDays:7,fixture:'clear',provider:'mock-focus-final',source:'synthetic_fixture',...extra});
 const enroll=(p:NativeTestPerson,extra:object={})=>h.good<SpeakerReference>(p,'/speaker-references',enrollInput(p,extra));
 const references=(p:NativeTestPerson,workspace=p.workspace)=>h.get<SpeakerReference[]>(p,'/speaker-references?workspaceId='+workspace);
 const authorize=(p:NativeTestPerson,r:SpeakerReference,g:NativeGuest,extra:object={})=>h.good<NativeSpeakerUse>(p,'/speaker-references/'+r.id+'/authorize-use',{referenceVersion:r.version,sessionId:g.id,confirmed:true,...extra});
 const enrolledInput=(g:NativeGuest,useCode:string)=>h.focusInput(g,{mode:'enrolled',sameVisitorConfirmed:true,consent:true,noticeVersion:'speaker-v1',useCode});
 const startEnrolled=async(g:NativeGuest,useCode:string)=>h.goodGuest<SpeakerFocusView>(g,'/speaker-focus',await enrolledInput(g,useCode));
 return{...h,enrollInput,enroll,references,authorize,enrolledInput,startEnrolled};
}
