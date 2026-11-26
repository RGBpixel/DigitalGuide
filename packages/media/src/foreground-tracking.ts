import {AppError} from '@digitalguide/domain';
import type {SubjectTrackingSettings,TrackingTraceFrame} from '@digitalguide/contracts';

const side=320,pixels=side*side;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
type Box={x:number;y:number;width:number;height:number};
interface Component{box:Box;cx:number;cy:number;area:number;probability:number;mask:Uint8Array;hist:Float64Array}
function invalid(message:string){return new AppError('TRACKING_INVALID_FRAME',message,409);}
function candidates(prediction:Float32Array,rgba:Uint8Array,width:number,height:number,threshold:number){
 if(prediction.length!==pixels||rgba.length!==width*height*4)throw invalid('实际跟踪帧或遮罩尺寸不符，未登记结果。');let lo=Infinity,hi=-Infinity;for(const value of prediction){if(!Number.isFinite(value))throw invalid('跟踪遮罩出现无效数值，未登记结果。');lo=Math.min(lo,value);hi=Math.max(hi,value);}if(hi-lo<1e-7)return[];
 const binary=new Uint8Array(pixels),visited=new Uint8Array(pixels),queue=new Uint32Array(pixels),result:Component[]=[];
 for(let i=0;i<pixels;i++){const x=i%side,y=Math.floor(i/side),source=(Math.min(height-1,Math.floor((y+.5)*height/side))*width+Math.min(width-1,Math.floor((x+.5)*width/side)))*4;binary[i]=(prediction[i]-lo)/(hi-lo)>=threshold&&rgba[source+3]>=32?1:0;}
 for(let seed=0;seed<pixels;seed++){
  if(!binary[seed]||visited[seed])continue;let read=0,count=1,minX=side,minY=side,maxX=0,maxY=0,cx=0,cy=0,probability=0;queue[0]=seed;visited[seed]=1;
  while(read<count){const at=queue[read++],x=at%side,y=Math.floor(at/side);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);cx+=x+.5;cy+=y+.5;probability+=(prediction[at]-lo)/(hi-lo);for(const next of [x?at-1:-1,x<side-1?at+1:-1,y?at-side:-1,y<side-1?at+side:-1])if(next>=0&&binary[next]&&!visited[next]){visited[next]=1;queue[count++]=next;}}
  if(count<80)continue;if(result.length>=48)throw invalid('显著前景过于零碎，请选择更清楚的片段或使用手工构图。');const mask=new Uint8Array(pixels),hist=new Float64Array(12);for(let n=0;n<count;n++){const at=queue[n];mask[at]=1;const x=at%side,y=Math.floor(at/side),source=(Math.min(height-1,Math.floor((y+.5)*height/side))*width+Math.min(width-1,Math.floor((x+.5)*width/side)))*4;for(let channel=0;channel<3;channel++)hist[channel*4+Math.min(3,Math.floor(rgba[source+channel]/64))]+=1/(count*3);}
  result.push({box:{x:minX/side,y:minY/side,width:(maxX-minX+1)/side,height:(maxY-minY+1)/side},cx:cx/count/side,cy:cy/count/side,area:count,probability:probability/count,mask,hist});
 }
 return result;
}
function thumbnail(rgba:Uint8Array,width:number,height:number){const result=new Float32Array(16*16*3);for(let y=0;y<16;y++)for(let x=0;x<16;x++){const at=(Math.min(height-1,Math.floor((y+.5)*height/16))*width+Math.min(width-1,Math.floor((x+.5)*width/16)))*4;for(let c=0;c<3;c++)result[(y*16+x)*3+c]=rgba[at+c]*rgba[at+3]/(255*255);}return result;}
function difference(a:Float64Array,b:Float64Array){let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/2;}
function overlap(a:Component,b:Component){let intersection=0;for(let i=0;i<pixels;i++)if(a.mask[i]&&b.mask[i])intersection++;return intersection/(a.area+b.area-intersection);}

