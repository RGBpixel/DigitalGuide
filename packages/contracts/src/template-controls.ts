import {z} from 'zod';
const id=z.uuid(),key=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,29}$/).refine(v=>!['constructor','prototype','__proto__'].includes(v),'参数名称不能使用保留字段。'),color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const templateParameterValue=z.union([z.string().max(4000),z.number().finite(),z.boolean(),z.null()]);
export const templateParameters=z.record(key,templateParameterValue).refine(v=>Object.keys(v).length<=40,'最多四十个模板参数。');
export type TemplateParameters=z.infer<typeof templateParameters>;
export const templateBinding=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('segment'),segmentId:id,field:z.enum(['title','text','notes','backgroundColor','durationMs'])}),
 z.strictObject({kind:z.literal('element'),segmentId:id,elementId:id,field:z.enum(['text','color','fill','fontSize','bold','x','y','width','height','opacity','zIndex'])}),
 z.strictObject({kind:z.literal('brand'),field:z.enum(['primaryColor','accentColor','textColor','logoAssetId'])}),
 z.strictObject({kind:z.literal('speaker_asset'),speakerId:id,field:z.enum(['avatarAssetId','voiceAssetId'])}),
 z.strictObject({kind:z.literal('clip_source'),trackId:id,clipId:id,field:z.enum(['text','color','fontSize','bold'])}),
 z.strictObject({kind:z.literal('clip_asset'),trackId:id,clipId:id}),
 z.strictObject({kind:z.literal('clip_transform'),trackId:id,clipId:id,field:z.enum(['x','y','width','height','rotation','opacity']),mode:z.enum(['set','offset_curve','scale_curve'])}),
 z.strictObject({kind:z.literal('clip_number'),trackId:id,clipId:id,field:z.enum(['startMs','durationMs','sourceInMs','playbackRate','volume','fadeInMs','fadeOutMs','transitionMs','curveDurationMs'])}),
 z.strictObject({kind:z.literal('clip_adjustment'),trackId:id,clipId:id,field:z.enum(['brightness','contrast','saturation'])}),
 z.strictObject({kind:z.literal('clip_toggle'),trackId:id,clipId:id,field:z.enum(['muted','loop'])}),
 z.strictObject({kind:z.literal('track_toggle'),trackId:id,field:z.literal('muted')})
]);
const base={key,label:z.string().trim().min(1).max(60),description:z.string().max(300),bindings:z.array(templateBinding).min(1).max(10)};
export const templateControl=z.discriminatedUnion('kind',[
 z.strictObject({...base,kind:z.literal('text'),defaultValue:z.string().max(4000),required:z.boolean(),maxLength:z.int().min(1).max(4000)}),
 z.strictObject({...base,kind:z.literal('color'),defaultValue:color}),
 z.strictObject({...base,kind:z.literal('number'),defaultValue:z.number().finite(),min:z.number().finite(),max:z.number().finite(),integer:z.boolean()}),
 z.strictObject({...base,kind:z.literal('boolean'),defaultValue:z.boolean()}),
 z.strictObject({...base,kind:z.literal('asset'),defaultValue:id.nullable(),required:z.boolean(),mediaType:z.enum(['image/png','audio/wav','video/mp4','video/quicktime'])})
]);
export const templateControls=z.array(templateControl).max(40);
export type TemplateControl=z.infer<typeof templateControl>;
export const templateParameterDefinition=z.union([templateControl.options[0].omit({bindings:true}),templateControl.options[1].omit({bindings:true}),templateControl.options[2].omit({bindings:true}),templateControl.options[3].omit({bindings:true}),templateControl.options[4].omit({bindings:true})]);
export type TemplateParameterDefinition=z.infer<typeof templateParameterDefinition>;
export type TemplateBinding=z.infer<typeof templateBinding>;
export const templateInstantiatePlan=z.strictObject({workspaceId:id,templateVersion:z.int().positive(),variables:z.record(z.string(),z.string().max(1000)).default({}),parameters:templateParameters.optional(),engine:z.enum(['native_timeline','adobe_aerender']).default('native_timeline')});
export const templateRestore=z.strictObject({workspaceId:id,version:z.int().positive(),restoreVersion:z.int().positive(),confirmed:z.literal(true),rightsConfirmed:z.literal(true)});
export const templateTargetSchema=z.strictObject({binding:templateBinding,label:z.string(),type:z.enum(['text','color','number','boolean','asset']),value:templateParameterValue,nullable:z.boolean(),mediaType:z.string().optional()});
export const templateEngineSchema=z.strictObject({id:z.enum(['native_timeline','adobe_aerender']),name:z.string(),canCreateProject:z.boolean(),canRender:z.boolean(),adapterImplemented:z.boolean(),reason:z.string().nullable(),mode:z.enum(['local_aerender','contract_test']).nullable().optional(),simulated:z.boolean().optional(),realAeVerified:z.literal(false)});
export const templateOriginSchema=z.strictObject({templateId:z.string(),templateVersion:z.int().positive(),templateName:z.string(),engine:z.literal('native_timeline'),variables:z.record(z.string(),z.string()),parameters:templateParameters,licenseNote:z.string(),planHash:z.string(),createdAt:z.string(),createdBy:id,sourceProjectVersion:z.literal(1),matchesOriginalDocument:z.boolean(),controls:templateControls});
export type TemplateOrigin=z.infer<typeof templateOriginSchema>;
