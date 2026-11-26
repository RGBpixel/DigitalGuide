import {nativeLibraryKey} from './runtime-library.js';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {AppError,canonical} from '../../domain/src/index.js';
import {remapPortableDocument,validatePortableProject} from '../../domain/src/portable-project.js';
import {readProjectPackage} from '../../media/src/project-package.js';
import {inspectStoredPng,inspectStoredWav} from '../../media/src/index.js';
import {isVideoMediaType,storedPngMaximumBytes,storedWavMaximumBytes} from '../../contracts/src/index.js';
import {fileDigest} from '../../media/src/files.js';
import {prepareNativeVideo} from './runtime-video-inspection.js';
import {assertNoLinks} from '../../recovery/src/files.js';
import {NativePackageTransfers,nativeTransferRow,type NativeTransferRow} from './runtime-package-transfers.js';
import {NativeStudio} from './runtime-studio.js';
import type {NativeCoreRepository} from './runtime-repository.js';

export class NativePackageWorker {
 readonly service:NativePackageTransfers;
 constructor(readonly core:NativeCoreRepository,readonly reader=readProjectPackage,readonly root=process.cwd(),readonly videoInspector?:Parameters<typeof prepareNativeVideo>[7]){this.service=new NativePackageTransfers(core);}
 get db(){return this.core.db;}
 async claim(){return this.db.transaction(async()=>{
  if(!(await this.db.query<{locked:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended('native-package-transfer-capacity',0)) AS locked")).rows[0].locked)return null;
  await this.db.query("UPDATE media_transfers SET status='failed',error_message='传输24小时未完成，请新建上传。',version=version+1,updated_at=dg_utc_now() WHERE environment='mock' AND app_env=$1 AND status='uploading' AND updated_at<to_char((clock_timestamp()-interval '24 hours') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",[this.db.config.appEnv]);
  await this.db.query("UPDATE media_transfers SET status='failed',error_message='工程检查恢复次数已用完，请新建上传。',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE environment='mock' AND app_env=$1 AND status='processing' AND lease_until<=dg_utc_now() AND attempts>=2",[this.db.config.appEnv]);
  if((await this.db.query<{n:number}>("SELECT ((SELECT count(*) FROM media_transfers WHERE environment='mock' AND app_env=$1 AND status='processing' AND lease_until>dg_utc_now())+(SELECT count(*) FROM _dg_native_recording_leases l JOIN media_transfers t ON t.id=l.transfer_id WHERE l.lease_until>dg_utc_now() AND t.status<>'processing'))::int AS n",[this.db.config.appEnv])).rows[0].n>=2)return null;
  const r=(await this.db.query<NativeTransferRow>("SELECT * FROM media_transfers WHERE environment='mock' AND kind IN('package','video') AND app_env=$1 AND(status='queued' OR(status='processing' AND lease_until<=dg_utc_now() AND attempts<2)) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",[this.db.config.appEnv])).rows[0];if(!r)return null;
  return nativeTransferRow((await this.db.query<NativeTransferRow>("UPDATE media_transfers SET status='processing',attempts=attempts+1,lease_token=$1,lease_until=to_char((clock_timestamp()+interval '90 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),progress=0,version=version+1,updated_at=dg_utc_now() WHERE id=$2 RETURNING *",[randomUUID(),r.id])).rows[0]);
 });}
 private async actor(lease:NativeTransferRow,write=false){const p=await this.core.principal(lease.actor_id);await this.core.workspaceLock(p,lease.workspace_id,write);await this.service.current(p,lease);return p;}
 private async fence(lease:NativeTransferRow,lock=false){const r=(await this.db.query<NativeTransferRow>('SELECT * FROM media_transfers WHERE id=$1'+(lock?' FOR UPDATE':''),[lease.id])).rows[0];return r&&r.status==='processing'&&r.lease_token===lease.lease_token&&r.lease_until!>await this.db.now()?nativeTransferRow(r):null;}
 async assemble(lease:NativeTransferRow,directory:string,signal:AbortSignal,progress:(p:number)=>void){
  const file=path.join(directory,lease.kind==='package'?'input.zip':'input.bin'),parts=await this.db.transaction(async()=>{await this.actor(lease);if(!await this.fence(lease))throw new AppError('LEASE_EXPIRED','传输检查租约已失效。',409);return this.service.parts(lease.id);});if(parts.length!==lease.chunk_count||parts.some((p,i)=>p.part_index!==i))throw new AppError('PARTS_INCOMPLETE','已确认分片不完整，请新建传输。',409);
  assertNoLinks(directory,true);await fs.promises.mkdir(directory,{recursive:true,mode:0o700});assertNoLinks(directory);const out=await fs.promises.open(file,'wx'),hash=createHash('sha256');let size=0;
  try{for(const part of parts){signal.throwIfAborted();const bytes=await this.service.objects.read(part,4194304);if(lease.part_hashes&&JSON.parse(lease.part_hashes)[part.part_index]!==part.sha256)throw new AppError('PART_HASH_MISMATCH','固定分片指纹不一致。',409);size+=bytes.length;if(size>lease.size)throw new AppError('SOURCE_HASH_MISMATCH','文件大小与固定输入不符。',409);hash.update(bytes);let offset=0;while(offset<bytes.length){const written=await out.write(bytes,offset,bytes.length-offset);if(!written.bytesWritten)throw new Error('Incomplete transfer write');offset+=written.bytesWritten;}progress(size/lease.size*.2);}}finally{await out.close();}
  const sha256=hash.digest('hex');if(size!==lease.size||(lease.expected_sha256&&sha256!==lease.expected_sha256))throw new AppError('SOURCE_HASH_MISMATCH','文件整体大小或SHA不一致。',409);
  return{file,sha256};
 }
 async prepare(lease:NativeTransferRow,directory:string,signal:AbortSignal,progress:(p:number)=>void){
  const{file,sha256}=await this.assemble(lease,directory,signal,progress);
  if(lease.kind==='video'){
   const checked=await prepareNativeVideo(this.service.objects,file,path.join(directory,'inspection'),this.root,/\.mov$/i.test(lease.file_name),signal,n=>progress(.2+n*.65),this.videoInspector),stored=await this.service.objects.install(file,checked.mediaType==='video/quicktime'?1073741824:134217728,signal);if(stored.sha256!==sha256||stored.size!==lease.size)throw new AppError('MEDIA_INTEGRITY','检查期间原视频发生变化，未采用输出。',409);
   const asset={name:lease.name,category:lease.category,mediaType:checked.mediaType,size:lease.size,sha256,specs:checked.specs,expiresAt:null,synthetic:false},prepared={id:randomUUID(),uploadId:randomUUID(),key:stored.storage_key,nameKey:nativeLibraryKey(lease.name),specs:checked.specs,poster:checked.poster,preview:checked.preview};return{kind:'video' as const,asset,prepared,sha256,warnings:checked.warnings};
  }
  const extracted=await this.reader(file,directory,signal,p=>progress(.2+p*.35)),portable=validatePortableProject(extracted.project),prepared:{id:string;uploadId:string;sourceId:string;key:string;nameKey:string;specs:Record<string,number>;poster?:unknown;preview?:unknown}[]=[],ids=new Map<string,string>();
  for(const[index,a]of portable.assets.entries()){
   signal.throwIfAborted();const source=path.resolve(extracted.files[a.id]);if(!source.startsWith(path.resolve(directory)+path.sep))throw new AppError('MEDIA_INTEGRITY','解包输出位置不符合要求。',409);assertNoLinks(source);const actual=await fileDigest(source,signal);if(actual.size!==a.size||actual.sha256!==a.sha256)throw new AppError('MEDIA_INTEGRITY','解包原件大小或SHA与清单不一致。',409);
   if(a.category==='voice'&&a.mediaType!=='audio/wav'||a.category==='avatar'&&a.mediaType!=='image/png'||a.category==='background'&&!['image/png','video/mp4','video/quicktime'].includes(a.mediaType))throw new AppError('INVALID_PROJECT_PACKAGE','工程包素材分类与原件类型不匹配。',422);
   let specs:Record<string,number>,extra:{poster?:unknown;preview?:unknown}={},maximum:number;
   if(isVideoMediaType(a.mediaType)){maximum=a.mediaType==='video/quicktime'?1073741824:134217728;if(a.size>maximum)throw new AppError('INVALID_PROJECT_PACKAGE','包内视频超过当前格式限制。',422);const checked=await prepareNativeVideo(this.service.objects,source,path.join(directory,'inspect-'+randomUUID()),this.root,a.mediaType==='video/quicktime',signal,()=>{},this.videoInspector);specs=checked.specs;extra={poster:checked.poster,preview:checked.preview};}
   else{maximum=a.mediaType==='image/png'?storedPngMaximumBytes:storedWavMaximumBytes;if(a.size>maximum)throw new AppError('INVALID_PROJECT_PACKAGE','包内原件超过当前格式限制。',422);const bytes=await fs.promises.readFile(source),inspected=a.mediaType==='image/png'?inspectStoredPng(bytes):inspectStoredWav(bytes);if(inspected.mediaType!==a.mediaType)throw new AppError('INVALID_PROJECT_PACKAGE','包内原件实际格式与清单不符。',422);specs=inspected.specs;}
   if(canonical(specs)!==canonical(a.specs))throw new AppError('INVALID_PROJECT_PACKAGE','包内原件的真实解码规格与清单不符。',422);const stored=await this.service.objects.install(source,maximum,signal);if(stored.sha256!==a.sha256||stored.size!==a.size)throw new AppError('MEDIA_INTEGRITY','检查后原件与清单不一致。',409);const id=randomUUID();ids.set(a.id,id);prepared.push({id,uploadId:randomUUID(),sourceId:a.id,key:stored.storage_key,nameKey:nativeLibraryKey(a.name),specs,...extra});progress(.55+(index+1)/Math.max(1,portable.assets.length)*.4);
  }
  return{kind:'package' as const,portable,prepared,document:remapPortableDocument(portable,ids),sha256,projectId:randomUUID()};
 }
 async runOne(stopSignal?:AbortSignal,onClaim?:(r:NativeTransferRow)=>void){
  if(stopSignal?.aborted)return false;const lease=await this.claim();if(!lease)return false;onClaim?.(lease);const abort=new AbortController(),stop=()=>abort.abort();stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();let timer:ReturnType<typeof setInterval>|undefined,pendingTick:Promise<void>|undefined,progress=0,lastRenew=Date.now();
  const tick=async()=>this.db.transaction(async()=>{await this.actor(lease);if(!await this.fence(lease,true))throw new AppError('LEASE_EXPIRED','工程检查已取消或失去租约。',409);const renew=Date.now()-lastRenew>=15000;const changed=await this.db.query('UPDATE media_transfers SET progress=$1,updated_at=dg_utc_now()'+(renew?",lease_until=to_char((clock_timestamp()+interval '90 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')":'')+" WHERE id=$2 AND status='processing' AND lease_token=$3 AND lease_until>dg_utc_now()",[Math.min(progress,.96),lease.id,lease.lease_token]);if(!changed.rowCount)throw new AppError('LEASE_EXPIRED','工程租约已过期，未续约。',409);if(renew)lastRenew=Date.now();});
  try{await this.db.transaction(async()=>{await this.actor(lease);if(!await this.fence(lease))throw new AppError('LEASE_EXPIRED','工程租约已失效。',409);});timer=setInterval(()=>{if(pendingTick)return;pendingTick=tick().catch(()=>abort.abort()).finally(()=>{pendingTick=undefined;});},500);const directory=path.join(this.db.config.dataDir,'transfer-work',lease.id+'-'+lease.lease_token),prepared=await this.prepare(lease,directory,abort.signal,n=>{if(Number.isFinite(n)&&n>=0&&n<=1)progress=Math.max(progress,n);});clearInterval(timer);timer=undefined;await pendingTick;abort.signal.throwIfAborted();
   await this.db.transaction(async()=>{
    const p=await this.actor(lease,true),current=await this.fence(lease,true);if(!current)throw new AppError('LEASE_EXPIRED','旧租约不能提交原件或工程。',409);
    if(prepared.kind==='package'){validatePortableProject(prepared.portable);await this.db.query('SELECT dg_native_commit_package($1,$2,$3,$4,$5,$6,$7)',[lease.id,lease.lease_token,prepared.sha256,JSON.stringify(prepared.portable),prepared.projectId,JSON.stringify(prepared.document),JSON.stringify(prepared.prepared)]);const studio=new NativeStudio(this.core),r=await studio.project(p,prepared.projectId);await studio.sources.inspect(p,r.workspace_id,r.purpose,JSON.parse(r.document));await this.core.event(lease.tenant_id,lease.workspace_id,lease.id,'media.package_ready');await this.actor(lease,true);await studio.sources.inspect(p,r.workspace_id,r.purpose,JSON.parse(r.document));}
    else{await this.db.query('SELECT dg_native_commit_video($1,$2,$3,$4,$5,$6)',[lease.id,lease.lease_token,prepared.sha256,JSON.stringify(prepared.asset),JSON.stringify(prepared.prepared),JSON.stringify(prepared.warnings)]);await this.core.assets.checked(p,prepared.prepared.id);await this.core.event(lease.tenant_id,lease.workspace_id,lease.id,'media.video_ready');await this.actor(lease,true);await this.core.assets.checked(p,prepared.prepared.id);}
    if(current.lease_until!<=await this.db.now())throw new AppError('LEASE_EXPIRED','提交前租约已到期，原件与工程全部回滚。',409);
   });
  }catch(e){await this.db.transaction(async()=>{const release=stopSignal?.aborted;await this.db.query("UPDATE media_transfers SET status=$1,error_message=$2,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now()"+(release?',attempts=attempts-1,progress=0':'')+" WHERE id=$3 AND status='processing' AND lease_token=$4 AND lease_until>dg_utc_now()",[release?'queued':'failed',release?null:e instanceof AppError?e.message:lease.kind==='package'?'工程包检查未完成，请核对ZIP格式、来源和存储空间后新建上传。':'视频检查未完成，请核对MP4/MOV编码、来源和存储空间后新建上传。',lease.id,lease.lease_token]);});}finally{if(timer)clearInterval(timer);await pendingTick;stopSignal?.removeEventListener('abort',stop);}return true;
 }
}
