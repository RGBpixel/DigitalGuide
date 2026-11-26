import type {RecordingConfiguration} from '@digitalguide/contracts';
import {beginLocalRecording,appendLocalRecording,finishLocalRecording,removeLocalRecording} from './recording-local.js';
export type CapturePhase='idle'|'requesting'|'preview'|'recording'|'paused'|'stopping'|'ready'|'error';
export interface CaptureState {phase:CapturePhase;stream:MediaStream|null;blob:Blob|null;fileName:string;elapsedMs:number;bytes:number;message:string;error:string;localSaved:boolean;version:number|null}
const initial=():CaptureState=>({phase:'idle',stream:null,blob:null,fileName:'',elapsedMs:0,bytes:0,message:'',error:'',localSaved:false,version:null});
export const recordingMimeTypes=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/mp4;codecs=avc1.42001E,mp4a.40.2','video/webm','video/mp4'];
export function recordingDeviceError(error:unknown){const name=error instanceof DOMException?error.name:'';if(name==='NotAllowedError'||name==='SecurityError')return'设备或屏幕共享未获允许。可重新点击开启、在浏览器修改权限，或上传已有WebM/MP4。';if(name==='NotFoundError')return'未找到所选摄像头/麦克风，请连接设备、选择其他来源或上传已有录制。';if(name==='NotReadableError')return'设备正被其他程序占用或无法读取，请关闭占用程序后重试。';return error instanceof Error?error.message:'录制无法启动，请检查浏览器支持或上传已有录制。';}
export class BrowserRecording {
  state=initial();private epoch=0;private tracks=new Set<MediaStreamTrack>();private videos:HTMLVideoElement[]=[];private context:AudioContext|null=null;private mixerNodes:AudioNode[]=[];private drawTimer:ReturnType<typeof setInterval>|undefined;private clock:ReturnType<typeof setInterval>|undefined;private flushTimer:ReturnType<typeof setTimeout>|undefined;private recorder:MediaRecorder|null=null;private activeStart=0;private activeMs=0;
  constructor(private publish:(state:CaptureState)=>void){}
  private durations=new WeakMap<MediaRecorder,number>();
  private elapsed(){return Math.round(this.activeMs+(this.recorder?.state==='recording'?performance.now()-this.activeStart:0));}
  private update(patch:Partial<CaptureState>){this.state={...this.state,...patch};this.publish(this.state);}
  private release(){clearInterval(this.drawTimer);clearInterval(this.clock);clearTimeout(this.flushTimer);this.drawTimer=undefined;this.clock=undefined;this.flushTimer=undefined;for(const track of this.tracks){track.onended=null;track.stop();}this.tracks.clear();for(const video of this.videos){video.pause();video.srcObject=null;video.remove();}this.videos=[];for(const node of this.mixerNodes)node.disconnect();this.mixerNodes=[];void this.context?.close().catch(()=>{});this.context=null;}
  close(){this.epoch++;if(this.recorder&&this.recorder.state!=='inactive'){this.durations.set(this.recorder,this.elapsed());this.recorder.stop();}this.recorder=null;this.release();this.state=initial();}
  private own(stream:MediaStream,epoch:number){if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());throw new Error('开启操作已取消；迟到的设备已关闭。');}for(const t of stream.getTracks()){this.tracks.add(t);t.onended=()=>{if(epoch!==this.epoch)return;if(this.recorder&&this.recorder.state!=='inactive')this.finish('共享或设备已停止，已保存此前的录制。');else{this.release();this.update({phase:'error',stream:null,error:'共享或设备已关闭，请明确重新开启。'});}};}return stream;}
  private async video(stream:MediaStream,epoch:number){const element=document.createElement('video');element.muted=true;element.playsInline=true;element.srcObject=stream;this.videos.push(element);await element.play();if(epoch!==this.epoch)throw new Error('设备开启已取消。');return element;}
  async open(config:RecordingConfiguration){
    this.close();const epoch=this.epoch;this.update({...initial(),phase:'requesting'});
    try{
      if(!isSecureContext||!navigator.mediaDevices||typeof MediaRecorder==='undefined')throw new Error('浏览器需在本机或HTTPS下支持设备和MediaRecorder；可改为上传已有WebM/MP4。');
      const [width,height]=config.layout==='portrait'?[720,1280]:config.layout==='square'?[720,720]:[1280,720],microphone=['microphone','mixed'].includes(config.audio),system=['system','mixed'].includes(config.audio);let screen:MediaStream|undefined,camera:MediaStream|undefined,mic:MediaStream|undefined;
      // getDisplayMedia must run directly from the user's click, before any asynchronous setup.
      if(config.source!=='camera'){if(!navigator.mediaDevices.getDisplayMedia)throw new Error('当前浏览器不支持共享屏幕，可选择摄像头或上传已有录制。');screen=this.own(await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30}},audio:system}),epoch);if(system&&!screen.getAudioTracks().length)throw new Error('所选共享来源没有提供系统声音。请重新共享带声音的标签页，或明确改选麦克风/无声后重试。');}
      if(config.source!=='screen')camera=this.own(await navigator.mediaDevices.getUserMedia({video:{width:{ideal:width},height:{ideal:height},frameRate:{ideal:30,max:30}},audio:microphone?{echoCancellation:true,noiseSuppression:true}:false}),epoch);
      else if(microphone)mic=this.own(await navigator.mediaDevices.getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:true}}),epoch);
      const audioStreams=[...(microphone?[camera||mic]:[]),...(system?[screen]:[])].filter((s):s is MediaStream=>!!s&&s.getAudioTracks().length>0);if(microphone&&!(camera||mic)?.getAudioTracks().length)throw new Error('未获得麦克风声音轨，请重新允许麦克风或明确选择无声录制。');
      let output:MediaStream;
      if(config.source==='composite'){
        const [background,face]=await Promise.all([this.video(screen!,epoch),this.video(camera!,epoch)]),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('浏览器无法建立画中画画布，请选择单一来源或上传文件。');
        const fit=(video:HTMLVideoElement,x:number,y:number,w:number,h:number)=>{if(!video.videoWidth||!video.videoHeight)return;const scale=Math.min(w/video.videoWidth,h/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale;ctx.drawImage(video,x+(w-vw)/2,y+(h-vh)/2,vw,vh);};
        const draw=()=>{ctx.fillStyle='#101318';ctx.fillRect(0,0,width,height);fit(background,0,0,width,height);const w=Math.round(width*.26),h=Math.min(Math.round(w/(face.videoWidth/face.videoHeight||1)),Math.round(height*.4)),x=config.pipCorner.endsWith('left')?16:width-w-16,y=config.pipCorner.startsWith('top')?16:height-h-16;ctx.fillStyle='#ffffff';ctx.fillRect(x-3,y-3,w+6,h+6);ctx.fillStyle='#101318';ctx.fillRect(x,y,w,h);fit(face,x,y,w,h);};draw();this.drawTimer=setInterval(draw,1000/30);output=canvas.captureStream(30);this.own(output,epoch);
      }else output=new MediaStream((camera||screen)!.getVideoTracks());
      if(audioStreams.length){this.context=new AudioContext();const destination=this.context.createMediaStreamDestination();for(const stream of audioStreams){const source=this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())),gain=this.context.createGain();gain.gain.value=1/audioStreams.length;source.connect(gain);gain.connect(destination);this.mixerNodes.push(source,gain);}destination.stream.getAudioTracks().forEach(t=>{this.tracks.add(t);output.addTrack(t);});}
      if(epoch!==this.epoch)throw new Error('设备开启已取消。');this.update({phase:'preview',stream:output,message:'设备预览已开启，尚未录制或上传。预览静音，避免回声。'});
    }catch(error){if(epoch!==this.epoch)return;this.release();this.update({phase:'error',stream:null,error:recordingDeviceError(error)});}
  }
  async start(id:string,version:number){
    if(this.state.phase!=='preview'||!this.state.stream)return;const epoch=this.epoch,stream=this.state.stream,mimeType=recordingMimeTypes.find(type=>MediaRecorder.isTypeSupported(type));if(!mimeType){this.release();this.update({phase:'error',stream:null,error:'浏览器没有可用的视频编码器，请上传已有WebM/MP4。'});return;}
    const resume=this.context?.resume();let token:string;
    try{await resume;token=await beginLocalRecording(id,version,mimeType,'recording.'+(mimeType.startsWith('video/mp4')?'mp4':'webm'));}catch(error){if(epoch===this.epoch){this.release();this.update({phase:'error',stream:null,error:recordingDeviceError(error)});}return;}
    if(epoch!==this.epoch){await removeLocalRecording(id,token);return;}
    const chunks:Blob[]=[],fileName='recording.'+(mimeType.startsWith('video/mp4')?'mp4':'webm');let writes=Promise.resolve(),writeError:unknown=null,captureError=false,parts=0,bytes=0;
    try{
      const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:2500000,audioBitsPerSecond:128000});this.recorder=recorder;this.activeMs=0;this.activeStart=performance.now();
      recorder.ondataavailable=event=>{if(!event.data.size)return;chunks.push(event.data);bytes+=event.data.size;const index=parts++;writes=writes.then(()=>appendLocalRecording(id,token,index,event.data)).catch(error=>{writeError=error;if(epoch===this.epoch)this.finish('本地恢复存储失败，请下载当前原片。');});if(epoch===this.epoch){this.update({bytes});if(bytes>=124*1024*1024)this.finish('已接近128 MB上限，录制自动停止。');}};
      recorder.onerror=()=>{captureError=true;if(epoch===this.epoch)this.finish('录制编码器报告错误，保留已录片段供核对。');};
      recorder.onstop=()=>{const durationMs=this.durations.get(recorder)??Math.max(this.elapsed(),Math.round(this.state.elapsedMs));if(epoch===this.epoch){this.release();this.update({stream:null,elapsedMs:durationMs});}void(async()=>{await writes;if(!writeError)try{await finishLocalRecording(id,token,!captureError&&epoch===this.epoch,durationMs);}catch(error){writeError=error;}if(epoch!==this.epoch)return;this.recorder=null;const blob=new Blob(chunks,{type:mimeType});this.update({phase:blob.size?'ready':'error',stream:null,blob:blob.size?blob:null,fileName,bytes:blob.size,localSaved:!writeError,error:writeError?recordingDeviceError(writeError):blob.size>134217728?'录制超过128 MB，请下载后裁剪再上传。':!blob.size?'录制没有产生有效文件，请重新录制。':'',message:this.state.message||'录制已停止。请先试听核对，再明确上传入库。'});})();};
      recorder.start(1000);this.update({phase:'recording',blob:null,fileName,elapsedMs:0,bytes:0,error:'',version,message:'正在录制。原始分片保存在本浏览器，尚未上传；声音不会从预览播放。'});
      this.clock=setInterval(()=>{if(epoch!==this.epoch)return;const elapsedMs=this.activeMs+(recorder.state==='recording'?performance.now()-this.activeStart:0);this.update({elapsedMs});if(elapsedMs>=600000)this.finish('已达到10分钟上限，录制自动停止。');},200);
    }catch(error){this.release();this.update({phase:'error',stream:null,error:recordingDeviceError(error)});}
  }
  pause(){if(this.recorder?.state!=='recording')return;this.activeMs+=performance.now()-this.activeStart;this.recorder.pause();this.update({phase:'paused',elapsedMs:this.activeMs,message:'已暂停录制；设备仍用于预览，点击停止会释放设备。'});}
  resume(){if(this.recorder?.state!=='paused')return;this.activeStart=performance.now();this.recorder.resume();this.update({phase:'recording',message:'继续录制。'});}
  finish(message='录制已停止。请试听核对后再上传入库。'){if(this.recorder&&this.recorder.state!=='inactive'){this.durations.set(this.recorder,this.elapsed());this.update({phase:'stopping',message});this.flushTimer=setTimeout(()=>{this.release();this.update({phase:'error',stream:null,error:'编码器结束未及时返回，设备已关闭。请核对本地已保存分片或重新录制。'});},2000);this.recorder.stop();}else if(this.state.phase==='requesting'||this.state.phase==='preview'){this.close();this.update({phase:'idle',message:'设备已关闭。'});}}
}
