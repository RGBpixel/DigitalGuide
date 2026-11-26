import { z } from 'zod';
const id = z.uuid(), ms = z.int().min(0).max(10800000), color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const timelineTransform = z.strictObject({ x: z.number().min(-2).max(2),y: z.number().min(-2).max(2),width: z.number().min(0.005).max(3),height: z.number().min(0.005).max(3),rotation: z.number().min(-360).max(360),opacity: z.number().min(0).max(1) });
export const timelineSource = z.discriminatedUnion('type',[
  z.strictObject({ type: z.enum(['segment_background','segment_elements','segment_avatar','speaker_avatar','segment_narration','segment_subtitle']) }),
  z.strictObject({ type: z.literal('asset'),assetId: id }),
  z.strictObject({ type: z.literal('text'),text: z.string().max(4000),fontSize: z.int().min(8).max(200),color,bold: z.boolean(),align: z.enum(['left','center','right']) }),
  z.strictObject({ type: z.literal('color'),color }),
  z.strictObject({ type: z.literal('shape'),shape: z.enum(['rectangle','ellipse']),color })
]);
export const timelineClipSchema = z.strictObject({
  id,name: z.string().trim().min(1).max(100),segmentId: id.nullable(),speakerId: id.nullable(),linked: z.boolean(),
  startMs: ms,durationMs: z.int().min(100).max(10800000),sourceInMs: ms,playbackRate: z.number().min(0.25).max(4),source: timelineSource,
  curveOffsetMs: ms,curveDurationMs: z.int().min(100).max(10800000),
  transform: timelineTransform,keyframes: z.array(timelineTransform.extend({ timeMs: ms,easing: z.enum(['linear','hold']) })).max(100),
  crop: z.strictObject({ left: z.number().min(0).max(0.99),top: z.number().min(0).max(0.99),right: z.number().min(0).max(0.99),bottom: z.number().min(0).max(0.99) }),
  fit: z.enum(['contain','cover']),muted: z.boolean(),volume: z.number().min(0).max(2),loop: z.boolean(),
  envelope: z.array(z.strictObject({ timeMs: ms,gain: z.number().min(0).max(2) })).max(100),
  fadeInMs: ms,fadeOutMs: ms,transitionIn: z.enum(['none','fade','wipe']),transitionMs: ms,
  color: z.strictObject({ brightness: z.number().min(0).max(2),contrast: z.number().min(0).max(2),saturation: z.number().min(0).max(2) }),
  actorState: z.enum(['auto','speaking','listening','silent']),voiceRole: z.enum(['dialogue','narration'])
});
export const timelineTrackSchema = z.strictObject({ id,type: z.enum(['avatar','background','voice','music','subtitle','overlay']),name: z.string().trim().min(1).max(50),order: z.int().min(0).max(100),locked: z.boolean(),muted: z.boolean(),clips: z.array(timelineClipSchema).max(300) });
export const studioTimeline = z.strictObject({ schemaVersion: z.literal(1),snapMs: z.int().min(0).max(1000),tracks: z.array(timelineTrackSchema).min(6).max(24) });
export type TimelineClip = z.infer<typeof timelineClipSchema>;
export type TimelineTrack = z.infer<typeof timelineTrackSchema>;
export type StudioTimeline = z.infer<typeof studioTimeline>;
export type TimelineTransform = z.infer<typeof timelineTransform>;
export interface TimelineSuggestion { id: string; segmentId: string; kind: 'duration'|'callout'|'emphasis'|'background'; title: string; reason: string; durationMs?: number; text?: string;assetId?: string; source: 'local_rules'; requiresReview: true }
