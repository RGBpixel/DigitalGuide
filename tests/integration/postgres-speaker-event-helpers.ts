import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {SpeakerFixture} from '@digitalguide/contracts';
import type {NativeSpeakerEventResult} from '../../packages/postgres/src/runtime-speaker.js';
import type {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import type {NativeTestPerson} from './postgres-library-helpers.js';
import type {NativeGuest} from './postgres-reception-helpers.js';
import {nativeSpeakerReferenceHelpers} from './postgres-speaker-reference-helpers.js';

export function nativeSpeakerEventHelpers(x:Awaited<ReturnType<typeof nativeRuntimeFixture>>){
 const migration='078-native-speaker-events.sql',sha256=createHash('sha256').update(fs.readFileSync('migrations/postgres/'+migration)).digest('hex'),freeze='docs/evidence/T20/postgres-speaker-focus/events-migration-frozen.json';
 if(fs.existsSync(freeze))assert.equal(JSON.parse(fs.readFileSync(freeze,'utf8')).sha256,sha256);else fs.writeFileSync(freeze,JSON.stringify({migration,sha256,firstKnownCommittedFixtureAt:new Date().toISOString(),privateFixture:x.cluster.root,appliedFilesMayNotBeEdited:true},null,2)+'\n',{flag:'wx'});
 const h=nativeSpeakerReferenceHelpers(x);
 async function locked(p:NativeTestPerson,provider:'mock-focus-final'|'mock-focus-early'='mock-focus-final'){
  const value=await h.focusGuest(p,provider),g=value.guest;
  await h.focusOp(g,'',{mode:'temporary',sameVisitorConfirmed:true,consent:true,noticeVersion:'speaker-v1'});await h.focusOp(g,'reference',{fixture:'clear'});return value;
 }
 async function input(g:NativeGuest,fixture:SpeakerFixture='target_final',text='原创目标问题：今天的公开开放时间？',extra:object={}){return{focusVersion:(await h.current(g)).session.focusVersion,segmentId:randomUUID(),sequence:0,fixture,text,source:'mock_speaker_event' as const,...extra};}
 async function event(p:NativeTestPerson,g:NativeGuest,fixture:SpeakerFixture='target_final',text?:string,extra:object={}){return h.good<NativeSpeakerEventResult>(p,'/sessions/'+g.id+'/speaker-events',await input(g,fixture,text,extra));}
 const counts=(g:NativeGuest)=>x.owner(async db=>({messages:(await db.query('SELECT id FROM reception_messages WHERE session_id=$1',[g.id])).rows.length,decisions:(await db.query('SELECT id FROM speaker_segment_decisions WHERE session_id=$1',[g.id])).rows.length,origins:(await db.query('SELECT decision_id FROM _dg_native_speaker_event_origins WHERE session_id=$1',[g.id])).rows.length,sources:(await db.query('SELECT decision_id FROM _dg_native_speaker_message_sources WHERE session_id=$1',[g.id])).rows.length,ingress:(await db.query('SELECT id FROM _dg_native_speaker_ingress WHERE session_id=$1',[g.id])).rows.length}));
 return{...h,locked,input,event,counts};
}
