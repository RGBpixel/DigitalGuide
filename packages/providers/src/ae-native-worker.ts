import fs from 'node:fs';
import {performAeRender,AeRenderError,type AeRenderInput} from './ae-render.js';
import {mediaTools,runMediaTool} from '../../media/src/media-tools.js';
// Server-written request inside this attempt's private directory. No HTTP command is accepted.
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8')) as {input:AeRenderInput;resultFile:string;progressFile:string};
try{
 const result=await performAeRender(request.input,new AbortController().signal,stage=>fs.appendFileSync(request.progressFile,JSON.stringify({stage})+'\n'));
 await runMediaTool(mediaTools(request.input.root).ffmpeg,['-v','error','-nostdin','-max_alloc','67108864','-i',result.video,'-map','0:v:0','-map','0:a?','-f','null','-'],undefined,620000);
 fs.writeFileSync(request.resultFile,JSON.stringify({result,fullDecodeVerified:true}),{flag:'wx',mode:0o600});
}catch(e){fs.writeFileSync(request.resultFile,JSON.stringify({error:{code:e instanceof AeRenderError?e.code:'AE_RENDER_FAILED',message:e instanceof AeRenderError?e.message:'受控AE工程处理失败，请核对固定输入、许可和部署。'}}),{flag:'wx',mode:0o600});process.exitCode=1;}
