import type {LivePuppetSettings} from '@digitalguide/contracts';
// The mouth follows only this frame's actual programme PCM, never music or text length.
export function livePuppetMouthLevel(pcm:Buffer,gain:number){
 if(pcm.length!==8000||!Number.isFinite(gain)||gain<0||gain>1)throw new Error('二维口部需要单帧48kHz双声道16位节目PCM与有效音量。');let energy=0;for(let i=0;i<4000;i++){const value=pcm.readInt16LE(i*2)/32768*gain;energy+=value*value;}const rms=Math.sqrt(energy/4000);return rms<.005?0:Math.round(Math.min(1,rms*8)*16)/16;
}
export function livePuppetLayout(placement:LivePuppetSettings['placement']){if(!['left','right'].includes(placement))throw new Error('二维直播位置无效。');return{x:placement==='left'?24:872,y:90,width:384,height:576,textX:placement==='left'?448:56,textWidth:748};}
