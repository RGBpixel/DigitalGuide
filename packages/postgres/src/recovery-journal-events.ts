import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type pg from 'pg';
import {canonical} from '../../domain/src/index.js';
import {RecoveryError} from '../../recovery/src/guard.js';
import {checkCancelled,assertNoLinks,type RecoveryLimits} from '../../recovery/src/files.js';
import {parseJournalEvent,type JournalMetadata,type JournalManifest,type JournalHead} from './recovery-journal-format.js';
import {decryptArchive,inspectArchiveZip} from '../../recovery/src/codec.js';
import {validateJournalManifest} from './recovery-journal-format.js';

export interface JournalIdentity {runtimeId:string;schema:string;streamId:string;publicKey:string;coverageSHA256:string;tables:Set<string>}
export function checkJournalScope(value:JournalMetadata,identity:JournalIdentity){
 if(value.runtimeId!==identity.runtimeId||value.schema!==identity.schema||value.streamId!==identity.streamId||value.coverageSHA256!==identity.coverageSHA256)throw new RecoveryError('PG_JOURNAL_SCOPE_MISMATCH','日志不属于当前备份实例、流或表覆盖版本。');
}
export function journalPrivateJSON(file:string,value:unknown){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function journalReadJSON(file:string){assertNoLinks(file);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>16384)throw new RecoveryError('PG_JOURNAL_FORMAT_INVALID','日志见证或恢复标记必须是有界普通文件。');try{return JSON.parse(fs.readFileSync(file,'utf8')) as unknown;}catch{throw new RecoveryError('PG_JOURNAL_FORMAT_INVALID','日志见证或恢复标记JSON无效，不打印原文。');}}
function checkedEvent(line:string,identity:JournalIdentity){const event=parseJournalEvent(line),p=event.payload;if(p.runtimeId!==identity.runtimeId||p.streamId!==identity.streamId||!identity.tables.has(p.tableName))throw new RecoveryError('PG_JOURNAL_SCOPE_MISMATCH','日志记录不属于此实例、流或已覆盖表。');return event;}

