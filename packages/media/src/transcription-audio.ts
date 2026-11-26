import fs from 'node:fs/promises';
import {AppError} from '@digitalguide/domain';
import {mediaTools,runMediaTool} from './media-tools.js';
import {mp4InputOptions} from './video-source.js';
import {fileDigest} from './files.js';
export async function inspectTranscriptionAudio(file:string,signal?:AbortSignal){
  signal?.throwIfAborted();const size=(await fs.stat(file)).size;if(size<44||size>19201024)throw new AppError('TRANSCRIPTION_AUDIO_LIMIT','转写声音为空或超过10分钟的16kHz单声道限制，请缩短区间。',409);const b=await fs.readFile(file);if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.readUInt32LE(4)+8!==b.length)throw new AppError('TRANSCRIPTION_AUDIO_INVALID','转写声音不是完整PCM WAV。',409);
  let position=12,dataSize=0,valid=false,count=0;while(position+8<=b.length){if(++count>64)throw new AppError('TRANSCRIPTION_AUDIO_INVALID','声音头部格式不受支持。',409);const length=b.readUInt32LE(position+4),begin=position+8,end=begin+length;if(end>b.length)throw new AppError('TRANSCRIPTION_AUDIO_INVALID','声音分块不完整。',409);const tag=b.toString('ascii',position,position+4);if(tag==='fmt '){if(valid||length<16||b.readUInt16LE(begin)!==1||b.readUInt16LE(begin+2)!==1||b.readUInt32LE(begin+4)!==16000||b.readUInt32LE(begin+8)!==32000||b.readUInt16LE(begin+12)!==2||b.readUInt16LE(begin+14)!==16)throw new AppError('TRANSCRIPTION_AUDIO_INVALID','转写声音须为16kHz单声道16位PCM。',409);valid=true;}if(tag==='data')dataSize+=length;position=end+(length%2);}
  if(!valid||position!==b.length||dataSize%2||dataSize<3200||dataSize>19200000)throw new AppError('TRANSCRIPTION_AUDIO_INVALID','所选区间没有至少100毫秒的完整声音，或超出10分钟，请调整区间。',409);return{durationMs:Math.round(dataSize/32),sampleRate:16000,channels:1,...await fileDigest(file,signal)};
}
export async function extractTranscriptionAudio(input:{root:string;file:string;destination:string;startMs:number;durationMs:number;signal:AbortSignal}){
  await runMediaTool(mediaTools(input.root).ffmpeg,['-v','error','-nostdin','-n','-threads','2','-xerror',...mp4InputOptions,'-i',input.file,'-ss',(input.startMs/1000).toFixed(3),'-t',(input.durationMs/1000).toFixed(3),'-map','0:a:0','-vn','-c:a','pcm_s16le','-ar','16000','-ac','1','-map_metadata','-1','-fflags','+bitexact','-flags:a','+bitexact','-fs','19201025',input.destination],input.signal,120000);const result=await inspectTranscriptionAudio(input.destination,input.signal);if(result.durationMs>input.durationMs+50)throw new AppError('TRANSCRIPTION_AUDIO_RANGE','解码声音超出已确认区间，未开始识别。',409);return result;
}
