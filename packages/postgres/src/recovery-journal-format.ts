import {createHash,createPrivateKey,createPublicKey,sign,verify,type KeyObject} from 'node:crypto';
import {z} from 'zod';
import {canonical} from '../../domain/src/index.js';
import {RecoveryError} from '../../recovery/src/guard.js';
import type {RecoveryLimits} from '../../recovery/src/files.js';

export const journalSHA=z.string().regex(/^[a-f0-9]{64}$/),journalInteger=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const recoveryJournalCheckpointSchema=z.object({version:z.literal(1),streamId:z.uuid(),publicKey:z.string().min(80).max(2000),coverageSHA256:journalSHA,eventCount:journalInteger,eventSetSHA256:journalSHA,trackedTables:journalInteger}).strict();
export type RecoveryJournalCheckpoint=z.infer<typeof recoveryJournalCheckpointSchema>;
export const journalEventPayloadSchema=z.object({schemaVersion:z.literal(1),id:z.uuid(),runtimeId:z.uuid(),streamId:z.uuid(),tableName:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/),operation:z.enum(['I','U','D','T']),recordHash:journalSHA,nextRecordHash:journalSHA.nullable(),tenantId:z.string().regex(/^[a-f0-9-]{36}$/).nullable(),workspaceId:z.string().regex(/^[a-f0-9-]{36}$/).nullable(),sourceVersion:z.string().regex(/^[0-9]{1,20}$/).nullable(),transactionId:z.string().regex(/^[0-9]{1,30}$/),occurredAt:z.iso.datetime(),category:z.enum(['privacy','authority','business'])}).strict();
export type JournalEventPayload=z.infer<typeof journalEventPayloadSchema>;
const recordSchema=z.object({payloadText:z.string().min(2).max(16384),eventHash:journalSHA}).strict();
export function parseJournalEvent(line:string){
 try{const record=recordSchema.parse(JSON.parse(line)),payload=journalEventPayloadSchema.parse(JSON.parse(record.payloadText));if(journalDigest(record.payloadText)!==record.eventHash)throw new Error('Digest mismatch');return{...record,payload};}catch{throw new RecoveryError('PG_JOURNAL_EVENT_INVALID','恢复日志记录格式或摘要不符；不返回原文。');}
}
export const journalMetadataSchema=z.object({version:z.literal(1),runtimeId:z.uuid(),schema:z.string().regex(/^dg_validation_[a-f0-9]{32}$/),streamId:z.uuid(),publicKeySHA256:journalSHA,coverageSHA256:journalSHA,generation:journalInteger.min(1),packetId:z.uuid(),previousHeadSHA256:journalSHA.nullable(),eventCount:journalInteger,eventSetSHA256:journalSHA,createdAt:z.iso.datetime(),witness:z.literal('local-offline-file')}).strict();
export type JournalMetadata=z.infer<typeof journalMetadataSchema>;
const signature=z.string().regex(/^[A-Za-z0-9_-]{86}$/),file=z.object({path:z.literal('events.ndjson'),bytes:journalInteger,sha256:journalSHA}).strict();
export const journalManifestSchema=z.object({version:z.literal(1),format:z.literal('native-recovery-journal-v1'),metadata:journalMetadataSchema,files:z.array(file).length(1),directories:z.array(z.string()).max(0),signature,activation:z.literal('quarantine-preserved')}).strict();
export type JournalManifest=z.infer<typeof journalManifestSchema>;
export const journalHeadSchema=z.object({version:z.literal(1),format:z.literal('native-recovery-journal-head-v1'),metadata:journalMetadataSchema,packetFile:z.string().regex(/^[1-9][0-9]{0,15}-[a-f0-9-]{36}\.dgj$/),packetSHA256:journalSHA,signature}).strict();
export type JournalHead=z.infer<typeof journalHeadSchema>;
export const journalDigest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function journalPublicKey(value:string){try{const key=createPublicKey(value);if(key.asymmetricKeyType!=='ed25519')throw new Error('Wrong algorithm');return key;}catch{throw new RecoveryError('PG_JOURNAL_KEY_INVALID','恢复日志信任根必须为固定的Ed25519公钥。');}}
export function journalPrivateKey(value:string,expectedPublicKey:string){try{const key=createPrivateKey(value);if(key.asymmetricKeyType!=='ed25519'||createPublicKey(key).export({type:'spki',format:'pem'}).toString()!==expectedPublicKey)throw new Error('Signer mismatch');return key;}catch{throw new RecoveryError('PG_JOURNAL_SIGNER_MISMATCH','恢复日志签名私钥与实例信任根不匹配。');}}
function message(kind:'packet'|'head',body:unknown){return Buffer.from(canonical(['digitalguide-recovery-journal-'+kind+'-v1',body]));}
function checkedSignature(kind:'packet'|'head',body:unknown,value:string,key:KeyObject){const bytes=Buffer.from(value,'base64url');if(bytes.length!==64||bytes.toString('base64url')!==value||!verify(null,message(kind,body),key,bytes))throw new RecoveryError('PG_JOURNAL_SIGNATURE_INVALID','恢复日志签名无效，不能用于恢复核对。');}
export function signJournalManifest(body:Omit<JournalManifest,'signature'>,key:KeyObject):JournalManifest{return journalManifestSchema.parse({...body,signature:sign(null,message('packet',body),key).toString('base64url')});}
export function signJournalHead(body:Omit<JournalHead,'signature'>,key:KeyObject):JournalHead{return journalHeadSchema.parse({...body,signature:sign(null,message('head',body),key).toString('base64url')});}
export function validateJournalManifest(input:unknown,cap:RecoveryLimits,expectedPublicKey:string):JournalManifest{
 const parsed=journalManifestSchema.safeParse(input);if(!parsed.success)throw new RecoveryError('PG_JOURNAL_FORMAT_INVALID','恢复日志包格式无效。');const m=parsed.data;if(m.files[0].bytes>cap.maxBytes||m.metadata.eventCount>cap.maxRows||cap.maxFiles<1)throw new RecoveryError('PG_JOURNAL_LIMIT_EXCEEDED','恢复日志包超过当前核对容量。');if(m.metadata.publicKeySHA256!==journalDigest(expectedPublicKey))throw new RecoveryError('PG_JOURNAL_KEY_INVALID','日志包没有绑定备份中的公钥。');const{signature,...body}=m;checkedSignature('packet',body,signature,journalPublicKey(expectedPublicKey));return m;
}
export function validateJournalHead(input:unknown,expectedPublicKey:string):JournalHead{
 const parsed=journalHeadSchema.safeParse(input);if(!parsed.success)throw new RecoveryError('PG_JOURNAL_FORMAT_INVALID','恢复日志见证头格式无效。');const head=parsed.data;if(head.metadata.publicKeySHA256!==journalDigest(expectedPublicKey)||!head.packetFile.startsWith(head.metadata.generation+'-'+head.metadata.packetId))throw new RecoveryError('PG_JOURNAL_KEY_INVALID','日志见证头未绑定实例公钥或归档编号。');const{signature,...body}=head;checkedSignature('head',body,signature,journalPublicKey(expectedPublicKey));return head;
}