export class ForegroundTracker{
 private previous:Component|null=null;private previousTime=0;private lastSeen=0;private vx=0;private vy=0;private crop:Box|null=null;private thumb:Float32Array|null=null;
 constructor(private readonly settings:SubjectTrackingSettings,private readonly width:number,private readonly height:number,private readonly threshold=.5){}
 update(prediction:Float32Array,rgba:Uint8Array,timeMs:number,frame:number):TrackingTraceFrame{
  if(!Number.isFinite(timeMs)||timeMs<0||frame<0||!Number.isInteger(frame)||this.previous&&timeMs<=this.previousTime)throw invalid('跟踪帧时钟无效或没有递增。');const components=candidates(prediction,rgba,this.width,this.height,this.threshold),thumb=thumbnail(rgba,this.width,this.height);if(this.thumb){let change=0;for(let i=0;i<thumb.length;i++)change+=Math.abs(thumb[i]-this.thumb[i])/thumb.length;if(change>.32)throw new AppError('TRACKING_SCENE_CHANGED','画面发生明显切换，已停止跟踪。请从新镜头重新点选主体。',409);}this.thumb=thumb;
  if(this.previous&&this.previousTime!==this.lastSeen&&timeMs-this.lastSeen>this.settings.maxLostMs)throw new AppError('TRACKING_TARGET_LOST','目标失锁已超过允许等待时间，请重新点选；没有自动切换到其他候选。',409);
  let target:Component|undefined,confidence=0;
  if(!this.previous){const index=clamp(Math.floor(this.settings.seed.y*side),0,side-1)*side+clamp(Math.floor(this.settings.seed.x*side),0,side-1);target=components.find(c=>c.mask[index]);if(!target)throw new AppError('TRACKING_SEED_BACKGROUND','起始点没有落在可分离前景上，请查看区间起始帧并重新点选主体内部。',409);confidence=target.probability;}
  else{
   const prior=this.previous,elapsed=Math.max(1,timeMs-this.lastSeen)/1000,predX=prior.cx+this.vx*Math.min(elapsed,.5),predY=prior.cy+this.vy*Math.min(elapsed,.5),gate=Math.min(.3,Math.max(.1,.3*Math.hypot(prior.box.width,prior.box.height),Math.hypot(this.vx,this.vy)*elapsed*2+.05)),ranked=components.map(c=>{const distance=Math.hypot(c.cx-predX,c.cy-predY),appearance=difference(c.hist,prior.hist),ratio=c.area/prior.area;return{c,distance,appearance,ratio,cost:.4*distance/gate+.3*(1-overlap(c,prior))+.2*appearance+.1*Math.abs(Math.log(ratio))/Math.log(2)};}).filter(v=>v.distance<=gate&&v.appearance<=.38&&v.ratio>=.4&&v.ratio<=2.2).sort((a,b)=>a.cost-b.cost);
   if(ranked.length&&(!ranked[1]||ranked[1].cost-ranked[0].cost>=.12)){target=ranked[0].c;confidence=clamp(1-ranked[0].cost,0,1);}
   if(!target&&timeMs-this.lastSeen>this.settings.maxLostMs)throw new AppError('TRACKING_TARGET_LOST','目标已丢失或有多个相近候选，超过允许等待时间；没有自动切换到其他主体。请缩短片段或重新选择起始点。',409);
  }
  const dt=this.previous?timeMs-this.previousTime:0;
  if(target){
   if(this.previous){const elapsed=Math.max(1,timeMs-this.lastSeen)/1000;this.vx=clamp((target.cx-this.previous.cx)/elapsed,-1,1);this.vy=clamp((target.cy-this.previous.cy)/elapsed,-1,1);}this.crop=this.nextCrop(target.box,dt);this.previous=target;this.lastSeen=timeMs;
  }
  this.previousTime=timeMs;return{frame,timeMs:Math.round(timeMs),status:target?'tracking':'holding',confidence,target:target?{...target.box}:null,crop:{...this.crop!}};
 }
 private nextCrop(box:Box,dt:number):Box{
  const w=this.width,h=this.height,ratio={landscape:16/9,portrait:9/16,square:1}[this.settings.aspect],padding=this.settings.padding,baseWidth=Math.min(w,h*ratio),required=Math.max(baseWidth,box.width*w*(1+padding*2),box.height*h*(1+padding*2)*ratio),alpha=this.settings.responseMs?1-Math.exp(-dt/this.settings.responseMs):1,previous=this.crop,priorWidth=previous?previous.width*w:required,cropW=Math.max(required,priorWidth+(required-priorWidth)*alpha),cropH=cropW/ratio,desiredX=(box.x+box.width/2)*w,desiredY=(box.y+box.height/2)*h;
  let cx=previous?(previous.x+previous.width/2)*w+(desiredX-(previous.x+previous.width/2)*w)*alpha:desiredX,cy=previous?(previous.y+previous.height/2)*h+(desiredY-(previous.y+previous.height/2)*h)*alpha:desiredY;
  cx=clamp(cx,(box.x+box.width*(1+padding))*w-cropW/2,(box.x-box.width*padding)*w+cropW/2);cy=clamp(cy,(box.y+box.height*(1+padding))*h-cropH/2,(box.y-box.height*padding)*h+cropH/2);cx=cropW<=w?clamp(cx,cropW/2,w-cropW/2):w/2;cy=cropH<=h?clamp(cy,cropH/2,h-cropH/2):h/2;
  return{x:(cx-cropW/2)/w,y:(cy-cropH/2)/h,width:cropW/w,height:cropH/h};
 }
}

// Premultiplied-alpha bilinear sampling prevents hidden source RGB from becoming visible at edges.
export function renderTrackedCrop(source:Uint8Array,width:number,height:number,crop:Box,outWidth:number,outHeight:number,transparent:boolean){
 if(source.length!==width*height*4||![crop.x,crop.y,crop.width,crop.height].every(Number.isFinite)||crop.width<=0||crop.height<=0)throw invalid('跟踪构图或原帧无效。');const output=Buffer.alloc(outWidth*outHeight*4);
 for(let y=0;y<outHeight;y++)for(let x=0;x<outWidth;x++){
  const sx=(crop.x+(x+.5)*crop.width/outWidth)*width-.5,sy=(crop.y+(y+.5)*crop.height/outHeight)*height-.5,at=(y*outWidth+x)*4;if(sx<-.5||sy<-.5||sx>=width-.5||sy>=height-.5){output[at+3]=transparent?0:255;continue;}const px=clamp(sx,0,width-1),py=clamp(sy,0,height-1),x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),dx=px-x0,dy=py-y0;let alpha=0,r=0,g=0,b=0;
  for(const [xx,yy,weight]of [[x0,y0,(1-dx)*(1-dy)],[x1,y0,dx*(1-dy)],[x0,y1,(1-dx)*dy],[x1,y1,dx*dy]]){const from=(yy*width+xx)*4,a=source[from+3]/255*weight;alpha+=a;r+=source[from]*a;g+=source[from+1]*a;b+=source[from+2]*a;}
  const divisor=transparent&&alpha>0?alpha:1;output[at]=Math.round(r/divisor);output[at+1]=Math.round(g/divisor);output[at+2]=Math.round(b/divisor);output[at+3]=transparent?Math.round(alpha*255):255;
 }
 return output;
}

