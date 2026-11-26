import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import {randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import type {Readable} from 'node:stream';
import {RTCPeerConnection,MediaStreamTrack,RtpPacket,useH264,useOPUS} from 'werift';
import {WebmCallback,RtpTimeCallback,DepacketizeCallback,JitterBufferCallback} from 'werift/nonstandard';
import {mediaTools} from './media-tools.js';

export interface ProgrammePeerMedia{camera:boolean;microphone:boolean}
export interface ProgrammePeerStats{state:string;rtpAudio:number;rtpVideo:number;decodedFrames:number;decodedPcmBytes:number;videoReady:boolean;audioReady:boolean;decoderPid:number|null;returnEncoderPid:number|null}
export interface ProgrammePeerCallbacks{offer:(description:{type:'offer';sdp:string})=>void;stats:(stats:ProgrammePeerStats)=>void;closed:(reason:string)=>void}
const frameBytes=320*180*4;

// This adapter is intentionally local-only. No external STUN/TURN, wildcard ICE
// sockets, mDNS candidate resolution, or remote media URLs are used.
export class LiveGuestProgrammePeer{
 readonly pc:RTCPeerConnection;private videoTrack:MediaStreamTrack;private audioTrack:MediaStreamTrack;
 private decoder:ChildProcess|null=null;private returnEncoder:ChildProcess|null=null;private returnSocket:dgram.Socket|null=null;private webm:WebmCallback|null=null;
 private pendingVideo=Buffer.alloc(0);private latestVideo:Buffer|null=null;private audio=Buffer.alloc(0);private videoAt=0;private audioAt=0;private ended=false;private answerApplied=false;private pendingWriteAt=0;
 private packets={audio:0,video:0};private decodedFrames=0;private decodedPcmBytes=0;private rateAt=performance.now();private rateBytes=0;private ratePackets=0;private timer:ReturnType<typeof setInterval>|null=null;private stopPromise:Promise<void>|null=null;
 private native:ChildProcess[]=[];private failureAt:string|null=null;
 constructor(private options:{root:string;directory:string;media:ProgrammePeerMedia;signal:AbortSignal;callbacks:ProgrammePeerCallbacks}){
  const streamId=randomUUID();this.videoTrack=new MediaStreamTrack({kind:'video',codec:useH264(),streamId});this.audioTrack=new MediaStreamTrack({kind:'audio',codec:useOPUS(),streamId});
  this.pc=new RTCPeerConnection({iceServers:[],iceUseDefaultStunServer:false,iceLite:true,iceInterfaceAddresses:{udp4:'127.0.0.1'},iceUseIpv4:true,iceUseIpv6:false,iceUseTcp:false,codecs:{video:[useH264()],audio:[useOPUS()]}});
  this.pc.addTransceiver(this.videoTrack,{direction:options.media.camera?'sendrecv':'sendonly'});this.pc.addTransceiver(this.audioTrack,{direction:options.media.microphone?'sendrecv':'sendonly'});
  this.pc.connectionStateChange.subscribe(state=>{if(this.ended)return;if(state==='failed'||state==='closed')void this.stop('本次服务器音视频连接已结束，请重新申请。');});
  options.signal.addEventListener('abort',this.abort,{once:true});
 }
 private abort=()=>{void this.stop('节目媒体进程已停止。');};
 private fail(stage:string){if(this.ended)return;this.failureAt=stage;void this.stop('来宾音视频'+stage+'失败，请检查设备后重新申请。');}
 private spawn(args:string[],name:string,stdio:('pipe'|'ignore'|number)[]){const log=fs.openSync(path.join(this.options.directory,name+'.log'),'wx');try{const child=spawn(mediaTools(this.options.root).ffmpeg,args,{windowsHide:true,cwd:this.options.directory,stdio:[...stdio.slice(0,2),log,...stdio.slice(3)]});this.native.push(child);child.on('error',()=>this.fail('编解码进程'));child.on('exit',()=>{if(!this.ended)this.fail('编解码进程');});return child;}finally{fs.closeSync(log);}}
 async start(){
  try{
   fs.mkdirSync(this.options.directory,{recursive:true});this.options.signal.throwIfAborted();await this.startReturn();this.startDecoder();this.pc.onTrack.subscribe(track=>this.attach(track));
   this.timer=setInterval(()=>{if(this.ended)return;for(const t of this.pc.getTransceivers())for(const track of t.receiver.tracks)if(track.kind==='video'&&track.ssrc)void t.receiver.sendRtcpPLI(track.ssrc).catch(()=>{});this.options.callbacks.stats(this.statistics());},1000);
   await this.pc.setLocalDescription(await this.pc.createOffer());if(this.ended)return;this.options.callbacks.offer({type:'offer',sdp:this.pc.localDescription!.sdp});
  }catch{this.fail('准备');}
 }
 private startDecoder(){
  const {camera,microphone}=this.options.media;if(!camera&&!microphone)throw new Error('No consented input');
  const args=['-v','error','-nostdin','-threads','2','-protocol_whitelist','file,pipe','-max_alloc','67108864','-f','matroska','-probesize','32768','-analyzeduration','100000','-i','pipe:0'];
  if(camera)args.push('-map','0:v:0','-vf','scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2','-fps_mode','passthrough','-pix_fmt','rgba','-c:v','rawvideo','-threads','2','-f','rawvideo','pipe:1');
  if(microphone)args.push('-map','0:a:0','-ac','2','-ar','48000','-c:a','pcm_s16le','-f','s16le','pipe:3');
  this.decoder=this.spawn(args,'incoming-decoder',['pipe',camera?'pipe':'ignore','ignore',microphone?'pipe':'ignore']);this.decoder.stdin!.on('error',()=>{if(!this.ended)this.fail('输入');});
  if(camera)this.decoder.stdout!.on('data',(chunk:Buffer)=>{if(this.ended)return;this.pendingVideo=Buffer.concat([this.pendingVideo,chunk]);while(this.pendingVideo.length>=frameBytes){this.latestVideo=Buffer.from(this.pendingVideo.subarray(0,frameBytes));this.pendingVideo=this.pendingVideo.subarray(frameBytes);this.videoAt=performance.now();this.decodedFrames++;}});
  if(microphone)(this.decoder.stdio[3] as Readable).on('data',(chunk:Buffer)=>{if(this.ended)return;this.decodedPcmBytes+=chunk.length;this.audioAt=performance.now();this.audio=Buffer.concat([this.audio,chunk]);if(this.audio.length>48000)this.audio=this.audio.subarray(this.audio.length-48000+(4-(this.audio.length-48000)%4)%4);});
  const tracks=[...(microphone?[{kind:'audio' as const,codec:'OPUS' as const,clockRate:48000,trackNumber:1}]:[]),...(camera?[{kind:'video' as const,codec:'MPEG4/ISO/AVC' as const,clockRate:90000,trackNumber:2,width:640,height:360}]:[])];
  this.webm=new WebmCallback(tracks);this.webm.pipe(async out=>{if(!out.saveToFile||this.ended||!this.decoder?.stdin||this.decoder.stdin.destroyed)return;if(!this.decoder.stdin.write(out.saveToFile)){this.pendingWriteAt=performance.now();await new Promise<void>(resolve=>{const done=()=>{stream.off('drain',done);stream.off('close',done);resolve();},stream=this.decoder!.stdin!;stream.once('drain',done);stream.once('close',done);});this.pendingWriteAt=0;}});
 }
 private attach(track:MediaStreamTrack){
  const allowed=track.kind==='video'?this.options.media.camera:this.options.media.microphone;if(!allowed){track.stop();return;}
  const rate=track.kind==='video'?90000:48000,time=new RtpTimeCallback(rate),depay=new DepacketizeCallback(track.kind==='video'?'MPEG4/ISO/AVC':'opus',track.kind==='video'?{isFinalPacketInSequence:h=>h.marker}:{}),jitter=track.kind==='video'?new JitterBufferCallback(rate):null;
  if(jitter)jitter.pipe(time.input);time.pipe(depay.input);depay.pipe(input=>{if(this.ended)return;if(track.kind==='video')this.webm?.inputVideo(input);else this.webm?.inputAudio(input);});
  track.onReceiveRtp.subscribe(packet=>{if(this.ended||!packet.payload.length)return;const at=performance.now();if(at-this.rateAt>=1000){this.rateAt=at;this.rateBytes=0;this.ratePackets=0;}this.rateBytes+=packet.payload.length;this.ratePackets++;if(this.rateBytes>2097152||this.ratePackets>2000||this.pendingWriteAt&&at-this.pendingWriteAt>2000){this.fail('接收速率或背压');return;}if(track.kind==='video')this.packets.video++;else this.packets.audio++;const input={rtp:packet.clone()};if(jitter)jitter.input(input);else time.input(input);});
 }
 private async startReturn(){
  const socket=dgram.createSocket('udp4');this.returnSocket=socket;socket.on('error',()=>this.fail('返听'));socket.on('message',(bytes,rinfo)=>{if(this.ended||this.pc.connectionState!=='connected'||rinfo.address!=='127.0.0.1')return;try{const packet=RtpPacket.deSerialize(bytes);if(packet.payload.length>2000)return;this.audioTrack.writeRtp(packet);}catch{this.fail('返听数据');}});await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.bind(0,'127.0.0.1',()=>{socket.off('error',reject);resolve();});});
  const port=(socket.address() as{port:number}).port,args=['-v','error','-nostdin','-threads','1','-f','s16le','-ar','48000','-ac','2','-i','pipe:0','-vn','-c:a','libopus','-application','lowdelay','-frame_duration','20','-b:a','64000','-payload_type','111','-f','rtp','rtp://127.0.0.1:'+port+'?pkt_size=1200'];this.returnEncoder=this.spawn(args,'mix-minus-return',['pipe','ignore','ignore']);this.returnEncoder.stdin!.on('error',()=>{if(!this.ended)this.fail('返听输入');});
 }
 async answer(sdp:string){if(this.ended)return;if(this.answerApplied)return;this.answerApplied=true;try{const local=sdp.split('\r\n').filter(line=>!line.startsWith('a=candidate:')&&!line.startsWith('a=remote-candidates:')).join('\r\n');await this.pc.setRemoteDescription({type:'answer',sdp:local});}catch{this.fail('协商');}}
 pushVideoRtp(packet:RtpPacket){if(!this.ended&&this.pc.connectionState==='connected')this.videoTrack.writeRtp(packet.clone());}
 pushReturn(pcm:Buffer){if(this.ended||!this.returnEncoder?.stdin||this.returnEncoder.stdin.destroyed)return;if(pcm.length!==8000||this.returnEncoder.stdin.writableLength>48000){this.fail('返听背压');return;}this.returnEncoder.stdin.write(pcm);}
 consume(){const at=performance.now(),video=this.latestVideo&&at-this.videoAt<500?this.latestVideo:null,pcm=Buffer.alloc(8000);let samples=0;if(at-this.audioAt<500&&this.audio.length>=8000){this.audio.copy(pcm,0,0,8000);this.audio=this.audio.subarray(8000);samples=2000;}else if(at-this.audioAt>=500)this.audio=Buffer.alloc(0);return{rgba:video,pcm,audioSamples:samples};}
 statistics():ProgrammePeerStats{const at=performance.now();return{state:this.pc.connectionState,rtpAudio:this.packets.audio,rtpVideo:this.packets.video,decodedFrames:this.decodedFrames,decodedPcmBytes:this.decodedPcmBytes,videoReady:!!this.latestVideo&&at-this.videoAt<500,audioReady:this.decodedPcmBytes>=8000&&at-this.audioAt<500,decoderPid:this.decoder?.pid||null,returnEncoderPid:this.returnEncoder?.pid||null};}
 get stopped(){return this.ended;}
 stop(reason='本次节目音视频连接已结束。'){
  if(this.stopPromise)return this.stopPromise;this.ended=true;this.options.signal.removeEventListener('abort',this.abort);if(this.timer)clearInterval(this.timer);this.webm?.destroy();this.latestVideo=null;this.audio=Buffer.alloc(0);this.pendingVideo=Buffer.alloc(0);
  this.stopPromise=(async()=>{const socket=this.returnSocket;this.returnSocket=null;if(socket)await new Promise<void>(r=>{try{socket.close(()=>r());}catch{r();}});this.videoTrack.stop();this.audioTrack.stop();try{await this.pc.close();}finally{await Promise.all(this.native.map(child=>new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null){resolve();return;}child.once('close',()=>resolve());child.stdin?.destroy();child.kill('SIGKILL');})));this.options.callbacks.closed(reason+(this.failureAt?'（'+this.failureAt+'）':''));}})();return this.stopPromise;
 }
}
