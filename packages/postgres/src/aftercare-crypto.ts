import {createCipheriv,createDecipheriv,createHash,createHmac,hkdfSync,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {AppError,canonical} from '../../domain/src/index.js';
import {aftercareManagementCode} from '../../contracts/src/dining-service.js';

export const aftercareDescriptorSchema=z.strictObject({actionId:z.uuid(),runtimeId:z.uuid(),tenantId:z.uuid(),workspaceId:z.uuid(),restaurantId:z.uuid(),partyId:z.uuid(),kind:z.enum(['feedback','followup']),id:z.uuid(),version:z.int().positive(),nonce:z.uuid(),expiresAt:z.iso.datetime()});
export type AftercareDescriptor=z.infer<typeof aftercareDescriptorSchema>;
export type AftercareKind=AftercareDescriptor['kind'];
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function key(secret:string,runtimeId:string,purpose:string){return Buffer.from(hkdfSync('sha256',Buffer.from(secret),Buffer.from(runtimeId),Buffer.from('digitalguide/'+purpose),32));}
const scope=(appEnv:string,descriptor:AftercareDescriptor)=>({environment:'mock',appEnv,...descriptor});
export function aftercareCredential(secret:string,appEnv:string,descriptor:AftercareDescriptor){const code='DA1.'+descriptor.kind+'.'+descriptor.id+'.'+descriptor.version+'.'+createHmac('sha256',key(secret,descriptor.runtimeId,'native-aftercare-revoke-v1')).update(canonical(scope(appEnv,descriptor))).digest('base64url');return{code:aftercareManagementCode.parse(code),sha256:hash(code)};}
export function parseAftercareCredential(code:string){const value=aftercareManagementCode.parse(code),parts=value.split('.'),id=z.uuid().parse(parts[2]),version=z.int().positive().parse(Number(parts[3]));return{kind:parts[1] as AftercareKind,id,version,tokenHash:hash(value)};}
export function aftercareContactDigest(secret:string,runtimeId:string,appEnv:string,partyId:string,contact:string){return createHmac('sha256',key(secret,runtimeId,'native-aftercare-contact-input-v1')).update(canonical([appEnv,'mock',partyId,contact])).digest('hex');}
export function aftercareRateScope(secret:string,runtimeId:string,ip:string){return createHmac('sha256',key(secret,runtimeId,'native-aftercare-rate-v1')).update(ip).digest('hex');}
const aad=(appEnv:string,descriptor:AftercareDescriptor,contactKind:'phone'|'email')=>Buffer.from(canonical({purpose:'native-dining-followup-v1',contactKind,...scope(appEnv,descriptor)}));
export function sealNativeFollowup(secret:string,appEnv:string,descriptor:AftercareDescriptor,contactKind:'phone'|'email',contact:string){
 if(descriptor.kind!=='followup')throw new AppError('FOLLOWUP_CONTACT_UNAVAILABLE','回访加密用途不匹配。',409);
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret,descriptor.runtimeId,'native-dining-followup-v1'),iv);cipher.setAAD(aad(appEnv,descriptor,contactKind));const body=Buffer.concat([cipher.update(contact,'utf8'),cipher.final()]);
 const mask=contactKind==='phone'?(()=>{const digits=contact.replace(/[^0-9+]/g,'');return digits.slice(0,2)+'****'+digits.slice(-2);})():(()=>{const[local,domain]=contact.split('@');return local.slice(0,1)+'***@'+domain;})();
 return{cipher:'NAC1.'+Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url'),mask};
}
/** Internal cryptographic primitive. No route or notification worker exposes plaintext. */
export function openNativeFollowup(secret:string,appEnv:string,descriptor:AftercareDescriptor,contactKind:'phone'|'email',cipher:string,at=new Date()){
 if(Date.parse(descriptor.expiresAt)<=at.getTime())throw new AppError('AFTERCARE_EXPIRED','回访授权已到期，不能读取联系方式。',409);
 try{if(descriptor.kind!=='followup'||!/^NAC1\.[A-Za-z0-9_-]{40,1500}$/.test(cipher))throw new Error('purpose');const bytes=Buffer.from(cipher.slice(5),'base64url'),decipher=createDecipheriv('aes-256-gcm',key(secret,descriptor.runtimeId,'native-dining-followup-v1'),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));decipher.setAAD(aad(appEnv,descriptor,contactKind));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}catch{throw new AppError('FOLLOWUP_CONTACT_UNAVAILABLE','联系方式无法按原用途、对象、版本和期限核对，请本人重新确认。',409);}
}
