import path from 'node:path';
import dgram from 'node:dgram';
import {randomInt} from 'node:crypto';
import {RtpPacket} from 'werift';
import {LiveGuestProgrammePeer,type ProgrammePeerStats} from './live-guest-programme-peer.js';
export interface ProgrammeRuntimeInstruction{id:string;grantId:string;runtimeToken:string;controlVersion:number;consentHash:string;publicName:string;camera:boolean;microphone:boolean;recordingAllowed:boolean;expiresAt:string;leaseExpiresAt:string;mixState:'preview'|'on_air'|'off_air';audioMuted:boolean;videoHidden:boolean;answer:string|null}
export type ProgrammeRuntimeMessage={type:'offer';id:string;runtimeToken:string;offer:{type:'offer';sdp:string}}|{type:'stats';id:string;runtimeToken:string;stats:ProgrammePeerStats}|{type:'closed';id:string;runtimeToken:string;reason:string};
export interface ProgrammeMaterial{instruction:ProgrammeRuntimeInstruction;rgba:Buffer|null;pcm:Buffer;audioSamples:number}
export function mixProgrammePcm(base:Buffer,contributors:Buffer[],muted=false){const result=Buffer.alloc(8000);if(muted)return result;for(let i=0;i<4000;i++){let v=base.readInt16LE(i*2);for(const pcm of contributors)v+=pcm.readInt16LE(i*2);result.writeInt16LE(Math.max(-32768,Math.min(32767,v)),i*2);}return result;}
export class LiveGuestProgrammeHub{
 private entries=new Map<string,{instruction:ProgrammeRuntimeInstruction;peer:LiveGuestProgrammePeer}>();private videoSocket=dgram.createSocket('udp4');private permissionAt=performance.now();private ended=false;private timer:ReturnType<typeof setInterval>;private target:{port:number;ssrc:number}|null=null;private stopping:Promise<void>|null=null;
 constructor(private root:string,private directory:string,private signal:AbortSignal,private message:(value:ProgrammeRuntimeMessage)=>void){
  this.videoSocket.on('error',()=>{void this.stop('节目返程视频服务已停止。');});this.videoSocket.on('message',(bytes,remote)=>{if(this.ended||remote.address!=='127.0.0.1'||bytes.length>2000)return;try{const packet=RtpPacket.deSerialize(bytes);if(packet.header.ssrc!==this.target?.ssrc)return;for(const entry of this.entries.values())if(this.valid(entry.instruction))entry.peer.pushVideoRtp(packet);}catch{/* Only the private native RTP tap is accepted. */}});
  this.timer=setInterval(()=>{if(this.ended)return;if(performance.now()-this.permissionAt>5000){void this.stop('节目授权控制连接中断，设备节目连接已关闭。');return;}for(const entry of this.entries.values())if(!this.valid(entry.instruction))void entry.peer.stop('本次节目设备授权或心跳已到期。');},200);signal.addEventListener('abort',this.abort,{once:true});
 }
 private abort=()=>{void this.stop('节目媒体进程已停止。');};
 private valid(i:ProgrammeRuntimeInstruction){return Date.parse(i.expiresAt)>Date.now()&&Date.parse(i.leaseExpiresAt)>Date.now();}
 async ready(){await new Promise<void>((resolve,reject)=>{this.videoSocket.once('error',reject);this.videoSocket.bind(0,'127.0.0.1',()=>{this.videoSocket.off('error',reject);resolve();});});this.videoSocket.setRecvBufferSize(4*1024*1024);this.target={port:(this.videoSocket.address() as{port:number}).port,ssrc:randomInt(1,0x100000000)};return this.target;}
 sync(instructions:ProgrammeRuntimeInstruction[]){
  if(this.ended)return;this.permissionAt=performance.now();if(instructions.length>3){void this.stop('节目来宾数量超过当前限额。');return;}const ids=new Set(instructions.map(i=>i.id));for(const[id,entry]of this.entries)if(!ids.has(id)){void entry.peer.stop('本次节目设备连接已结束。');this.entries.delete(id);}
  for(const instruction of instructions){if(!this.valid(instruction))continue;let entry=this.entries.get(instruction.id);if(entry){if(entry.instruction.runtimeToken!==instruction.runtimeToken){void entry.peer.stop('节目媒体代次已变化。');continue;}entry.instruction=instruction;if(instruction.answer)void entry.peer.answer(instruction.answer);continue;}
   const send=(value:ProgrammeRuntimeMessage)=>{if(!this.ended)this.message(value);},peer=new LiveGuestProgrammePeer({root:this.root,directory:path.join(this.directory,'programme-peer-'+instruction.id),media:{camera:instruction.camera,microphone:instruction.microphone},signal:this.signal,callbacks:{offer:offer=>send({type:'offer',id:instruction.id,runtimeToken:instruction.runtimeToken,offer}),stats:stats=>send({type:'stats',id:instruction.id,runtimeToken:instruction.runtimeToken,stats}),closed:reason=>send({type:'closed',id:instruction.id,runtimeToken:instruction.runtimeToken,reason})}});entry={instruction,peer};this.entries.set(instruction.id,entry);void peer.start();
  }
 }
 consume():ProgrammeMaterial[]{return[...this.entries.values()].filter(entry=>!entry.peer.stopped&&this.valid(entry.instruction)).map(entry=>({instruction:entry.instruction,...entry.peer.consume()}));}
 returns(base:Buffer,materials:ProgrammeMaterial[],muted:boolean){for(const entry of this.entries.values()){if(entry.peer.stopped||!this.valid(entry.instruction))continue;const contributors=materials.filter(m=>m.instruction.id!==entry.instruction.id&&m.instruction.mixState==='on_air'&&m.instruction.microphone&&!m.instruction.audioMuted).map(m=>m.pcm);entry.peer.pushReturn(mixProgrammePcm(base,contributors,muted));}}
 stop(reason='节目来宾服务已结束。'){if(this.stopping)return this.stopping;this.ended=true;clearInterval(this.timer);this.signal.removeEventListener('abort',this.abort);this.stopping=(async()=>{await Promise.allSettled([...this.entries.values()].map(entry=>entry.peer.stop(reason)));this.entries.clear();await new Promise<void>(resolve=>{try{this.videoSocket.close(()=>resolve());}catch{resolve();}});})();return this.stopping;}
}
