import {templateControls,templateParameters,type TemplateControl,type TemplateParameterDefinition,type TemplateBinding,type TemplateParameters,type StudioDocument} from '@digitalguide/contracts';
import {AppError} from './index.js';

type Value=TemplateParameters[string];
type SlotType='text'|'color'|'number'|'boolean'|'asset';
interface Slot{key:string;type:SlotType;nullable:boolean;mediaType?:string;value:Value;write:(value:Value)=>void}
function invalid(message:string):never{throw new AppError('INVALID_TEMPLATE_CONTROL',message,409);}
function slot(object:object,field:string,key:string,type:SlotType,nullable=false,mediaType?:string):Slot{const record=object as Record<string,unknown>;if(!Object.hasOwn(record,field))invalid('参数目标字段已不存在，请重新选择槽位。');const value=record[field];if(value!==null&&typeof value!==({text:'string',color:'string',asset:'string',number:'number',boolean:'boolean'}as const)[type]||value===null&&!nullable)invalid('参数目标与所选参数类型不兼容。');return{key,type,nullable,mediaType,value:value as Value,write:v=>{record[field]=v;}};}
function resolve(doc:StudioDocument,b:TemplateBinding):Slot{
 const segment='segmentId'in b?doc.segments.find(s=>s.id===b.segmentId):undefined,track='trackId'in b?doc.timeline?.tracks.find(t=>t.id===b.trackId):undefined,clip='clipId'in b?track?.clips.find(c=>c.id===b.clipId):undefined;
 if('segmentId'in b&&!segment)invalid('参数引用的分镜已移除。');if('trackId'in b&&!track)invalid('参数引用的时间线轨道已移除。');if('clipId'in b&&!clip)invalid('参数引用的时间线片段已移除。');
 if(b.kind==='segment')return slot(segment!,b.field,'segment:'+b.segmentId+':'+b.field,b.field==='backgroundColor'?'color':b.field==='durationMs'?'number':'text');
 if(b.kind==='element'){const e=segment!.elements.find(e=>e.id===b.elementId);if(!e)invalid('参数引用的画面对象已移除。');return slot(e,b.field,'element:'+b.segmentId+':'+b.elementId+':'+b.field,b.field==='text'?'text':['color','fill'].includes(b.field)?'color':b.field==='bold'?'boolean':'number');}
 if(b.kind==='brand')return slot(doc.brand,b.field,'brand:'+b.field,b.field==='logoAssetId'?'asset':'color',b.field==='logoAssetId',b.field==='logoAssetId'?'image/png':undefined);
 if(b.kind==='speaker_asset'){const s=doc.speakers.find(s=>s.id===b.speakerId);if(!s)invalid('参数引用的角色已移除。');return slot(s,b.field,'speaker:'+b.speakerId+':'+b.field,'asset',true,b.field==='avatarAssetId'?'image/png':'audio/wav');}
 if(b.kind==='track_toggle')return slot(track!,b.field,'track:'+b.trackId+':'+b.field,'boolean');
 const prefix='clip:'+b.trackId+':'+('clipId'in b?b.clipId:'')+':';
 if(b.kind==='clip_source')return slot(clip!.source,b.field,prefix+'source:'+b.field,b.field==='text'?'text':b.field==='color'?'color':b.field==='bold'?'boolean':'number');
 if(b.kind==='clip_asset'){if(clip!.source.type!=='asset')invalid('素材参数需要选择已绑定素材的片段。');return slot(clip!.source,'assetId',prefix+'source:assetId','asset');}
 if(b.kind==='clip_number')return slot(clip!,b.field,prefix+b.field,'number');
 if(b.kind==='clip_adjustment')return slot(clip!.color,b.field,prefix+'adjustment:'+b.field,'number');
 if(b.kind==='clip_toggle')return slot(clip!,b.field,prefix+b.field,'boolean');
 if(b.kind==='clip_transform'){
  const resolved=slot(clip!.transform,b.field,prefix+'transform:'+b.field,'number'),original=clip!.transform[b.field];return{...resolved,write:value=>{const number=value as number;if(b.mode==='scale_curve'&&original===0)invalid('以零为基准的动画不能缩放，请选择偏移或设定模式。');resolved.write(number);for(const frame of clip!.keyframes){frame[b.field]=b.mode==='set'?number:b.mode==='offset_curve'?frame[b.field]+number-original:frame[b.field]*number/original;}}};
 }return invalid('模板参数槽位类型不受支持。');
}
export function normalizeTemplateParameters(controls:TemplateControl[]|undefined,input:TemplateParameters={}):TemplateParameters{
 return normalizeParameterValues(templateControls.parse(controls||[]),input);
}
export function normalizeParameterValues(fields:TemplateParameterDefinition[],input:TemplateParameters={}):TemplateParameters{
 const values=templateParameters.parse(input);if(new Set(fields.map(c=>c.key)).size!==fields.length)invalid('模板参数名称重复。');for(const name of Object.keys(values))if(!fields.some(c=>c.key===name))invalid('存在模板未定义的参数：'+name);
 const output:TemplateParameters={};for(const c of fields){const value=Object.hasOwn(values,c.key)?values[c.key]:c.defaultValue;
  if(c.kind==='text'&&(typeof value!=='string'||value.length>c.maxLength||c.required&&!value.trim()))invalid('请核对文字参数“'+c.label+'”的必填及长度限制。');
  if(c.kind==='color'&&(typeof value!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value)))invalid('颜色参数“'+c.label+'”需要六位十六进制颜色。');
  if(c.kind==='number'&&(c.min>c.max||typeof value!=='number'||!Number.isFinite(value)||value<c.min||value>c.max||c.integer&&!Number.isInteger(value)))invalid('数值参数“'+c.label+'”超出范围或不符合整数要求。');
  if(c.kind==='boolean'&&typeof value!=='boolean')invalid('开关参数“'+c.label+'”需要明确的true或false。');
  if(c.kind==='asset'&&(value===null?c.required:typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))invalid('请选择素材参数“'+c.label+'”的有效素材。');
  output[c.key]=value;
 }return output;
}
export function applyTemplateControls(document:StudioDocument,controls:TemplateControl[]|undefined,input:TemplateParameters={}):StudioDocument{
 const fields=templateControls.parse(controls||[]),values=normalizeTemplateParameters(fields,input),doc=structuredClone(document),used=new Set<string>();for(const c of fields)for(const b of c.bindings){const target=resolve(doc,b);if(used.has(target.key))invalid('同一个槽位不能被多个参数或重复绑定覆盖。');used.add(target.key);if(target.type!==c.kind||c.kind==='asset'&&target.mediaType&&target.mediaType!==c.mediaType)invalid('参数“'+c.label+'”的类型与目标槽位不兼容。');if(values[c.key]===null&&!target.nullable)invalid('参数“'+c.label+'”绑定的素材槽位不能为空。');target.write(values[c.key]);}return doc;
}
const fieldLabels:Record<string,string>={text:"文字",color:"颜色",fill:"填充色",fontSize:"字号",bold:"加粗",x:"横坐标",y:"纵坐标",width:"宽度",height:"高度",opacity:"透明度",zIndex:"层级",rotation:"旋转角度",startMs:"起点毫秒",durationMs:"时长毫秒",sourceInMs:"素材入点毫秒",playbackRate:"播放速度",volume:"音量",fadeInMs:"淡入毫秒",fadeOutMs:"淡出毫秒",transitionMs:"过渡毫秒",curveDurationMs:"曲线时长毫秒",brightness:"亮度",contrast:"对比度",saturation:"饱和度",muted:"静音/隐藏",loop:"循环"};
export function templateControlTargets(doc:StudioDocument){const targets:{binding:TemplateBinding;label:string;type:SlotType;value:Value;nullable:boolean;mediaType?:string}[]=[],add=(binding:TemplateBinding,label:string)=>{const s=resolve(doc,binding);targets.push({binding,label,type:s.type,value:s.value,nullable:s.nullable,...(s.mediaType?{mediaType:s.mediaType}:{})});};
 for(const field of ['primaryColor','accentColor','textColor','logoAssetId']as const)add({kind:'brand',field},'品牌 · '+{primaryColor:'主色',accentColor:'强调色',textColor:'字幕颜色',logoAssetId:'标志'}[field]);
 for(const s of doc.speakers)for(const field of ['avatarAssetId','voiceAssetId']as const)add({kind:'speaker_asset',speakerId:s.id,field},s.name+' · '+(field==='avatarAssetId'?'形象素材':'旁白素材'));
 for(const s of doc.segments){for(const field of ['title','text','notes','backgroundColor','durationMs']as const)add({kind:'segment',segmentId:s.id,field},s.title+' · '+{title:'分镜标题',text:'台词/字幕',notes:'备注',backgroundColor:'背景颜色',durationMs:'分镜时长毫秒'}[field]);for(const e of s.elements){const fields=e.type==='text'?['text','color','fontSize','bold','x','y','width','height','opacity','zIndex']as const:e.type==='shape'?['fill','x','y','width','height','opacity','zIndex']as const:['x','y','width','height','opacity','zIndex']as const;for(const field of fields)add({kind:'element',segmentId:s.id,elementId:e.id,field},s.title+' · 画面'+(s.elements.indexOf(e)+1)+' · '+fieldLabels[field]);}}
 for(const t of doc.timeline?.tracks||[]){add({kind:'track_toggle',trackId:t.id,field:'muted'},t.name+' · 静音/隐藏轨道');for(const c of t.clips){const label=t.name+' / '+c.name+' · ';if(c.source.type==='asset')add({kind:'clip_asset',trackId:t.id,clipId:c.id},label+'素材');if(c.source.type==='text')for(const field of ['text','color','fontSize','bold']as const)add({kind:'clip_source',trackId:t.id,clipId:c.id,field},label+fieldLabels[field]);else if(c.source.type==='shape'||c.source.type==='color')add({kind:'clip_source',trackId:t.id,clipId:c.id,field:'color'},label+'颜色');for(const field of ['x','y','width','height','rotation','opacity']as const)add({kind:'clip_transform',trackId:t.id,clipId:c.id,field,mode:(field==='opacity'||field==='width'||field==='height')&&c.transform[field]!==0?'scale_curve':'offset_curve'},label+fieldLabels[field]);for(const field of ['startMs','durationMs','sourceInMs','playbackRate','volume','fadeInMs','fadeOutMs','transitionMs','curveDurationMs']as const)add({kind:'clip_number',trackId:t.id,clipId:c.id,field},label+fieldLabels[field]);for(const field of ['brightness','contrast','saturation']as const)add({kind:'clip_adjustment',trackId:t.id,clipId:c.id,field},label+fieldLabels[field]);for(const field of ['muted','loop']as const)add({kind:'clip_toggle',trackId:t.id,clipId:c.id,field},label+fieldLabels[field]);}}
 return targets;
}
