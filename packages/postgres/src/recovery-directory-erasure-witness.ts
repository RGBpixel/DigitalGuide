import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,sign,verify,type KeyObject} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {canonical} from '../../domain/src/index.js';
import {RecoveryError} from '../../recovery/src/guard.js';
import {assertNoLinks,type RecoveryLimits} from '../../recovery/src/files.js';
import {journalSHA,journalMetadataSchema,journalDigest,journalPublicKey,type JournalMetadata,type JournalHead} from './recovery-journal-format.js';
import {journalPrivateJSON,type JournalIdentity} from './recovery-journal-events.js';
export const directoryErasureEntrySchema=z.object({scopeHash:journalSHA,receiptKeyHash:journalSHA,clearGlobalName:z.boolean()}).strict();
export const directoryErasureWitnessSchema=z.object({version:z.literal(1),format:z.literal('native-directory-erasure-witness-v1'),journal:journalMetadataSchema,headSHA256:journalSHA,entries:z.array(directoryErasureEntrySchema).max(10000).refine(entries=>new Set(entries.map(e=>e.scopeHash)).size===entries.length&&new Set(entries.map(e=>e.receiptKeyHash)).size===entries.length,'清理证明范围不能重复'),signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)}).strict();
export type DirectoryErasureEntry=z.infer<typeof directoryErasureEntrySchema>;
export type DirectoryErasureWitness=z.infer<typeof directoryErasureWitnessSchema>;
const fail=(code:string,message:string)=>new RecoveryError('PG_DIRECTORY_ERASURE_WITNESS_'+code,message),message=(body:unknown)=>Buffer.from(canonical(['digitalguide-directory-erasure-witness-v1',body]));
export function signDirectoryErasureWitness(body:Omit<DirectoryErasureWitness,'signature'>,key:KeyObject){return directoryErasureWitnessSchema.parse({...body,signature:sign(null,message(body),key).toString('base64url')});}
export function validateDirectoryErasureWitness(value:unknown,publicKey:string,expected:{headSHA256:string;metadata:JournalMetadata},cap:RecoveryLimits){
 const parsed=directoryErasureWitnessSchema.safeParse(value);if(!parsed.success)throw fail('FORMAT','清理范围证明格式或唯一性无效，不打印原文。');const witness=parsed.data;
 if(witness.entries.length>Math.min(cap.maxRows,10000))throw fail('LIMIT','清理范围证明超过当前核对容量。');
 if(witness.headSHA256!==expected.headSHA256||canonical(witness.journal)!==canonical(expected.metadata)||witness.journal.publicKeySHA256!==journalDigest(publicKey))throw fail('SCOPE','清理范围证明未绑定当前完整日志头及备份信任根。');
 const{signature,...body}=witness,bytes=Buffer.from(signature,'base64url');if(bytes.length!==64||bytes.toString('base64url')!==signature||!verify(null,message(body),journalPublicKey(publicKey),bytes))throw fail('SIGNATURE','清理范围证明签名无效。');return witness;
}
export const directoryErasureWitnessPath=(directory:string,generation:number,headSHA256:string)=>{if(!Number.isSafeInteger(generation)||generation<1||!journalSHA.safeParse(headSHA256).success)throw fail('SCOPE','清理范围证明的固定路径参数无效。');return path.join(directory,'directory-erasures',generation+'-'+headSHA256+'.json');};
export function readDirectoryErasureWitnessFile(file:string,cap:RecoveryLimits){
 try{assertNoLinks(file);const stat=fs.statSync(file);if(!stat.isFile()||stat.size>Math.min(cap.maxBytes,4*1024*1024))throw fail('LIMIT','清理范围证明必须为有界普通文件。');const bytes=fs.readFileSync(file);return{bytes,value:JSON.parse(bytes.toString('utf8')) as unknown};}catch(error){if(error instanceof RecoveryError)throw error;throw fail('REQUIRED','缺少或无法读取当前日志头的清理范围证明，请在来源重新导出完整日志。');}
}
export async function collectDirectoryErasureEntries(client:pg.Client,identity:JournalIdentity,cap:RecoveryLimits):Promise<DirectoryErasureEntry[]|null>{
 if(!identity.tables.has('enterprise_directory_profile_erasures'))return null;
 const coverage=(await client.query<{coverage:{tableName:string;keys:string[]}[]}>('SELECT coverage FROM _dg_native_recovery_journal_control WHERE id=1')).rows[0].coverage,keys=new Map(coverage.map(v=>[v.tableName,v.keys])),baseKeys=keys.get('enterprise_directory_access_bases'),receiptKeys=keys.get('enterprise_directory_profile_erasures');if(!baseKeys?.length||!receiptKeys?.length)throw fail('SOURCE','清理范围缺少固定主键覆盖。');
 const rows=(await client.query("SELECT dg_native_recovery_journal_key($1,'enterprise_directory_access_bases',to_jsonb(e),$2::text[]) AS scope_hash,dg_native_recovery_journal_key($1,'enterprise_directory_profile_erasures',to_jsonb(e),$3::text[]) AS receipt_hash,e.global_name_cleared,(u.id IS NULL OR u.deleted<>1 OR u.active<>0 OR u.review_required<>1 OR u.external_id IS NOT NULL OR u.user_name<>'deleted-'||u.id OR u.name_key<>lower('deleted-'||u.id) OR u.display_name<>'已清理目录成员' OR u.display_key<>'已清理目录成员' OR u.profile_json::jsonb<>jsonb_build_object('active',false,'displayName','已清理目录成员','userName','deleted-'||u.id) OR u.version<e.source_version) invalid FROM enterprise_directory_profile_erasures e LEFT JOIN enterprise_directory_users u ON u.id=e.user_id AND u.tenant_id=e.tenant_id AND u.environment=e.environment AND u.app_env=e.app_env AND u.connector_id=e.connector_id ORDER BY scope_hash LIMIT $4",[identity.streamId,baseKeys,receiptKeys,Math.min(cap.maxRows,10000)+1])).rows;
 if(rows.length>Math.min(cap.maxRows,10000))throw fail('LIMIT','来源清理回执超过当前证明容量。');if(rows.some(r=>r.invalid))throw fail('SOURCE','来源清理回执与实际目录占位状态不符，未发布证明。');
 const events=(await client.query("SELECT payload->>'recordHash' hash,payload->>'operation' operation FROM _dg_native_recovery_journal_events WHERE payload->>'tableName'='enterprise_directory_profile_erasures' ORDER BY 1")).rows,receipts=new Set(rows.map(r=>r.receipt_hash));if(events.length!==receipts.size||events.some(e=>e.operation!=='I'||!receipts.has(e.hash)))throw fail('SOURCE','来源清理回执与完整不可变插入日志不符，未发布证明。');
 return rows.map(r=>directoryErasureEntrySchema.parse({scopeHash:r.scope_hash,receiptKeyHash:r.receipt_hash,clearGlobalName:Number(r.global_name_cleared)===1}));
}
export function publishDirectoryErasureWitness(directory:string,head:JournalHead,headSHA256:string,entries:DirectoryErasureEntry[],signer:KeyObject,publicKey:string,cap:RecoveryLimits){
 const witness=signDirectoryErasureWitness({version:1,format:'native-directory-erasure-witness-v1',journal:head.metadata,headSHA256,entries},signer);validateDirectoryErasureWitness(witness,publicKey,{headSHA256,metadata:head.metadata},cap);if(Buffer.byteLength(JSON.stringify(witness)+'\n')>Math.min(cap.maxBytes,4*1024*1024))throw fail('LIMIT','清理范围证明超过字节容量。');const file=directoryErasureWitnessPath(directory,head.metadata.generation,headSHA256),dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});assertNoLinks(dir);
 const existing=()=>{const prior=readDirectoryErasureWitnessFile(file,cap);validateDirectoryErasureWitness(prior.value,publicKey,{headSHA256,metadata:head.metadata},cap);if(canonical(prior.value)!==canonical(witness))throw fail('FORK','相同日志头已有不同清理范围证明，保留现场。');return prior.bytes;};
 let bytes:Buffer;if(fs.existsSync(file))bytes=existing();else{const temporary=path.join(dir,'.witness-'+randomUUID()+'.partial');journalPrivateJSON(temporary,witness);try{try{fs.linkSync(temporary,file);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;existing();}}finally{fs.unlinkSync(temporary);}bytes=existing();}
 if(bytes.length>Math.min(cap.maxBytes,4*1024*1024))throw fail('LIMIT','清理范围证明超过字节容量。');return{file,sha256:journalDigest(bytes),entries:entries.length};
}
