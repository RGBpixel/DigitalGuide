import {LiveGuestProgrammeHub} from './live-guest-programme-hub.js';
import {LiveOutputEncoder} from './live-output-encoder.js';
import {LiveOutputRenderer,type LiveOutputRenderInput,type OutputInstruction} from './live-output-render.js';
const abort=new AbortController();let hub:LiveGuestProgrammeHub|undefined;let renderer:LiveOutputRenderer|undefined,encoder:LiveOutputEncoder|undefined,started=false,working=false,ending=false,index=0,due=0;
const send=(message:unknown)=>{if(process.connected)process.send?.(message);};
async function shutdown(){abort.abort();await hub?.stop();await encoder?.stop();await renderer?.dispose();if(process.connected)process.disconnect();}
process.once('disconnect',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
async function end(){if(working||ending)return;ending=true;try{await encoder?.finish();send({type:'complete',acceptedFrames:encoder?.acceptedFrames||0,encodedFrames:encoder?.encodedFrames||0,helperPid:process.pid,helperEntry:process.argv[1]||''});}catch{send({type:'error',message:'连续媒体编码未能安全结束。'});}finally{await hub?.stop();await renderer?.dispose();if(process.connected)process.disconnect();}}
process.on('message',async(message:{type:'init';input:LiveOutputRenderInput}|{type:'frame';instruction:OutputInstruction}|{type:'finish'}|{type:'cancel'})=>{
 if(message.type==='cancel'){await shutdown();return;}
 if(message.type==='finish'){if(working){ending=true;return;}await end();return;}
 try{
  if(message.type==='init'){
   if(started)return;started=true;renderer=new LiveOutputRenderer(message.input,abort.signal);const preparing=setInterval(()=>send({type:'preparing'}),1000);try{await renderer.prepare();}finally{clearInterval(preparing);}if(message.input.guestProgramme)hub=new LiveGuestProgrammeHub(message.input.root,message.input.directory,abort.signal,value=>send({type:'programme',value}));const rtp=hub?await hub.ready():undefined;encoder=new LiveOutputEncoder(message.input.root,message.input.directory,abort.signal,p=>send({type:'progress',...p}),rtp);due=Date.now();send({type:'ready',helperPid:process.pid,helperEntry:process.argv[1]||''});send({type:'request',index});return;
  }
  if(!encoder||!renderer||working||ending||message.instruction.index!==index)throw new Error('连续媒体输入顺序错误。');working=true;
  hub?.sync(message.instruction.programme||[]);const materials=hub?.consume()||[],rendered=await renderer.render(message.instruction,materials);await encoder.write(rendered.rgba,rendered.pcm);hub?.returns(rendered.programmeBasePcm||rendered.pcm,materials,rendered.frame.muted);send({type:'accepted',index,sourceReady:rendered.sourceReady,frame:rendered.frame});index++;working=false;
  if(ending){ending=false;await end();return;}due+=1000/24;if(Date.now()-due>1000)due=Date.now();await new Promise(resolve=>setTimeout(resolve,Math.max(0,due-Date.now())));if(!ending&&!abort.signal.aborted)send({type:'request',index});
 }catch{working=false;send({type:'error',message:'连续媒体画面、音频或编码输入失败。'});abort.abort();await hub?.stop();await encoder?.stop();await renderer?.dispose();if(process.connected)process.disconnect();}
});
