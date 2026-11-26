import type {Page} from '@playwright/test';
interface Probe {mode:'allow'|'denied'|'late'|'no-system';cameraCalls:number;screenCalls:number;tracks:MediaStreamTrack[];screen?:MediaStream;releaseLate?:()=>void;freeze:()=>void}
declare global {interface Window {__dgRecording:Probe}}
// Test-only native canvas tracks and oscillator audio. Never request physical devices.
export async function syntheticRecordingDevices(page:Page){await page.addInitScript(()=>{
  const timers:ReturnType<typeof setInterval>[]=[],probe:Probe={mode:'allow',cameraCalls:0,screenCalls:0,tracks:[],freeze:()=>timers.forEach(clearInterval)};window.__dgRecording=probe;
  function stream(kind:'camera'|'screen',audio:boolean){
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d')!;let frame=0;const draw=()=>{context.fillStyle=kind==='camera'?'#2040e0':'#e03020';context.fillRect(0,0,640,360);context.fillStyle='#20e060';context.fillRect((frame++*8)%560,15,60,30);};draw();const timer=setInterval(draw,40),result=canvas.captureStream(25);timers.push(timer);let sound:AudioContext|undefined;
    if(audio){sound=new AudioContext();const oscillator=sound.createOscillator(),gain=sound.createGain(),destination=sound.createMediaStreamDestination();oscillator.frequency.value=kind==='camera'?440:660;gain.gain.value=.2;oscillator.connect(gain);gain.connect(destination);oscillator.start();void sound.resume();result.addTrack(destination.stream.getAudioTracks()[0]);}
    for(const track of result.getTracks()){probe.tracks.push(track);const stop=track.stop.bind(track);track.stop=()=>{stop();if(result.getTracks().every(t=>t.readyState==='ended')){clearInterval(timer);void sound?.close().catch(()=>{});}};}
    if(kind==='screen')probe.screen=result;return result;
  }
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async(options:MediaStreamConstraints)=>{probe.cameraCalls++;if(probe.mode==='denied')throw new DOMException('Synthetic denied','NotAllowedError');const result=stream('camera',!!options.audio);if(probe.mode==='late')await new Promise<void>(resolve=>{probe.releaseLate=resolve;});if(!options.video)result.getVideoTracks().forEach(t=>{t.stop();result.removeTrack(t);});return result;}});
  Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async(options:DisplayMediaStreamOptions)=>{probe.screenCalls++;if(probe.mode==='denied')throw new DOMException('Synthetic screen denied','NotAllowedError');return stream('screen',!!options.audio&&probe.mode!=='no-system');}});
});}
