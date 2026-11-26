import {z} from 'zod';
import {speakerHandoffInput} from './speaker.js';

// Native validation adds this protocol to the generated complete API catalog.
// It does not advertise these endpoints on the existing SQLite server.
export function registerNativeSpeakerHandoffSpec(api:{paths:Record<string,Record<string,unknown>>;components:{securitySchemes:Record<string,unknown>}}){
 const prefix='/guest/sessions/{id}/speaker-focus',intent=prefix+'/handoff-intent',id={name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}},envelope=(s:z.ZodType)=>z.object({data:s,requestId:z.string()}),prepared=z.object({intentId:z.uuid(),state:z.enum(['prepared','committed']),expiresAt:z.iso.datetime(),operationKey:z.string().min(8).max(128)}),recovery=prepared.extend({input:speakerHandoffInput,csrfToken:z.string().min(16)});
 api.components.securitySchemes.nativeGuestSession={type:'apiKey',in:'cookie',name:'dg_native_guest_<runtimeId>',description:'原生验证实例的会话路径HttpOnly凭证；runtimeId去除连字符。普通凭证在旧会话结束时即被服务端撤销。'};
 api.components.securitySchemes.nativeSpeakerHandoff={type:'apiKey',in:'cookie',name:'dg_native_handoff_<runtimeId>',description:'独立六十秒HttpOnly交接意图，仅覆盖旧会话专注接口；新访客首次授权后失效。'};
 const responses=(schema:z.ZodType)=>({'200':{description:'原生明确模拟交接状态；不包含识别句柄或新访问明文',content:{'application/json':{schema:z.toJSONSchema(envelope(schema))}}},...Object.fromEntries(['400','401','403','409','429','503'].map(code=>[code,{description:'明确拒绝或失败；不返回模拟成功'}]))});
 api.paths[intent]={post:{summary:'原生验证：本人明确确认后准备一次限时下一访客交接',security:[{nativeGuestSession:[]}],parameters:[id,{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}},{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128}}],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(speakerHandoffInput,{io:'input'})}}},responses:responses(prepared),'x-digitalguide-native-only':true},get:{summary:'原生验证：旧普通凭证加独立意图恢复原交接模板，不续任何期限',security:[{nativeGuestSession:[],nativeSpeakerHandoff:[]}],parameters:[id],responses:responses(recovery),'x-digitalguide-native-only':true}};
 const handoff=api.paths[prefix+'/handoff'];if(handoff?.post)handoff.post={...handoff.post as object,'x-digitalguide-native-protocol':{prepare:intent,security:[{nativeGuestSession:[],nativeSpeakerHandoff:[]}],idempotencyKey:'Must equal operationKey returned by the original intent.',delivery:'The new path cookie is issued without clearing or renewing the revoked old browser cookie; headers-only delivery can therefore resume until new claim or original intent expiry.'}};
}
