import type { Asset,StudioDocument,TimelineClip } from '@digitalguide/contracts';
import {isVideoMediaType} from '@digitalguide/contracts';
import { useEffect,useRef,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { activeTimelineClips,speakerStatesAt,transformAt,visualOpacityAt } from '../../../../packages/domain/src/timeline.js';
import { imageSource } from './shared.js';
function AlphaFrame({id,position,fps,fit,label}:{id:string;position:number;fps:number;fit:'contain'|'cover';label:string}){
  const target=useRef(position),[url,setUrl]=useState(''),[error,setError]=useState('');target.current=position;
  useEffect(()=>{const abort=new AbortController();let busy=false,last=-1,currentURL='';const read=async()=>{const frame=Math.floor(Math.max(0,target.current)*fps/1000);if(busy||frame===last)return;busy=true;try{const response=await fetch('/api/v1/assets/'+id+'/frame?timeMs='+Math.max(0,target.current),{credentials:'same-origin',signal:abort.signal});if(!response.ok){if(response.status!==429)setError('透明帧暂不可用，请暂停定位或检查素材权限。');return;}const blob=await response.blob();if(abort.signal.aborted)return;const next=URL.createObjectURL(blob),old=currentURL;currentURL=next;setUrl(next);setError('');last=frame;if(old)URL.revokeObjectURL(old);}catch{if(!abort.signal.aborted)setError('透明帧读取失败，请暂停后重试。');}finally{busy=false;}};void read();const timer=setInterval(()=>void read(),250);return()=>{clearInterval(timer);abort.abort();if(currentURL)URL.revokeObjectURL(currentURL);};},[id,fps]);
  return <>{url&&<img src={url} alt={label+'透明定位帧'} style={{width:'100%',height:'100%',objectFit:fit}}/>}{error&&<small role="status">{error}</small>}</>;
}
function TimelineAsset({ id,clip,timeMs,label }: { id: string;clip: TimelineClip;timeMs: number;label: string }) {
  const asset = useQuery({ queryKey: ['timeline-asset',id],queryFn: () => api<Asset>('/assets/'+id),staleTime: 60000 }),video = useRef<HTMLVideoElement|null>(null),[ready,setReady] = useState(false),isVideo = isVideoMediaType(asset.data?.mediaType);
  const sourceMs = clip.sourceInMs+(timeMs-clip.startMs)*clip.playbackRate,durationMs = asset.data?.specs.durationMs || 0,position = clip.loop && durationMs ? sourceMs%durationMs : sourceMs;
  useEffect(() => { const el = video.current;if (el && ready && position >= 0 && position < durationMs && Math.abs(el.currentTime-position/1000) > 0.03) el.currentTime = position/1000; },[position,ready,durationMs]);
  if (asset.error) return <span>素材不可用，请检查权限或重新选择。</span>;
  if (!asset.data) return <span>正在读取素材…</span>;
  if(asset.data.mediaType==='video/quicktime')return position>=durationMs?null:<AlphaFrame id={id} position={position} fps={asset.data.specs.fps} fit={clip.fit} label={label}/>;
  if (isVideo) return position >= durationMs ? null : <video ref={video} muted playsInline preload="metadata" src={'/api/v1/assets/'+id+'/content'} poster={'/api/v1/assets/'+id+'/poster'} aria-label={label+'视频布局'} onLoadedMetadata={() => setReady(true)} style={{ width: '100%',height: '100%',objectFit: clip.fit }}/>;
  return <img src={'/api/v1/assets/'+id+'/content'} alt={label} style={{ width: '100%',height: '100%',objectFit: clip.fit }}/>;
}
export function TimelineCanvas({ document: doc,timeMs }: { document: StudioDocument;timeMs: number }) {
  const states = speakerStatesAt(doc,timeMs);
  function contents(c: TimelineClip) {
    const segment = doc.segments.find(s => s.id === c.segmentId),speaker = doc.speakers.find(s => s.id === c.speakerId);
    if (c.source.type === 'color') return <div className="timeline-fill" style={{ background: c.source.color }}/>;
    if (c.source.type === 'segment_background') return <div className="timeline-fill" style={{ background: doc.canvas.transparent ? 'transparent' : segment?.backgroundColor }}/>;
    if (c.source.type === 'shape') return <div className="timeline-fill" style={{ background: c.source.color,borderRadius: c.source.shape === 'ellipse' ? '50%' : 0 }}/>;
    if (c.source.type === 'text') return <div style={{ fontSize: c.source.fontSize/doc.canvas.width*100+'cqw',color: c.source.color,fontWeight: c.source.bold ? 700 : 400,textAlign: c.source.align,whiteSpace: 'pre-wrap' }}>{c.source.text}</div>;
    if (c.source.type === 'segment_subtitle') return <div className="timeline-subtitle" style={{ fontSize: Math.max(16,doc.canvas.height*0.027)/doc.canvas.width*100+'cqw',color: doc.brand.textColor }}>{segment?.text}</div>;
    if (c.source.type === 'segment_elements') return <>{segment?.elements.slice().sort((a,b) => a.zIndex-b.zIndex).map(e => <div className="studio-layer" key={e.id} style={{ left: e.x*100+'%',top: e.y*100+'%',width: e.width*100+'%',height: e.height*100+'%',opacity: e.opacity,zIndex: e.zIndex,...(e.type === 'shape' ? { background: e.fill,borderRadius: e.shape === 'ellipse' ? '50%' : 0 } : {}) }}>{e.type === 'text' ? <div style={{ fontSize: e.fontSize/doc.canvas.width*100+'cqw',color: e.color,textAlign: e.align,fontWeight: e.bold ? 700 : 400 }}>{e.text}</div> : e.type === 'image' ? <img src={imageSource(e)} alt="画面素材" style={{ objectFit: e.fit }}/> : null}</div>)}</>;
    if (c.source.type === 'asset' || c.source.type === 'segment_avatar' || c.source.type === 'speaker_avatar') { const assetId = c.source.type === 'asset' ? c.source.assetId : speaker?.avatarAssetId,state = c.speakerId ? states[c.speakerId] || 'silent' : null;return <>{assetId && <TimelineAsset key={assetId} id={assetId} clip={c} timeMs={timeMs} label={speaker ? speaker.name+'静态参考' : '画面素材'}/>} {state && <span className={'timeline-speaker-tag '+state}>{speaker?.name} · {{ speaking: '发言',listening: '倾听',silent: '静默' }[state]}</span>}</>; }
    return null;
  }
  return <div className="timeline-canvas" role="img" aria-label="时间线无声布局预览" style={{ aspectRatio: doc.canvas.width+'/'+doc.canvas.height,fontFamily: doc.brand.fontFamily === 'serif' ? 'serif' : 'sans-serif' }}>{activeTimelineClips(doc,timeMs).filter(a => !['voice','music'].includes(a.track.type) && !a.track.muted && !a.clip.muted).map(({ clip: c,localMs },i) => { const t = transformAt(c,localMs),progress = c.transitionMs ? Math.min(1,(localMs+c.curveOffsetMs)/c.transitionMs) : 1;return <div key={c.id} className="timeline-visual" style={{ left: t.x*100+'%',top: t.y*100+'%',width: t.width*100+'%',height: t.height*100+'%',transform: `rotate(${t.rotation}deg)`,opacity: visualOpacityAt(c,localMs),filter: `brightness(${c.color.brightness}) contrast(${c.color.contrast}) saturate(${c.color.saturation})`,zIndex: i,clipPath: c.transitionIn === 'wipe' ? `inset(0 ${(1-progress)*100}% 0 0)` : undefined }}><div className="timeline-crop" style={{ left: -c.crop.left/(1-c.crop.left-c.crop.right)*100+'%',top: -c.crop.top/(1-c.crop.top-c.crop.bottom)*100+'%',width: 100/(1-c.crop.left-c.crop.right)+'%',height: 100/(1-c.crop.top-c.crop.bottom)+'%' }}>{contents(c)}</div></div>; })}{doc.brand.logoAssetId && <img className="studio-logo" src={'/api/v1/assets/'+doc.brand.logoAssetId+'/content'} alt="品牌标志"/>}<span className="studio-board-label">无声编辑布局 · 生成视频后核对声画</span></div>;
}
