// Real browser MediaRecorder encoding of entirely synthetic pixels/audio; no media device calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {probeLocalMedia} from '../packages/media/src/media-tools.js';
import {inspectRecordingSource} from '../packages/media/src/recording-source.js';
const folder=path.resolve(process.argv[2]||'docs/evidence/T24/recording/native-fixture-first');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'browser-original.webm');assert.ok(!fs.existsSync(file),'Choose a fresh folder.');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:5174/');
  const encoded=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d')!,stream=canvas.captureStream(25),audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain(),destination=audio.createMediaStreamDestination();gain.gain.value=.2;osc.connect(gain);gain.connect(destination);osc.start();await audio.resume();stream.addTrack(destination.stream.getAudioTracks()[0]);const chunks:Blob[]=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:2500000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};const closed=new Promise<void>(resolve=>{recorder.onstop=()=>resolve();});let n=0;const draw=setInterval(()=>{ctx.fillStyle=n++%2?'#2040e0':'#e03020';ctx.fillRect(0,0,640,360);},40);recorder.start(1000);await new Promise(resolve=>setTimeout(resolve,2400));recorder.stop();await closed;clearInterval(draw);stream.getTracks().forEach(t=>t.stop());await audio.close();const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return{base64:btoa(text),nativeMediaRecorder:true,size:bytes.length};});
  fs.writeFileSync(file,Buffer.from(encoded.base64,'base64'));const inputProbe=await probeLocalMedia(file);
  let result:unknown;try{const converted=await inspectRecordingSource(file,folder,process.cwd(),new AbortController().signal,()=>{});result={result:'PASS',actualBrowserMediaRecorder:true,noPhysicalDevices:true,size:encoded.size,inputProbe,converted};}catch(error){result={result:'FAIL',actualBrowserMediaRecorder:true,noPhysicalDevices:true,size:encoded.size,inputProbe,error:error instanceof Error?error.message:String(error)};process.exitCode=1;}
  fs.writeFileSync(path.join(folder,'proof.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