// Bound the unfinished line as well as the total stream; readline alone permits
// an arbitrarily large allocation before a newline is found.
export async function* journalLines(file:string,cap:RecoveryLimits,signal?:AbortSignal){
 assertNoLinks(file);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>cap.maxBytes)throw new RecoveryError('PG_JOURNAL_LIMIT_EXCEEDED','日志文件类型或容量不符合限制。');let pending='',bytes=0;
 for await(const chunk of fs.createReadStream(file,{encoding:'utf8',highWaterMark:16384})){checkCancelled(signal);bytes+=Buffer.byteLength(chunk);if(bytes>cap.maxBytes)throw new RecoveryError('PG_JOURNAL_LIMIT_EXCEEDED','日志内容超过容量限制。');pending+=chunk;let end:number;while((end=pending.indexOf('\n'))>=0){if(end<1||end>65536)throw new RecoveryError('PG_JOURNAL_EVENT_INVALID','日志记录为空或超出单行限制。');yield pending.slice(0,end);pending=pending.slice(end+1);}if(pending.length>65536)throw new RecoveryError('PG_JOURNAL_EVENT_INVALID','日志单行超出限制。');}
 if(pending)throw new RecoveryError('PG_JOURNAL_EVENT_INVALID','日志末行缺少完整结束标记。');
}
export async function* readJournalEvents(file:string,identity:JournalIdentity,metadata:Pick<JournalMetadata,'eventCount'|'eventSetSHA256'>,cap:RecoveryLimits,signal?:AbortSignal){
 let previous='',count=0;const hash=createHash('sha256');for await(const line of journalLines(file,cap,signal)){const event=checkedEvent(line,identity),id=event.payload.id;if(id<=previous)throw new RecoveryError('PG_JOURNAL_EVENT_INVALID','日志编号重复或未按固定顺序排列。');previous=id;if(++count>cap.maxRows)throw new RecoveryError('PG_JOURNAL_LIMIT_EXCEEDED','日志记录数量超限。');hash.update(id+':'+event.eventHash+'\n');yield event;}
 if(count!==metadata.eventCount||hash.digest('hex')!==metadata.eventSetSHA256)throw new RecoveryError('PG_JOURNAL_HISTORY_GAP','日志数量或完整集合摘要不符。');
}
export async function writeJournalEvents(client:pg.Client,target:string,identity:JournalIdentity,cap:RecoveryLimits,signal?:AbortSignal){
 let bytes=0,count=0;const set=createHash('sha256'),fileHash=createHash('sha256'),fd=fs.openSync(target,'wx',0o600);await client.query('DECLARE dg_journal_export NO SCROLL CURSOR FOR SELECT payload::text payload_text,event_hash FROM _dg_native_recovery_journal_events ORDER BY id COLLATE "C"');
 try{for(;;){checkCancelled(signal);const rows=(await client.query<{payload_text:string;event_hash:string}>('FETCH FORWARD 256 FROM dg_journal_export')).rows;if(!rows.length)break;for(const row of rows){const line=JSON.stringify({payloadText:row.payload_text,eventHash:row.event_hash}),event=checkedEvent(line,identity),buffer=Buffer.from(line+'\n');if(++count>cap.maxRows||(bytes+=buffer.length)>cap.maxBytes)throw new RecoveryError('PG_JOURNAL_LIMIT_EXCEEDED','源日志数量或字节数超过导出容量。');set.update(event.payload.id+':'+event.eventHash+'\n');fileHash.update(buffer);fs.writeFileSync(fd,buffer);} }fs.fsyncSync(fd);}finally{fs.closeSync(fd);await client.query('CLOSE dg_journal_export');}
 return{eventCount:count,eventSetSHA256:set.digest('hex'),file:{path:'events.ndjson' as const,bytes,sha256:fileHash.digest('hex')}};
}
export async function requireJournalSuperset(previousFile:string,previous:JournalMetadata,currentFile:string,current:JournalMetadata,identity:JournalIdentity,cap:RecoveryLimits,signal?:AbortSignal){
 const old=readJournalEvents(previousFile,identity,previous,cap,signal)[Symbol.asyncIterator]();let expected=await old.next();try{for await(const event of readJournalEvents(currentFile,identity,current,cap,signal)){if(expected.done)continue;if(expected.value.payload.id<event.payload.id)throw new RecoveryError('PG_JOURNAL_HISTORY_GAP','此前已见证的日志被移除，拒绝发布新见证头。');if(expected.value.payload.id===event.payload.id){if(expected.value.eventHash!==event.eventHash)throw new RecoveryError('PG_JOURNAL_HISTORY_FORK','此前已见证的记录被改写。');expected=await old.next();}}if(!expected.done)throw new RecoveryError('PG_JOURNAL_HISTORY_GAP','当前日志未包含此前的完整已提交集合。');}finally{await old.return?.(undefined);}
}
export async function openJournalPacket(head:JournalHead,directory:string,key:Buffer,work:string,identity:JournalIdentity,cap:RecoveryLimits,signal?:AbortSignal):Promise<{manifest:JournalManifest;events:string}>{
 checkJournalScope(head.metadata,identity);fs.mkdirSync(work,{mode:0o700});const archive=path.join(directory,head.packetFile),zip=path.join(work,'packet.zip'),info=await decryptArchive(archive,zip,key,cap,signal);if(info.archiveSHA256!==head.packetSHA256)throw new RecoveryError('PG_JOURNAL_HISTORY_FORK','密文摘要与签名见证头不符。');const data=path.join(work,'data');fs.mkdirSync(data,{mode:0o700});const manifest=await inspectArchiveZip(zip,data,cap,true,(v,c)=>validateJournalManifest(v,c,identity.publicKey),signal);if(canonical(manifest.metadata)!==canonical(head.metadata))throw new RecoveryError('PG_JOURNAL_HISTORY_FORK','日志包与见证头的签名元数据不一致。');checkJournalScope(manifest.metadata,identity);return{manifest,events:path.join(data,'events.ndjson')};
}
