import { createCanvas, loadImage, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import type { StudioDocument, StudioElement } from '@digitalguide/contracts';
import type { TimelineVideoFrames } from './timeline-video-sources.js';
import { wrapText,textFont } from './text-layout.js';
import {drawCaption,segmentCaptionBox} from './caption-layout.js';
export function drawText(ctx: SKRSContext2D, text: string, x: number, y: number, width: number, height: number, fontSize: number, color: string, family: string, bold = false, align: 'left' | 'center' | 'right' = 'left') {
  if (width <= 0 || height <= 0 || fontSize <= 0) return;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip(); ctx.font = textFont(fontSize,family,bold); ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = align;
  const lines = wrapText(text, width, value => ctx.measureText(value).width), metrics = lines.filter(Boolean).map(line => ctx.measureText(line));
  const ascent = Math.max(0, ...metrics.map(m => m.actualBoundingBoxAscent)), descent = Math.max(0, ...metrics.map(m => m.actualBoundingBoxDescent)), step = Math.max(fontSize * 1.35, ascent + descent);
  let currentY = y; const currentX = align === 'left' ? x : align === 'center' ? x + width / 2 : x + width; for (const line of lines) { if (currentY >= y + height) break; if (line) ctx.fillText(line, currentX, currentY + ascent); currentY += step; } ctx.restore();
}
function drawImage(ctx: SKRSContext2D, image: Image, x: number, y: number, width: number, height: number, fit: 'contain' | 'cover') {
  const ratio = fit === 'contain' ? Math.min(width / image.width, height / image.height) : Math.max(width / image.width, height / image.height), w = image.width * ratio, h = image.height * ratio;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip(); ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h); ctx.restore();
}
export async function renderStoryboard(doc: StudioDocument, segmentId: string, getImage: (reference: { assetId?: string; importMediaId?: string }) => Buffer,videos?: TimelineVideoFrames) {
  if (doc.timeline) { const { createTimelineRenderer } = await import('./timeline-frame.js'),{ segmentTimelineStart } = await import('../../domain/src/timeline.js'),segment = doc.segments.find(s => s.id === segmentId)!,time = segmentTimelineStart(doc,segmentId)+Math.min(500,Math.floor(segment.durationMs/2)),renderer = await createTimelineRenderer(doc,getImage,640,time,time+1,undefined,videos),frame = await renderer.renderAsync(time);return { bytes: await frame.canvas.encode('png'),width: frame.width,height: frame.height }; }
  const segment = doc.segments.find(s => s.id === segmentId)!, scale = Math.min(640 / doc.canvas.width, 640 / doc.canvas.height), width = Math.round(doc.canvas.width * scale), height = Math.round(doc.canvas.height * scale), canvas = createCanvas(width, height), ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
  const w = doc.canvas.width, h = doc.canvas.height; if (!doc.canvas.transparent) { ctx.fillStyle = segment.backgroundColor; ctx.fillRect(0, 0, w, h); }
  const images = new Map<string, Image>();
  async function image(reference: { assetId?: string; importMediaId?: string }) { const key = reference.assetId || reference.importMediaId!; let loaded = images.get(key); if (!loaded) { loaded = await loadImage(getImage(reference)); images.set(key, loaded); } return loaded; }
  for (const e of [...segment.elements].sort((a, b) => a.zIndex - b.zIndex)) {
    const x = e.x * w, y = e.y * h, ew = e.width * w, eh = e.height * h; ctx.save(); ctx.globalAlpha = e.opacity;
    if (e.type === 'text') drawText(ctx, e.text, x, y, ew, eh, e.fontSize, e.color, doc.brand.fontFamily, e.bold, e.align);
    else if (e.type === 'shape') { ctx.fillStyle = e.fill; if (e.shape === 'ellipse') { ctx.beginPath(); ctx.ellipse(x + ew / 2, y + eh / 2, ew / 2, eh / 2, 0, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(x, y, ew, eh); }
    else await drawImage(ctx, await image({ assetId: e.assetId || undefined, importMediaId: e.importMediaId || undefined }), x, y, ew, eh, e.fit); ctx.restore();
  }
  const speaker = doc.speakers.find(s => s.id === segment.speakerId);
  if (speaker?.avatarAssetId) { const box = segment.avatar; drawImage(ctx, await image({ assetId: speaker.avatarAssetId }), box.x * w, box.y * h, box.width * w, box.height * h, 'contain'); drawText(ctx, '静态形象参考', box.x * w, (box.y + box.height - 0.045) * h, box.width * w, 0.04 * h, Math.max(12, h * 0.02), doc.brand.textColor, 'sans'); }
  if (doc.brand.logoAssetId) drawImage(ctx, await image({ assetId: doc.brand.logoAssetId }), w * 0.84, h * 0.035, w * 0.12, h * 0.09, 'contain');
  if (segment.text) { const box=segmentCaptionBox(doc,segment.text);ctx.fillStyle = '#FFFFFFDE'; ctx.fillRect(w * 0.035, h * 0.84, w * 0.93, h * 0.105);drawCaption(ctx,{...box,x:w*.055+box.x,y:h*.855+box.y},Math.min(500,Math.floor(segment.durationMs/2)),segment.durationMs,doc.brand.textColor); }
  drawText(ctx, '分镜预览 · 静态参考', w * 0.64, h * 0.96, w * 0.33, h * 0.035, Math.max(12, h * 0.019), '#627768', 'sans', false, 'right');
  return { bytes: await canvas.encode('png'), width, height };
}
export function segmentImageReferences(doc: StudioDocument, segmentId: string) { const segment = doc.segments.find(s => s.id === segmentId)!; return segment.elements.filter((e): e is Extract<StudioElement, { type: 'image' }> => e.type === 'image'); }
