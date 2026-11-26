import {describe,it,expect} from 'vitest';
import {createApp} from '../../apps/api/src/app.js';
import {NativeSpeaker} from '../../packages/postgres/src/runtime-speaker.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {nativeSpeakerHelpers} from './postgres-speaker-helpers.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
describe.skipIf(!nativePostgresAvailable)('原生临时参考自然空闲清理',()=>{
 it('API关闭后worker沿原120秒空闲时钟清理临时参考，不改活动时间或绝对期限',async()=>{
  const x=await nativeRuntimeFixture(),h=nativeSpeakerHelpers(x),speaker=new NativeSpeaker(x.repo,x.config.sessionSecret);let reopened:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
   const p=await h.person(),{guest:g}=await h.focusGuest(p);await h.focusOp(g,'',{mode:'temporary',sameVisitorConfirmed:true,consent:true,noticeVersion:'speaker-v1'});await h.focusOp(g,'reference',{fixture:'clear'});const before=(await h.current(g)).session,reference=await x.owner(async db=>(await db.query('SELECT id,expires_at FROM speaker_references WHERE session_id=$1',[g.id])).rows[0]),idleDeadline=Date.parse(before.activityAt)+120000;
   await x.app.close();let state:Record<string,string>|undefined;
   while(Date.now()<idleDeadline+10000){await x.workerDb.transaction(()=>speaker.sweep());state=await x.owner(async db=>(await db.query('SELECT status,activity_at,expires_at FROM reception_sessions WHERE id=$1',[g.id])).rows[0]);if(state!.status==='expired')break;await new Promise(r=>setTimeout(r,250));}
   expect(state?.status).toBe('expired');expect(Date.now()).toBeGreaterThanOrEqual(idleDeadline);expect(state?.activity_at).toBe(before.activityAt);expect(state?.expires_at).toBe(before.expiresAt);const ended=await x.owner(async db=>({focus:(await db.query('SELECT state,reference_id,usage_target_token FROM speaker_focus_sessions WHERE session_id=$1',[g.id])).rows[0],reference:(await db.query('SELECT status,provider_reference,target_token,expires_at FROM speaker_references WHERE id=$1',[reference.id])).rows[0],permits:(await db.query('SELECT id FROM speaker_ptt_permits WHERE session_id=$1',[g.id])).rows.length}));expect(ended.focus).toEqual({state:'ended',reference_id:null,usage_target_token:null});expect(ended.reference).toEqual({status:'deleted',provider_reference:null,target_token:null,expires_at:reference.expires_at});expect(ended.permits).toBe(0);
   reopened=await createApp(x.config);const response=await reopened.inject({url:'/api/v1/guest/sessions/'+g.id+'/speaker-focus',headers:g.headers});expect([401,410]).toContain(response.statusCode);console.log(JSON.stringify({sessionId:g.id,apiClosedDuringOriginalIdleWindow:true,originalActivityAt:before.activityAt,originalAbsoluteExpiry:before.expiresAt,originalReferenceExpiry:reference.expires_at,observedExpiredAt:new Date().toISOString(),actualNaturalIdleSeconds:120,clockOrLeaseReset:false,realAudioUsed:false}));
  }finally{await reopened?.close();await x.close();}
 },160000);
});
