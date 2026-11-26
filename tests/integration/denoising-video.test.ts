import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {it,expect} from 'vitest';
import {mediaProcessingPayload} from '@digitalguide/contracts';
import {mediaTools,runMediaTool} from '../../packages/media/src/media-tools.js';
import {inspectVideoSource} from '../../packages/media/src/video-source.js';
import {inspectAlphaVideoSource} from '../../packages/media/src/alpha-video-source.js';
import {denoisingModel} from '../../packages/media/src/denoising-model.js';
import {processLocalMedia} from '../../packages/media/src/media-processing.js';
it.each([false,true])('视频神经降噪保持全部帧、44.1k双声道和Alpha=%s',async alpha=>{
 const root=process.cwd(),directory=path.resolve('storage/test-runs',randomUUID());fs.mkdirSync(directory,{recursive:true});const tools=mediaTools(root),file=path.join(directory,alpha?'source.mov':'source.mp4');await runMediaTool(tools.ffmpeg,['-v','error','-nostdin','-n','-f','lavfi','-i',alpha?'color=c=black@0:s=320x320:r=3:d=1,format=rgba,drawbox=x=50:y=50:w=120:h=180:c=red@0.5:t=fill:replace=1':'color=c=green:s=320x320:r=3:d=1','-f','lavfi','-i','anoisesrc=color=pink:sample_rate=44100:duration=1:amplitude=0.02:seed=17','-map','0:v:0','-map','1:a:0',...(alpha?['-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','16']:['-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p']),'-threads','2','-c:a','aac','-ar','44100','-ac','2',file]);
 const signal=new AbortController().signal,inspection=alpha?await inspectAlphaVideoSource(file,path.join(directory,'source-inspect'),root,signal,()=>{}):await inspectVideoSource(file,path.join(directory,'source-inspect'),root,signal,()=>{}),bytes=fs.readFileSync(file),payload=mediaProcessingPayload.parse({name:'真实神经原声处理视频',source:{id:randomUUID(),version:1,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,mediaType:alpha?'video/quicktime':'video/mp4',name:'原创透明色块与噪声',specs:inspection.specs,expiresAt:null,synthetic:true},configuration:{provider:'local-media',operation:'neural_denoise',startMs:0,durationMs:null,attenuationDb:100,postFilter:true},engine:denoisingModel(root).engine,rights:{subject:'原创合成作者',proof:'代码生成合成色块、透明度及固定种子噪声，只验证实际文件格式与时序。',expiresAt:'2099-01-01T00:00:00.000Z',confirmed:true}}),result=await processLocalMedia({root,payload,file,directory:path.join(directory,'processed')},signal,()=>{}),output=result.files[0];expect(output.specs).toMatchObject({width:320,height:320,fps:3,durationMs:1000,sampleRate:44100,channels:2});expect(output.alpha).toBe(alpha);const frames=[];
 for(const [i,source]of [file,output.file].entries()){const raw=path.join(directory,'frame-'+i+'.png');await runMediaTool(tools.ffmpeg,['-v','error','-nostdin','-n','-i',source,'-frames:v','1','-update','1','-pix_fmt','rgba',raw]);frames.push(PNG.sync.read(fs.readFileSync(raw)));}
 if(alpha){let different=0;for(let i=3;i<frames[0].data.length;i+=4)if(frames[0].data[i]!==frames[1].data[i])different++;expect(different).toBe(0);expect(frames[1].data[3]).toBe(0);expect(frames[1].data[(100*320+100)*4+3]).toBeGreaterThan(100);}else expect(frames[1].data[1]).toBeGreaterThan(80);
},60000);
