import {collectDirectoryErasureEntries,publishDirectoryErasureWitness} from './recovery-directory-erasure-witness.js';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical} from '../../domain/src/index.js';
import {RecoveryError} from '../../recovery/src/guard.js';
import {withRecoveryOperation,type RecoveryOptions} from '../../recovery/src/index.js';
import {limits,checkCancelled} from '../../recovery/src/files.js';
import {readRecoveryKey,encryptArchive,decryptArchive,inspectArchiveZip} from '../../recovery/src/codec.js';
import {createPostgresClient,parseConnectionConfig,readPrivateFile,safePostgresError,type PostgresConnectionConfig} from './config.js';
import {loadNativeRuntimeConfig,nativeJournalSignerPath} from './runtime-config.js';
import {journalSourceIdentity,journalStore} from './recovery-journal-identity.js';
import {journalReadJSON,journalPrivateJSON,writeJournalEvents,openJournalPacket,requireJournalSuperset,readJournalEvents} from './recovery-journal-events.js';
import {journalPrivateKey,journalDigest,signJournalManifest,signJournalHead,validateJournalManifest,validateJournalHead,type JournalMetadata} from './recovery-journal-format.js';

export interface NativeJournalExportOptions extends RecoveryOptions {configFile:string;loader:PostgresConnectionConfig;storeDir:string;signerFile?:string}
export async function exportNativeRecoveryJournal(input:NativeJournalExportOptions){
 const config=loadNativeRuntimeConfig(input.configFile),loader=parseConnectionConfig(input.loader),signerFile=path.resolve(input.signerFile||nativeJournalSignerPath(config.dataDir,config.runtimeId)),store=journalStore(config.dataDir,input.storeDir,input.keyFile,false,signerFile),cap=limits(input.limits),root=path.resolve(input.root||process.cwd());
 const client=createPostgresClient(loader);let key:Buffer|undefined,transaction=false;
 try{
  await client.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;const identity=await journalSourceIdentity(client,config,loader,root),signer=journalPrivateKey(readPrivateFile(signerFile,4096),identity.publicKey);key=readRecoveryKey(input.keyFile);
  const directory=path.join(store,identity.streamId),resource=path.join(directory,'head.json');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  return await withRecoveryOperation(resource,'backup',input,async(lock,phase)=>{
   phase('journal_snapshot');const data=path.join(lock,'data');fs.mkdirSync(data,{mode:0o700});const events=path.join(data,'events.ndjson'),snapshot=await writeJournalEvents(client,events,identity,cap,input.signal),erasureEntries=await collectDirectoryErasureEntries(client,identity,cap);await client.query('COMMIT');transaction=false;
   const previous=fs.existsSync(resource)?validateJournalHead(journalReadJSON(resource),identity.publicKey):undefined,previousBytes=previous?fs.readFileSync(resource):undefined;
   if(previous){phase('validating_previous_witness');const old=await openJournalPacket(previous,directory,key!,path.join(lock,'previous'),identity,cap,input.signal);await requireJournalSuperset(old.events,previous.metadata,events,{...previous.metadata,...snapshot},identity,cap,input.signal);}
   let erasureWitness:ReturnType<typeof publishDirectoryErasureWitness>|undefined;
   const report=(head:ReturnType<typeof validateJournalHead>,reused:boolean)=>({result:'PASS' as const,streamId:identity.streamId,generation:head.metadata.generation,eventCount:head.metadata.eventCount,eventSetSHA256:head.metadata.eventSetSHA256,headSHA256:journalDigest(fs.readFileSync(resource)),packetFile:head.packetFile,packetSHA256:head.packetSHA256,reused,...(erasureWitness?{directoryErasureWitness:erasureWitness}:{}),witness:'local-offline-file' as const,productionFreshnessProven:false,activationAllowed:false});
   if(previous&&previous.metadata.eventCount===snapshot.eventCount&&previous.metadata.eventSetSHA256===snapshot.eventSetSHA256){if(erasureEntries)erasureWitness=publishDirectoryErasureWitness(directory,previous,journalDigest(previousBytes!),erasureEntries,signer,identity.publicKey,cap);return report(previous,true);}
   const generation=(previous?.metadata.generation||0)+1;if(!Number.isSafeInteger(generation))throw new RecoveryError('PG_JOURNAL_LIMIT_EXCEEDED','日志见证代数超过安全范围。');
   const metadata:JournalMetadata={version:1,runtimeId:identity.runtimeId,schema:identity.schema,streamId:identity.streamId,publicKeySHA256:journalDigest(identity.publicKey),coverageSHA256:identity.coverageSHA256,generation,packetId:randomUUID(),previousHeadSHA256:previousBytes?journalDigest(previousBytes):null,eventCount:snapshot.eventCount,eventSetSHA256:snapshot.eventSetSHA256,createdAt:new Date().toISOString(),witness:'local-offline-file'};
   const manifest=signJournalManifest({version:1,format:'native-recovery-journal-v1',metadata,files:[snapshot.file],directories:[],activation:'quarantine-preserved'},signer),packetFile=generation+'-'+metadata.packetId+'.dgj',operationId=(journalReadJSON(path.join(lock,'state.json')) as {operationId:string}).operationId,partial=path.join(directory,'.'+packetFile+'.partial-'+operationId);
   phase('encrypting_journal',{encryptedPartial:partial});await encryptArchive(manifest,data,partial,key!,input.signal);phase('journal_readback');const zip=path.join(lock,'readback.zip'),info=await decryptArchive(partial,zip,key!,cap,input.signal),checked=path.join(lock,'checked');fs.mkdirSync(checked,{mode:0o700});const decoded=await inspectArchiveZip(zip,checked,cap,true,(v,c)=>validateJournalManifest(v,c,identity.publicKey),input.signal);
   if(canonical(decoded)!==canonical(manifest))throw new RecoveryError('PG_JOURNAL_FORMAT_INVALID','日志加密包回读与待发布签名清单不符。');for await(const event of readJournalEvents(path.join(checked,'events.ndjson'),identity,metadata,cap,input.signal)){void event;}
   const head=signJournalHead({version:1,format:'native-recovery-journal-head-v1',metadata,packetFile,packetSHA256:info.archiveSHA256},signer);phase('publishing_journal');
   // Preserve only an already published head. A failed future publication must
   // not reserve an immutable generation and make a safe retry impossible.
   if(previousBytes){const history=path.join(directory,'heads');fs.mkdirSync(history,{mode:0o700,recursive:true});const oldFile=path.join(history,previous!.metadata.generation+'.json');if(fs.existsSync(oldFile)){if(!fs.readFileSync(oldFile).equals(previousBytes))throw new RecoveryError('PG_JOURNAL_HISTORY_FORK','历史见证文件与当前已发布见证头不一致。');}else{const fd=fs.openSync(oldFile,'wx',0o600);try{fs.writeFileSync(fd,previousBytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}}
   checkCancelled(input.signal);fs.linkSync(partial,path.join(directory,packetFile));fs.unlinkSync(partial);const next=path.join(lock,'head-next.json');journalPrivateJSON(next,head);if(erasureEntries)erasureWitness=publishDirectoryErasureWitness(directory,head,journalDigest(fs.readFileSync(next)),erasureEntries,signer,identity.publicKey,cap);fs.renameSync(next,resource);phase('journal_published');return report(head,false);
  });
 }catch(error){safePostgresError(error);}finally{if(transaction)await client.query('ROLLBACK').catch(()=>undefined);await client.end();key?.fill(0);}
}
