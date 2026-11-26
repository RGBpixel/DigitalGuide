import type {z} from 'zod';
import {AppError,type Principal} from '@digitalguide/domain';
import {peerSignal,type peerSignalInput,type peerHeartbeat,type PeerPoll} from '@digitalguide/contracts';
import {LivePeers,peerHash,type PeerAttemptRow,type PeerGuestRow,type PeerInviteRow} from './live-peers.js';
export function hostPeerAttempt(s:LivePeers,p:Principal,a:PeerAttemptRow){const i=s.invite(a.invite_id);s.host(p,i,'live.start');if(a.host_id!==p.userId)throw new AppError('PEER_HOST_DEVICE','此连接属于另一主持人，请先明确结束原连接。',403);return i;}
export function guestPeerAttempt(i:PeerInviteRow,g:PeerGuestRow,a:PeerAttemptRow){if(a.invite_id!==i.id||a.guest_id!==g.id)throw new AppError('NOT_FOUND','本次邀请没有该连接。',404);}
export function sendPeerSignal(s:LivePeers,a:PeerAttemptRow,side:'host'|'guest',input:z.infer<typeof peerSignalInput>){
 s.version(a,input.version);s.assertAttempt(a,side,input.clientId);const payload=JSON.stringify(input.signal),hash=peerHash(input.signal),old=s.repo.get<{payload_hash:string}>('SELECT payload_hash FROM live_peer_signals WHERE attempt_id=? AND direction=? AND sequence=?',a.id,side,input.sequence);
 if(old){if(old.payload_hash!==hash)throw new AppError('PEER_SIGNAL_CONFLICT','同一信令编号内容已变化，请重新接通。',409);return;}
 const last=s.repo.get<{n:number}>('SELECT COALESCE(max(sequence),0) n FROM live_peer_signals WHERE attempt_id=? AND direction=?',a.id,side)!.n;
 if(input.sequence!==last+1)throw new AppError('PEER_SIGNAL_SEQUENCE','信令顺序不连续，请结束旧连接后重新接通。',409);
 const descriptions=s.repo.all<{direction:string;payload:string}>("SELECT direction,payload FROM live_peer_signals WHERE attempt_id=? AND json_extract(payload,'$.kind')='description'",a.id);
 if(input.signal.kind==='description'){
  if(input.signal.type!==(side==='host'?'offer':'answer')||descriptions.some(d=>d.direction===side)||side==='guest'&&!descriptions.some(d=>d.direction==='host'))throw new AppError('PEER_DESCRIPTION_STATE','提议、应答或设备代次不符合本次连接状态。',409);
 }else if(!descriptions.some(d=>d.direction===side))throw new AppError('PEER_DESCRIPTION_REQUIRED','请先提交当前设备的连接提议或应答。',409);
 s.repo.run('INSERT INTO live_peer_signals VALUES (?,?,?,?,?,?)',a.id,side,input.sequence,payload,hash,new Date().toISOString());
}
export function pollPeerSignals(s:LivePeers,a:PeerAttemptRow,side:'host'|'guest',clientId:string,after:number):PeerPoll {
 s.assertAttempt(a,side,clientId);const direction=side==='host'?'guest':'host',rows=s.repo.all<{sequence:number;payload:string;payload_hash:string}>('SELECT sequence,payload,payload_hash FROM live_peer_signals WHERE attempt_id=? AND direction=? AND sequence>? ORDER BY sequence LIMIT 32',a.id,direction,after),signals=rows.map(row=>{const signal=peerSignal.parse(JSON.parse(row.payload));if(peerHash(signal)!==row.payload_hash)throw new AppError('PEER_SIGNAL_CHANGED','连接信令的固定摘要无效，请重新接通。',409);return{sequence:row.sequence,signal};});return{attempt:s.attemptView(a),signals,nextCursor:signals.at(-1)?.sequence??after};
}
export function heartbeatPeer(s:LivePeers,a:PeerAttemptRow,side:'host'|'guest',input:z.infer<typeof peerHeartbeat>){
 s.version(a,input.version);const current=s.assertAttempt(a,side,input.clientId);const previous=side==='host'?a.host_sequence:a.guest_sequence;if(input.sequence<=previous)throw new AppError('PEER_HEARTBEAT_SEQUENCE','旧设备或迟到心跳不能更新当前连接。',409);
 const fields=side==='host'?'host_lease_until=?,host_sequence=?,host_connection=?,host_received_bytes=?,host_decoded_frames=?':'guest_lease_until=?,guest_sequence=?,guest_connection=?,guest_received_bytes=?,guest_decoded_frames=?';
 s.repo.run('UPDATE live_peer_attempts SET '+fields+',updated_at=? WHERE id=?',new Date(Date.now()+15000).toISOString(),input.sequence,input.connectionState,input.receivedBytes,input.decodedVideoFrames,new Date().toISOString(),a.id);
 if(side==='host'){const ready=!!input.programReady&&input.programVersion===current.source.session.version;s.repo.run('UPDATE live_peer_attempts SET host_program_version=?,host_program_ready=? WHERE id=?',input.programVersion??0,ready?1:0,a.id);}
}
