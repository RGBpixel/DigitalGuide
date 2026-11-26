import { createCanvas,loadImage,type Image,type Canvas } from '@napi-rs/canvas';
import type { StudioDocument,TimelineClip } from '@digitalguide/contracts';
import { activeTimelineClips,speakerStatesAt,transformAt,visualOpacityAt } from '../../domain/src/timeline.js';
import { drawText } from './storyboard-preview.js';
import {drawCaption,clipCaptionBox} from './caption-layout.js';
import type { TimelineVideoFrames } from './timeline-video-sources.js';
export interface TimelineImageReference { assetId?: string; importMediaId?: string }
export function timelineImageReferences(doc: StudioDocument,startMs = 0,endMs = 10800000) {
  const refs = new Map<string,TimelineImageReference>();const add = (r: TimelineImageReference) => { const id = r.assetId || r.importMediaId;if (id) refs.set(id,r); };
  if (doc.brand.logoAssetId) add({ assetId: doc.brand.logoAssetId });
  for (const t of doc.timeline?.tracks || []) if (!t.muted && !['voice','music'].includes(t.type)) for (const c of t.clips) {
    if (c.muted) continue;
    if (c.startMs >= endMs || c.startMs+c.durationMs <= startMs) continue;
    if (c.source.type === 'asset') add({ assetId: c.source.assetId });
    if (c.source.type === 'segment_avatar' || c.source.type === 'speaker_avatar') { const speaker = doc.speakers.find(s => s.id === c.speakerId);if (speaker?.avatarAssetId) add({ assetId: speaker.avatarAssetId }); }
    if (c.source.type === 'segment_elements') for (const e of doc.segments.find(s => s.id === c.segmentId)?.elements || []) if (e.type === 'image') add({ assetId: e.assetId || undefined,importMediaId: e.importMediaId || undefined });
  }return [...refs.values()];
}
export async function createTimelineRenderer(doc: StudioDocument,getImage: (ref: TimelineImageReference) => Buffer,longestEdge = 640,startMs = 0,endMs = 10800000,output?: { width: number;height: number;flatten: boolean;referenceLabels?: boolean },videos?: TimelineVideoFrames) {
  if (!doc.timeline) throw new Error('请先启用专业时间线。');
  const scale = output ? Math.min(output.width/doc.canvas.width,output.height/doc.canvas.height) : Math.min(longestEdge/doc.canvas.width,longestEdge/doc.canvas.height),width = output?.width || Math.max(2,Math.round(doc.canvas.width*scale/2)*2),height = output?.height || Math.max(2,Math.round(doc.canvas.height*scale/2)*2),contentWidth = output ? doc.canvas.width*scale : width,contentHeight = output ? doc.canvas.height*scale : height,padX = (width-contentWidth)/2,padY = (height-contentHeight)/2,canvas = createCanvas(width,height),ctx = canvas.getContext('2d');
  const images = new Map<string,Image>(),imagePixels = new Map<string,number>(),videoFrames = new Map<string,Canvas>();let pixels = 0;
  async function prepare(refs: TimelineImageReference[]) {
    const required = new Set(refs.map(r => (r.assetId || r.importMediaId)!));
    for (const r of refs) { const id = (r.assetId || r.importMediaId)!;if (images.has(id)) continue;
      const bytes = getImage(r);if (bytes.length < 24 || !bytes.subarray(1,4).equals(Buffer.from('PNG'))) throw new Error('时间线仅支持受控 PNG 图片。');
      const count = bytes.readUInt32BE(16)*bytes.readUInt32BE(20);
      for (const old of images.keys()) { if (pixels+count <= 32000000) break;if (!required.has(old)) { pixels -= imagePixels.get(old)!;images.delete(old);imagePixels.delete(old); } }
      if (pixels+count > 32000000) throw new Error('同时显示的图片总像素超过三千二百万，请压缩或拆分画面。');
      images.set(id,await loadImage(bytes));imagePixels.set(id,count);pixels += count;
    }
  }
  const imageRefs = (start: number,end: number) => timelineImageReferences(doc,start,end).filter(r => !r.assetId || !videos?.has(r.assetId));
  if (!output) await prepare(imageRefs(startMs,endMs));
  const layer = createCanvas(width,height),paint = layer.getContext('2d');
  function source(c: TimelineClip,timeMs: number,trackType:string) {
    layer.width = Math.max(2,Math.ceil(contentWidth*c.transform.width));layer.height = Math.max(2,Math.ceil(contentHeight*c.transform.height));
    paint.resetTransform();paint.clearRect(0,0,layer.width,layer.height);const segment = doc.segments.find(s => s.id === c.segmentId),w = layer.width,h = layer.height;
    if (c.source.type === 'color') { paint.fillStyle = c.source.color;paint.fillRect(0,0,w,h); }
    else if (c.source.type === 'segment_background' && segment) { if (!doc.canvas.transparent) { paint.fillStyle = segment.backgroundColor;paint.fillRect(0,0,w,h); } }
    else if ((c.source.type === 'text'&&trackType==='subtitle')||(c.source.type==='segment_subtitle'&&segment)) {const box=clipCaptionBox(doc,c);if(c.source.type==='segment_subtitle'){paint.fillStyle='#FFFFFFDB';paint.fillRect(0,0,w,h);}if(box){paint.save();paint.scale(scale,scale);drawCaption(paint,box,timeMs-c.startMs+c.curveOffsetMs,c.curveDurationMs,c.source.type==='text'?c.source.color:doc.brand.textColor);paint.restore();}}
    else if (c.source.type === 'text') { const s = c.source;drawText(paint,s.text,0,0,w,h,s.fontSize*scale,s.color,doc.brand.fontFamily,s.bold,s.align); }
    else if (c.source.type === 'shape') { paint.fillStyle = c.source.color;if (c.source.shape === 'ellipse') { paint.beginPath();paint.ellipse(w/2,h/2,w/2,h/2,0,0,Math.PI*2);paint.fill(); } else paint.fillRect(0,0,w,h); }
    else if (c.source.type === 'asset' || c.source.type === 'segment_avatar' || c.source.type === 'speaker_avatar') {
      const speaker = doc.speakers.find(s => s.id === c.speakerId),id = c.source.type === 'asset' ? c.source.assetId : speaker?.avatarAssetId,im = c.source.type === 'asset' && videos?.has(c.source.assetId) ? videoFrames.get(c.id) : id ? images.get(id) : null;
      if (im) { const ratio = c.fit === 'contain' ? Math.min(w/im.width,h/im.height) : Math.max(w/im.width,h/im.height),iw = im.width*ratio,ih = im.height*ratio;paint.drawImage(im,(w-iw)/2,(h-ih)/2,iw,ih); }
      if (c.speakerId && output?.referenceLabels !== false) { const state = speakerStatesAt(doc,timeMs)[c.speakerId] || 'silent',name = speaker?.name || '角色',label = { speaking: '发言',listening: '倾听',silent: '静默' }[state];paint.fillStyle = '#FFFFFFDD';paint.fillRect(0,h-18,w,18);drawText(paint,name+' · '+label+' · 静态参考',4,h-17,w-8,18,Math.max(8,12*scale),'#173E33','sans',state === 'speaking');if (state === 'speaking') { paint.strokeStyle = '#C29A41';paint.lineWidth = 4;paint.strokeRect(2,2,w-4,h-4); } }
    } else if (c.source.type === 'segment_elements' && segment) {
      for (const e of segment.elements.slice().sort((a,b) => a.zIndex-b.zIndex)) { const x = e.x*w,y = e.y*h,ew = e.width*w,eh = e.height*h;paint.save();paint.globalAlpha = e.opacity;
        if (e.type === 'text') drawText(paint,e.text,x,y,ew,eh,e.fontSize*w/doc.canvas.width,e.color,doc.brand.fontFamily,e.bold,e.align);
        else if (e.type === 'shape') { paint.fillStyle = e.fill;if (e.shape === 'ellipse') { paint.beginPath();paint.ellipse(x+ew/2,y+eh/2,ew/2,eh/2,0,0,Math.PI*2);paint.fill(); } else paint.fillRect(x,y,ew,eh); }
        else { const im = images.get((e.assetId || e.importMediaId)!);if (im) { const ratio = e.fit === 'contain' ? Math.min(ew/im.width,eh/im.height) : Math.max(ew/im.width,eh/im.height),iw = im.width*ratio,ih = im.height*ratio;paint.beginPath();paint.rect(x,y,ew,eh);paint.clip();paint.drawImage(im,x+(ew-iw)/2,y+(eh-ih)/2,iw,ih); } }paint.restore();
      }
    }
  }
  function render(timeMs: number,watermark = true) {
    ctx.resetTransform();ctx.clearRect(0,0,width,height);if (output?.flatten || !doc.canvas.transparent) { ctx.fillStyle = '#FFFFFF';ctx.fillRect(0,0,width,height); }
    for (const { track,clip,localMs } of activeTimelineClips(doc,timeMs)) {
      if (['voice','music'].includes(track.type) || track.muted || clip.muted) continue;
      source(clip,timeMs,track.type);const t = transformAt(clip,localMs),x = padX+t.x*contentWidth,y = padY+t.y*contentHeight,w = t.width*contentWidth,h = t.height*contentHeight,sourceX = clip.crop.left*layer.width,sourceY = clip.crop.top*layer.height,sourceW = (1-clip.crop.left-clip.crop.right)*layer.width,sourceH = (1-clip.crop.top-clip.crop.bottom)*layer.height;
      ctx.save();ctx.globalAlpha = visualOpacityAt(clip,localMs);ctx.filter = `brightness(${clip.color.brightness}) contrast(${clip.color.contrast}) saturate(${clip.color.saturation})`;ctx.translate(x+w/2,y+h/2);ctx.rotate(t.rotation*Math.PI/180);
      if (clip.transitionIn === 'wipe' && clip.transitionMs) { const progress = Math.max(0,Math.min(1,(localMs+clip.curveOffsetMs)/clip.transitionMs));ctx.beginPath();ctx.rect(-w/2,-h/2,w*progress,h);ctx.clip(); }
      ctx.drawImage(layer,sourceX,sourceY,sourceW,sourceH,-w/2,-h/2,w,h);ctx.restore();
    }
    if (doc.brand.logoAssetId) { const logo = images.get(doc.brand.logoAssetId);if (logo) ctx.drawImage(logo,padX+contentWidth*0.84,padY+contentHeight*0.035,contentWidth*0.12,contentHeight*0.09); }
    if (watermark) drawText(ctx,'时间线预览 · 静态参考 / 素材混音',width*0.42,height-12,width*0.56,12,8,'#627768','sans',false,'right');
    return { canvas,width,height };
  }
  async function renderAsync(timeMs: number,watermark = true) {
    if (output) await prepare(imageRefs(timeMs,timeMs+0.001));
    if (videos) { const active = activeTimelineClips(doc,timeMs).filter(a => !a.track.muted && !a.clip.muted && !['voice','music'].includes(a.track.type) && a.clip.source.type === 'asset' && videos.has(a.clip.source.assetId));if (active.length > 4) throw new Error('本地同时最多四条视频画面，请减少重叠视频。');const ids = new Set(active.map(a => a.clip.id));await videos.releaseExcept(ids);for (const id of videoFrames.keys()) if (!ids.has(id)) videoFrames.delete(id);for (const {clip} of active) { const frame = await videos.frame(clip,timeMs);if (frame) videoFrames.set(clip.id,frame);else videoFrames.delete(clip.id); } }
    return render(timeMs,watermark);
  }
  return { render,renderAsync,width,height };
}
