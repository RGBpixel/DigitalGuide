import fs from 'node:fs';
import {renderLiveRecording,type LiveRecordingRenderInput} from './live-recording-render.js';
const request=process.argv[2];if(!request||fs.statSync(request).size>2097152)throw new Error('Invalid private timeline request');
const value=JSON.parse(fs.readFileSync(request,'utf8'))as{input:LiveRecordingRenderInput;resultFile:string;inputHash:string};
const result=await renderLiveRecording(value.input,new AbortController().signal);fs.writeFileSync(value.resultFile,JSON.stringify({...result,inputHash:value.inputHash})+'\n',{flag:'wx',mode:0o600});
