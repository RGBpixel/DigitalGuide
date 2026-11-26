import type {PeerAttempt,PeerPoll} from '@digitalguide/contracts';
import type {RefObject} from 'react';
import {PeerRequestError,type PeerRequest} from './peer-requests.js';
export interface ProgramPeerSource{video:HTMLVideoElement|null;sessionId:string|null;outputId:string|null;sessionVersion:number|null;generationId:string|null}
interface Options {
 side:'host'|'guest';attempt:PeerAttempt;clientId:string;request:PeerRequest;
 program?:RefObject<ProgramPeerSource>;sessionId?:string;local?:MediaStream;
 remote:(stream:MediaStream|null)=>void;state:(text:string)=>void;changed?:(attempt:PeerAttempt)=>void;closed?:(reason:string)=>void;
}
const pause=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();},timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});
export class LivePeerClient {
 private pc:RTCPeerConnection;private abort=new AbortController();private ended=false;private permissionAt=performance.now();private watchdog:ReturnType<typeof setInterval>;
 private remoteStream=new MediaStream();private senders=new Map<string,RTCRtpSender>();private owned:MediaStreamTrack[]=[];private sourceKey='';private programReady=false;
 private outbox:Array<{kind:'description';type:'offer'|'answer';sdp:string}|{kind:'candidate';candidate:RTCIceCandidateInit|null}>=[];private sending=false;private descriptionQueued=false;private sent=0;private cursor=0;private heartbeat=0;private lastHeartbeat=0;private disconnectedAt=0;
 constructor(private options:Options){
  this.pc=new RTCPeerConnection({iceServers:[],bundlePolicy:'max-bundle'});
  this.pc.onicecandidate=event=>this.enqueue({kind:'candidate',candidate:event.candidate?event.candidate.toJSON():null});
  this.pc.ontrack=event=>{if(this.ended)return;const allowed=options.side==='guest'||(event.track.kind==='video'?options.attempt.media.camera:options.attempt.media.microphone);if(!allowed){event.track.stop();return;}this.remoteStream.addTrack(event.track);this.guardIncoming();options.remote(this.remoteStream);};
  this.pc.onconnectionstatechange=()=>{if(this.ended)return;const state=this.pc.connectionState;if(state==='failed'||state==='closed')this.stop('音视频连接已停止，请重新接通。');else if(state==='connected'){this.disconnectedAt=0;options.state('连接已建立，正在等待实际媒体');}else if(state==='disconnected'){this.disconnectedAt=performance.now();options.state('音视频连接暂时中断');}};
  this.watchdog=setInterval(()=>{if(performance.now()-this.permissionAt>5000)this.stop('授权连接中断超过5秒，已停止本机收发，请重新接通。');else if(this.disconnectedAt&&performance.now()-this.disconnectedAt>8000)this.stop('音视频连接未能恢复，请重新接通。');},200);
  window.addEventListener('pagehide',this.leave);document.addEventListener('freeze',this.leave);
 }
 private leave=()=>this.stop('页面已关闭或暂停，已结束本次音视频连接。');
 private current(){if(this.ended||this.abort.signal.aborted)throw new Error('本次连接已经结束。');}
 async start(){
  try {
   if(this.options.side==='host'){
    for(const kind of ['video','audio']){const t=this.pc.addTransceiver(kind,{direction:'sendrecv'});this.senders.set(kind,t.sender);}
    await this.syncProgram();this.current();const offer=await this.pc.createOffer();this.current();await this.pc.setLocalDescription(offer);this.current();this.enqueue({kind:'description',type:'offer',sdp:this.pc.localDescription!.sdp});
   }
   this.options.state('正在协商实际音视频连接');void this.loop();
  }catch(error){this.stop(error instanceof Error?error.message:'无法建立音视频连接。');}
 }
 private enqueue(signal:{kind:'description';type:'offer'|'answer';sdp:string}|{kind:'candidate';candidate:RTCIceCandidateInit|null}){
  if(this.ended)return;if(signal.kind==='description'){this.outbox.unshift(signal);this.descriptionQueued=true;}else this.outbox.push(signal);
  if(this.descriptionQueued&&!this.sending)void this.flush();
 }
 private async flush(){
  if(this.sending||this.ended)return;this.sending=true;
  try{while(this.outbox.length){this.current();const signal=this.outbox.shift()!;await this.options.request('/signal',{version:this.options.attempt.version,clientId:this.options.clientId,sequence:++this.sent,signal},this.abort.signal);this.current();this.permissionAt=performance.now();}}
  catch(error){if(!this.ended)this.stop(error instanceof Error?error.message:'连接信令发送失败，请重新接通。');}finally{this.sending=false;}
 }
 private guardIncoming(){if(this.options.side==='guest')for(const t of this.remoteStream.getAudioTracks())t.enabled=this.options.attempt.program.ready&&!this.options.attempt.program.muted;}
 private async receive(message:PeerPoll['signals'][number]){
  this.current();const signal=message.signal;
  if(signal.kind==='description'){
   if(signal.type!==(this.options.side==='host'?'answer':'offer'))throw new Error('连接提议与当前角色不一致。');
   await this.pc.setRemoteDescription({type:signal.type,sdp:signal.sdp});this.current();
   if(this.options.side==='guest'){
    for(const t of this.pc.getTransceivers()){const kind=t.receiver.track.kind,allowed=kind==='video'?this.options.attempt.media.camera:this.options.attempt.media.microphone,track=allowed?this.options.local?.getTracks().find(v=>v.kind===kind&&v.readyState==='live'):undefined;t.direction=track?'sendrecv':'recvonly';if(track){await t.sender.replaceTrack(track);this.current();}}
    const answer=await this.pc.createAnswer();this.current();await this.pc.setLocalDescription(answer);this.current();this.enqueue({kind:'description',type:'answer',sdp:this.pc.localDescription!.sdp});
   }
  }else {if(!this.pc.remoteDescription)throw new Error('尚未收到当前连接提议。');await this.pc.addIceCandidate(signal.candidate??undefined);this.current();}
  this.cursor=message.sequence;
 }
 private async syncProgram(){
  if(this.options.side!=='host')return;const source=this.options.program?.current,a=this.options.attempt,video=source?.video,ready=!!video&&source.sessionId===this.options.sessionId&&source.sessionVersion===a.program.version&&video.readyState>=2&&!video.paused;
  if(!ready){this.programReady=false;this.sourceKey='';for(const sender of this.senders.values())if(sender.track)await sender.replaceTrack(null);this.owned.forEach(t=>t.stop());this.owned=[];return;}
  const key=source.sessionId+':'+source.outputId+':'+source.sessionVersion+':'+source.generationId+':'+video.currentSrc;
  if(key!==this.sourceKey||this.owned.some(t=>t.readyState==='ended')){
   this.owned.forEach(t=>{t.enabled=false;t.stop();});this.owned=[];const stream=(video as HTMLVideoElement&{captureStream:()=>MediaStream}).captureStream();
   this.owned=stream.getTracks();this.owned.forEach(t=>{t.enabled=false;});
   if(!stream.getVideoTracks().length||!stream.getAudioTracks().length)throw new Error('浏览器未提供节目画面或声音，请重新播放连续预览后接通。');
   for(const kind of ['video','audio']){await this.senders.get(kind)!.replaceTrack(stream.getTracks().find(t=>t.kind===kind)!);this.current();}
   this.sourceKey=key;
  }
  const latest=this.options.program?.current;this.programReady=latest?.sessionId===this.options.sessionId&&latest?.outputId===source.outputId&&latest?.generationId===source.generationId&&latest?.sessionVersion===a.program.version;
  for(const t of this.owned)t.enabled=this.programReady&&(t.kind!=='audio'||!a.program.muted);
 }
 private async statistics(){let receivedBytes=0,decodedVideoFrames=0;const stats=await this.pc.getStats();stats.forEach(value=>{if(value.type==='inbound-rtp'){receivedBytes+=Number(value.bytesReceived)||0;decodedVideoFrames+=Number(value.framesDecoded)||0;}});return{receivedBytes,decodedVideoFrames};}
 private async loop(){
  while(!this.ended){
   try {
    const value=await this.options.request<PeerPoll>('/poll?'+new URLSearchParams({clientId:this.options.clientId,after:String(this.cursor)}),undefined,this.abort.signal);this.current();
    if(value.attempt.id!==this.options.attempt.id||value.attempt.version!==this.options.attempt.version||value.attempt.status!=='active'||Date.parse(value.attempt.leaseExpiresAt)<=Date.now())throw new Error('原连接或授权已结束，请重新接通。');
    this.permissionAt=performance.now();this.options.attempt=value.attempt;this.guardIncoming();this.options.changed?.(value.attempt);await this.syncProgram();this.current();for(const message of value.signals)await this.receive(message);
    if(performance.now()-this.lastHeartbeat>2000){const stats=await this.statistics();this.current();await this.options.request('/heartbeat',{version:this.options.attempt.version,clientId:this.options.clientId,sequence:++this.heartbeat,connectionState:this.pc.connectionState,...stats,...(this.options.side==='host'?{programVersion:this.options.attempt.program.version,programReady:this.programReady}:{})},this.abort.signal);this.current();this.permissionAt=performance.now();this.lastHeartbeat=performance.now();if(stats.receivedBytes>0&&this.pc.connectionState==='connected')this.options.state('正在接收对方实际媒体');}
   }catch(error){if(this.ended)break;if(error instanceof PeerRequestError||!(error instanceof TypeError)){this.stop(error instanceof Error?error.message:'连麦状态已改变，请重新接通。');break;}this.options.state('连接服务暂不可用，正在核对授权');}
   await pause(300,this.abort.signal);
  }
 }
 stop(reason='本次音视频连接已结束。'){
  if(this.ended)return;this.ended=true;this.abort.abort();clearInterval(this.watchdog);window.removeEventListener('pagehide',this.leave);document.removeEventListener('freeze',this.leave);
  for(const t of [...this.owned,...(this.options.local?.getTracks()||[]),...this.remoteStream.getTracks()]){t.enabled=false;t.stop();}
  this.pc.ontrack=null;this.pc.onicecandidate=null;this.pc.onconnectionstatechange=null;this.pc.close();this.options.remote(null);this.options.state(reason);this.options.closed?.(reason);
  void this.options.request('/end',{version:this.options.attempt.version,confirmed:true}).catch(()=>{});
 }
}
