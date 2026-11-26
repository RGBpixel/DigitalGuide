import type {ShareDefinition,ShareNavigation} from '@digitalguide/contracts';
import {AppError} from './index.js';

export function shareOrigin(value:string,development=false){
 let u:URL;try{u=new URL(value);}catch{throw new AppError('SHARE_ORIGIN_INVALID','请填写完整的网站来源，例如 https://example.com，不包含路径。',422);}
 const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(u.origin!==value||u.hostname.includes('*')||u.username||u.password||!(u.protocol==='https:'||development&&local&&u.protocol==='http:'))throw new AppError('SHARE_ORIGIN_INVALID','网站来源须为HTTPS域名及可选端口；本地开发可使用HTTP回环地址，不能包含路径、通配符或登录信息。',422);
 return u.origin;
}
export function validateShare(d:ShareDefinition,durationMs:number,development=false){
 const ids=new Set<string>();
 function unique(id:string){if(ids.has(id))throw new AppError('SHARE_DUPLICATE_ID','章节和组件编号需要唯一。',422);ids.add(id);}
 const origins=d.linkOrigins.map(o=>shareOrigin(o,development));
 if(new Set(origins).size!==origins.length)throw new AppError('SHARE_ORIGIN_DUPLICATE','跳转来源不能重复。',422);
 function time(t:number){if(t>=durationMs)throw new AppError('SHARE_TIME_INVALID','章节或跳转位置需要位于视频时长以内。',422);}
 function navigation(a:ShareNavigation){
  if(a.kind==='seek')time(a.timeMs);
  if(a.kind==='link'){
   const u=new URL(a.url);shareOrigin(u.origin,development);
   if(u.username||u.password||!origins.includes(u.origin))throw new AppError('SHARE_TARGET_INVALID','跳转地址须在已确认的网站来源内，且不能含登录信息。',422);
  }
 }
 let previous=-1;
 for(const c of d.chapters){unique(c.id);time(c.timeMs);if(c.timeMs<=previous)throw new AppError('SHARE_CHAPTER_ORDER','章节应按时间递增排列，不能使用重复时间。',422);previous=c.timeMs;}
 for(const w of d.widgets){
  unique(w.id);if(w.startMs>=w.endMs||w.endMs>durationMs)throw new AppError('SHARE_WIDGET_TIME','组件的结束时间须晚于开始时间，且不能超出视频。',422);
  if(w.rect.x+w.rect.width>1.000001||w.rect.y+w.rect.height>1.000001)throw new AppError('SHARE_WIDGET_RECT','组件位置与大小不能超出视频画面。',422);
  if(w.action.kind==='choice'){const options=new Set<string>();for(const o of w.action.options){if(options.has(o.id))throw new AppError('SHARE_DUPLICATE_OPTION','同一选择题的选项编号不能重复。',422);options.add(o.id);navigation(o.action);}}
  else navigation(w.action);
 }
 return d;
}
export function shareInteraction(d:ShareDefinition,widgetId:string|undefined,optionId:string|undefined,timeMs:number){
 const w=d.widgets.find(w=>w.id===widgetId);
 if(!w||timeMs<w.startMs||timeMs>=w.endMs)throw new AppError('SHARE_INTERACTION_INVALID','该组件不在当前视频时间内，请重新载入播放器。',409);
 if(w.action.kind==='choice'){
  const o=w.action.options.find(o=>o.id===optionId);if(!o)throw new AppError('SHARE_OPTION_INVALID','请选择这个组件中存在的选项。',422);return o.action;
 }
 if(optionId!==undefined)throw new AppError('SHARE_OPTION_INVALID','此组件没有选项。',422);
 return w.action;
}
