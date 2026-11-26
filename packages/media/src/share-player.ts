import type {SharePlayer,ShareViewerState,ShareNavigation,ShareWidget} from '../../contracts/src/shares.js';

class PlayerError extends Error{constructor(public code:string,message:string){super(message);}}
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const entry=element('entry'),viewer=element('viewer'),join=element<HTMLButtonElement>('join'),entryStatus=element('entry-status'),open=element<HTMLAnchorElement>('open');
const video=element<HTMLVideoElement>('video'),widgets=element('widgets'),consent=element<HTMLInputElement>('consent'),forget=element<HTMLButtonElement>('forget'),privacyStatus=element('privacy-status'),playStatus=element('play-status');
const match=/^\/api\/v1\/external\/shares\/([a-f0-9-]{36})\/player$/.exec(location.pathname);
const base=match?'/api/v1/external/shares/'+match[1]:null,fragment=new URLSearchParams(location.hash.slice(1)).get('access'),access=fragment&&/^[a-f0-9]{64}$/.test(fragment)?fragment:undefined;
const fullUrl=location.origin+location.pathname+(access?'#access='+access:'');
// Keep bearer access only in this document's memory; never in browser storage or a query string.
if(location.hash)history.replaceState(null,'',location.pathname);
// Following a rotated link can be a same-document fragment navigation. Reload once to consume its new bearer value.
window.addEventListener('hashchange',()=>{if(location.hash)location.reload();});
open.href=fullUrl;
let data:SharePlayer|null=null,state:ShareViewerState|null=null,queue=Promise.resolve(),active='',joining=false,restoring=false;
const joinKey=crypto.randomUUID();
async function request<T>(suffix:string,body?:unknown,key?:string):Promise<T>{
 if(!base)throw new PlayerError('SHARE_URL_INVALID','分享地址不完整，请重新打开分享人提供的链接。');
 const r=await fetch(base+suffix,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':state?.csrfToken||'','Idempotency-Key':key||crypto.randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=await r.json();if(!r.ok)throw new PlayerError(json.error?.code||'REQUEST_FAILED',json.error?.message||'观看请求未完成，请稍后重试。');return json.data as T;
}
function failure(e:unknown){return e instanceof Error?e.message:'网络暂时不可用，请检查连接后重新打开分享。';}
function privacy(){
 if(!state)return;consent.checked=state.consent;consent.disabled=!state.recordingEnabled;forget.disabled=!state.consent;
 element('privacy-detail').textContent=state.recordingEnabled?'仅保存视频位置、组件编号和选项，保留'+state.retentionDays+'天；不采集姓名、摄像头或麦克风。关闭保存会清除本次记录。'+(state.consent?' 当前已保存 '+state.eventCount+' 条互动。':' 当前未开启保存。'):'分享人未开启记录。你仍可播放、切换章节和使用互动组件。';
}
function stop(e:unknown){
 video.pause();video.removeAttribute('src');video.load();viewer.hidden=true;entry.hidden=false;entryStatus.textContent=failure(e);entryStatus.classList.add('error');open.hidden=false;
}
async function recover(e:unknown){
 if(e instanceof PlayerError&&e.code==='VERSION_CONFLICT'){
  try{const current=await request<SharePlayer>('/context');state=current.state;privacy();privacyStatus.textContent='本次记录已在另一页面更新，已载入最新设置；请核对后继续。';}catch(error){stop(error);}return;
 }
 if(e instanceof PlayerError&&['SHARE_UNAVAILABLE','SHARE_SESSION_REQUIRED'].includes(e.code)){stop(e);return;}
 privacyStatus.textContent=failure(e);privacyStatus.classList.add('error');privacy();
}
function save(type:'play'|'pause'|'seek'|'ended'|'progress'|'interaction',timeMs:number,widgetId?:string,optionId?:string){
 if(!state?.consent)return;const key=crypto.randomUUID();
 queue=queue.then(async()=>{if(!state?.consent)return;state=await request<ShareViewerState>('/events',{version:state.version,type,timeMs,...(widgetId?{widgetId}:{}),...(optionId?{optionId}:{})},key);privacy();}).catch(recover);
}
const position=()=>Math.max(0,Math.min(data?.media.durationMs||0,Math.round(video.currentTime*1000)||0));
function navigate(action:ShareNavigation){
 if(action.kind==='seek'){video.currentTime=action.timeMs/1000;playStatus.textContent='已跳转到 '+(action.timeMs/1000).toFixed(1)+' 秒。';renderWidgets();}
 if(action.kind==='link'){
  const u=new URL(action.url);if(!data?.definition.linkOrigins.includes(u.origin)||!['http:','https:'].includes(u.protocol))return;
  window.open(u.href,'_blank','noopener,noreferrer');playStatus.textContent='已请求在新窗口打开 '+u.hostname+'。若未打开，请检查浏览器弹窗设置。';
 }
}
function choose(w:ShareWidget,action:ShareNavigation,optionId?:string,label?:string){
 const at=position();save('interaction',at,w.id,optionId);navigate(action);
 if(label)playStatus.textContent='已选择：'+label+(state?.consent?'。选择将保存到本次记录。':'。当前没有保存互动记录。');
}
function renderWidgets(){
 if(!data)return;const at=position(),current=data.definition.widgets.filter(w=>at>=w.startMs&&at<w.endMs),signature=current.map(w=>w.id).join('|');if(signature===active)return;active=signature;widgets.replaceChildren();
 for(const w of current){
  const box=document.createElement('div');box.className='widget';box.dataset.widgetId=w.id;box.setAttribute('role','group');box.setAttribute('aria-label',w.label);
  Object.assign(box.style,{left:w.rect.x*100+'%',top:w.rect.y*100+'%',width:w.rect.width*100+'%',height:w.rect.height*100+'%'});
  const caption=document.createElement('p');caption.textContent=w.label;box.append(caption);
  if(w.action.kind==='choice'){
   const prompt=document.createElement('p');prompt.textContent=w.action.prompt;box.append(prompt);
   for(const option of w.action.options){const b=document.createElement('button');b.type='button';b.textContent=option.label;b.addEventListener('click',()=>choose(w,option.action,option.id,option.label));box.append(b);}
  }else{const action=w.action,b=document.createElement('button');b.type='button';b.textContent=action.kind==='link'?'打开链接 ↗':'跳转观看';b.addEventListener('click',()=>choose(w,action));box.append(b);}
  widgets.append(box);
 }
}
function show(value:SharePlayer){
 data=value;state=value.state;active='initial';entry.hidden=true;viewer.hidden=false;privacyStatus.textContent='';element('title').textContent=value.title;element('description').textContent=value.description;element('disclosure').textContent=value.aiDisclosure;element('notice').textContent=value.notice;
 element('frame').style.aspectRatio=value.media.width+'/'+value.media.height;video.poster=value.posterUrl;
 const track=document.createElement('track');track.kind='subtitles';track.srclang='zh';track.label='中文字幕';track.src=value.captionUrl;video.replaceChildren(track);
 video.src=value.videoUrl;const resume=value.state.positionMs;
 video.addEventListener('loadedmetadata',()=>{if(resume>0&&resume<value.media.durationMs){restoring=true;video.currentTime=resume/1000;}renderWidgets();},{once:true});
 const chapters=element('chapters');chapters.replaceChildren();for(const c of value.definition.chapters){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=c.title+' · '+(c.timeMs/1000).toFixed(1)+'秒';b.addEventListener('click',()=>navigate({kind:'seek',timeMs:c.timeMs}));chapters.append(b);}
 privacy();renderWidgets();playStatus.textContent=resume>0?'已恢复本次观看断点。点击播放继续。':'点击播放开始观看；可随时选择章节和画面上的互动。';
 document.getElementById('generation-provenance')?.remove();
 if(value.provenance){const details=document.createElement('details');details.id='generation-provenance';details.className='privacy';const heading=document.createElement('summary');heading.textContent='查看生成来源与标识';const content=document.createElement('p');content.className='notice';content.textContent=value.provenance.label+'\n'+value.provenance.notice+'\n视频摘要：'+value.provenance.outputs.find(o=>o.kind==='video')?.sha256;details.append(heading,content);if(value.provenanceUrl){const link=document.createElement('a');link.href=value.provenanceUrl;link.textContent='下载当前来源回执';details.append(link);}viewer.append(details);}
}
join.addEventListener('click',async()=>{
 if(joining)return;joining=true;join.disabled=true;entryStatus.classList.remove('error');entryStatus.textContent='正在进入观看…';
 try{await request('/join',access?{access}:{},joinKey);try{show(await request<SharePlayer>('/context'));}catch(e){entryStatus.textContent='浏览器未保留观看会话，或分享已失效。可在新窗口打开完整链接重试。';open.hidden=false;if(!(e instanceof PlayerError&&e.code==='SHARE_SESSION_REQUIRED'))entryStatus.textContent=failure(e);}}
 catch(e){entryStatus.textContent=failure(e);entryStatus.classList.add('error');open.hidden=false;}finally{joining=false;join.disabled=false;}
});
consent.addEventListener('change',()=>{
 const enabled=consent.checked;consent.disabled=true;
 queue=queue.then(async()=>{if(!state)return;state=await request<ShareViewerState>('/consent',{version:state.version,enabled});privacyStatus.classList.remove('error');privacyStatus.textContent=enabled?'已开启本次互动记录。':'已关闭保存并清除本次记录。';privacy();}).catch(recover);
});
forget.addEventListener('click',()=>{
 forget.disabled=true;queue=queue.then(async()=>{if(!state)return;state=await request<ShareViewerState>('/forget',{version:state.version});privacyStatus.classList.remove('error');privacyStatus.textContent='本次记录已清除，后续观看不再保存。';privacy();}).catch(recover);
});
video.addEventListener('timeupdate',renderWidgets);video.addEventListener('seeking',renderWidgets);
video.addEventListener('play',()=>save('play',position()));video.addEventListener('pause',()=>save('pause',position()));video.addEventListener('seeked',()=>{if(restoring){restoring=false;return;}save('seek',position());});video.addEventListener('ended',()=>save('ended',position()));
video.addEventListener('error',()=>{if(data&&video.getAttribute('src'))playStatus.textContent='视频暂时无法播放，请刷新核对分享有效期及浏览器支持。已保存的断点仍在授权范围内保留。';});
window.setInterval(()=>{if(!video.paused&&!video.ended)save('progress',position());},5000);
void request<SharePlayer>('/context').then(show).catch(e=>{entryStatus.textContent=e instanceof PlayerError&&e.code==='SHARE_SESSION_REQUIRED'?'点击“进入观看”开始。':failure(e);if(e instanceof PlayerError&&e.code!=='SHARE_SESSION_REQUIRED')entryStatus.classList.add('error');}).finally(()=>{join.disabled=false;});
