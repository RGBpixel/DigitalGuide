import {randomUUID} from 'node:crypto';
import type {Repository} from '@digitalguide/database';
import {LiveGuestProgramme} from '../../api/src/live-guest-programme.js';
import {peerHash} from '../../api/src/live-peers.js';
import type {Config} from '../../api/src/config.js';
import type {ProgrammeGrantRow,ProgrammeConnectionRow} from '../../../packages/domain/src/live-guest-programme.js';
import type {ProgrammeRuntimeInstruction,ProgrammeRuntimeMessage} from '../../../packages/media/src/live-guest-programme-hub.js';
export class LiveProgrammeRuntime{
 private service:LiveGuestProgramme;constructor(private repo:Repository,config:Config,private outputId:string,private generationId:string,private guard:()=>unknown){this.service=new LiveGuestProgramme(repo,config);}
 instructions():ProgrammeRuntimeInstruction[]{
  this.guard();const result:ProgrammeRuntimeInstruction[]=[];for(const c of this.repo.all<ProgrammeConnectionRow>("SELECT * FROM live_guest_programme_connections WHERE output_id=? AND status IN ('queued','connecting','connected') ORDER BY created_at,id LIMIT 4",this.outputId)){
   const r=this.service.grant(c.grant_id);try{this.service.live(r);if(c.guest_lease_until<=new Date().toISOString())throw new Error('Guest heartbeat expired');if(c.generation_id&&c.generation_id!==this.generationId)throw new Error('Media generation changed');if(!c.generation_id){c.generation_id=this.generationId;c.runtime_token=randomUUID();c.status='connecting';this.repo.run("UPDATE live_guest_programme_connections SET generation_id=?,runtime_token=?,status='connecting',updated_at=? WHERE id=? AND generation_id IS NULL",this.generationId,c.runtime_token,new Date().toISOString(),c.id);}const a=this.service.peers.attempt(c.peer_attempt_id);
    result.push({id:c.id,grantId:r.id,runtimeToken:c.runtime_token!,controlVersion:c.version,consentHash:r.consent_hash!,publicName:r.public_name,camera:!!r.camera,microphone:!!r.microphone,recordingAllowed:!!r.recording_allowed,expiresAt:r.expires_at,leaseExpiresAt:[c.guest_lease_until,a.host_lease_until,a.guest_lease_until].sort()[0],mixState:c.mix_state,audioMuted:!!c.audio_muted,videoHidden:!!c.video_hidden,answer:c.guest_answer});
   }catch{this.service.end(c,'本次节目来源、设备、媒体代次或心跳已变化。');}
  }return result;
 }
 message(value:ProgrammeRuntimeMessage){this.repo.transaction(()=>{
  this.guard();const c=this.repo.get<ProgrammeConnectionRow>('SELECT * FROM live_guest_programme_connections WHERE id=? AND output_id=?',value.id,this.outputId);if(!c||!['queued','connecting','connected'].includes(c.status)||c.generation_id!==this.generationId||c.runtime_token!==value.runtimeToken)return;const r=this.service.grant(c.grant_id);try{this.service.live(r);}catch{this.service.end(c,'原节目来源或用途已失效。');return;}const at=new Date().toISOString();
  if(value.type==='offer'){if(value.offer.sdp.length>65536){this.service.end(c,'节目媒体协商超出当前限额。','failed');return;}if(c.server_offer_hash&&c.server_offer_hash!==peerHash(value.offer.sdp)){this.service.end(c,'节目媒体协商代次发生变化。','failed');return;}this.repo.run('UPDATE live_guest_programme_connections SET server_offer=?,server_offer_hash=?,updated_at=? WHERE id=?',value.offer.sdp,peerHash(value.offer.sdp),at,c.id);}
  else if(value.type==='closed')this.service.end(c,value.reason,'failed');
  else{const s=value.stats,valid=[s.rtpAudio,s.rtpVideo,s.decodedFrames,s.decodedPcmBytes].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=1e12);if(!valid){this.service.end(c,'节目媒体进度不符合当前协议。','failed');return;}this.repo.run("UPDATE live_guest_programme_connections SET status=?,rtp_audio=?,rtp_video=?,decoded_frames=?,decoded_pcm_bytes=?,video_ready=?,audio_ready=?,media_at=?,updated_at=? WHERE id=?",s.state==='connected'?'connected':'connecting',s.rtpAudio,s.rtpVideo,s.decodedFrames,s.decodedPcmBytes,Number(s.videoReady),Number(s.audioReady),at,at,c.id);}
 });}
}
export function tickGuestProgramme(repo:Repository,config:Config){new LiveGuestProgramme(repo,config).sweep();}
export function programmeRecordingSources(repo:Repository,connectionIds:string[]){return[...new Set(connectionIds)].map(id=>{const c=repo.get<ProgrammeConnectionRow>('SELECT * FROM live_guest_programme_connections WHERE id=?',id),r=c&&repo.get<ProgrammeGrantRow>('SELECT * FROM live_guest_programme_grants WHERE id=?',c.grant_id);if(!c||!r||!r.recording_allowed||!r.consent_hash)throw new Error('Guest recording purpose missing');return{grantId:r.id,connectionId:c.id,inviteId:r.invite_id,consentHash:r.consent_hash,expiresAt:r.expires_at,recordingAllowed:true as const};});}
