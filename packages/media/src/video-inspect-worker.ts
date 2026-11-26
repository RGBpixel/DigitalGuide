import { inspectVideoSource } from './video-source.js';
import {inspectRecordingSource} from './recording-source.js';
import {inspectAlphaVideoSource} from './alpha-video-source.js';
import {AppError} from '@digitalguide/domain';
const controller = new AbortController();let started = false;
process.on('disconnect',() => {controller.abort();setTimeout(()=>process.exit(1),10000).unref();});
process.on('message',async (input: { file: string;directory: string;root: string;cancel?: boolean;recording?:boolean;recordingDurationMs?:number|null;alphaVideo?:boolean }) => {
  if (input.cancel) { controller.abort();return; }if (started) return;started = true;
  try { const progress=(progress:number)=>{if(process.connected)process.send?.({progress});};const result = input.alphaVideo?await inspectAlphaVideoSource(input.file,input.directory,input.root,controller.signal,progress):input.recording?await inspectRecordingSource(input.file,input.directory,input.root,controller.signal,progress,input.recordingDurationMs):await inspectVideoSource(input.file,input.directory,input.root,controller.signal,progress);if (process.connected) process.send?.({ result }); }
  catch(error) { if (process.connected) process.send?.({ error: controller.signal.aborted ? '视频检查已取消。' : input.alphaVideo&&error instanceof AppError?'透明视频：'+error.message:input.recording&&error instanceof AppError?error.message:input.alphaVideo?'透明视频检查失败；请选择128 MB内的直立ProRes 4444/4444 XQ MOV和至多一条AAC/PCM16原声。':input.recording?'录制内容不受支持、无法完整转换或超过10分钟/128 MB限制；请选择完整WebM/MP4原片重试。':'视频内容不受支持、未能完整解码或超过限制；请使用128 MB内、10分钟内的H.264/AAC MP4重试。' }); }
  finally { if (process.connected) process.disconnect(); }
});
