import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {AppError,requirePermission,type Principal} from '../../domain/src/index.js';
import {studioElement} from '../../contracts/src/index.js';
import {inspectMedia} from '../../media/src/index.js';
import {runDocumentImport} from '../../media/src/run-document-import.js';
import {NativeImports,nativeImportRow,type NativeImportRow} from './runtime-imports.js';
import type {NativeCoreRepository} from './runtime-repository.js';

const pageSchema=z.strictObject({id:z.uuid(),number:z.int().min(1).max(40),title:z.string().min(1).max(100),text:z.string().max(4000),notes:z.string().max(4000),width:z.int().min(320).max(4096),height:z.int().min(320).max(4096),elements:z.array(studioElement).max(60),referenceMediaId:z.uuid().nullable(),warnings:z.array(z.string().max(500)).max(100)});
export class NativeImportWorker {
 readonly service:NativeImports;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd(),readonly reader=runDocumentImport){this.service=new NativeImports(core);}
 get db(){return this.core.db;}
 async claim(){return this.db.transaction(async()=>{
  if(!(await this.db.query<{locked:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended('native-document-import-capacity',0)) AS locked")).rows[0].locked)return null;
  await this.db.query("UPDATE studio_imports SET status='failed',error_code='IMPORT_RETRY_EXHAUSTED',error_message='文档检查恢复次数已用完，请重新上传。',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE environment='mock' AND app_env=$1 AND status='processing' AND lease_until<=dg_utc_now() AND attempts>=2",[this.db.config.appEnv]);
  if((await this.db.query<{n:number}>("SELECT count(*)::int AS n FROM studio_imports WHERE environment='mock' AND app_env=$1 AND status='processing' AND lease_until>dg_utc_now()",[this.db.config.appEnv])).rows[0].n>=2)return null;
  const r=(await this.db.query<NativeImportRow>("SELECT * FROM studio_imports WHERE environment='mock' AND app_env=$1 AND(status='queued' OR(status='processing' AND lease_until<=dg_utc_now() AND attempts<2)) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",[this.db.config.appEnv])).rows[0];if(!r)return null;
  return nativeImportRow((await this.db.query<NativeImportRow>("UPDATE studio_imports SET status='processing',attempts=attempts+1,lease_token=$1,lease_until=to_char((clock_timestamp()+interval '90 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),version=version+1,updated_at=dg_utc_now() WHERE id=$2 RETURNING *",[randomUUID(),r.id])).rows[0]);
 });}
 private async actor(lease:NativeImportRow,write=false):Promise<Principal>{const p=await this.core.principal(lease.actor_id);requirePermission(p,'studio.write');if(p.tenantId!==lease.tenant_id)throw new AppError('FORBIDDEN','导入创建人的组织权限已变化。',403);await this.core.workspaceLock(p,lease.workspace_id,write);return p;}
 private async fence(lease:NativeImportRow,lock=false){const row=(await this.db.query<NativeImportRow>('SELECT * FROM studio_imports WHERE id=$1'+(lock?' FOR UPDATE':''),[lease.id])).rows[0];return row&&row.status==='processing'&&row.lease_token===lease.lease_token&&row.lease_until!>await this.db.now()?nativeImportRow(row):null;}
 async prepare(lease:NativeImportRow,signal:AbortSignal){
  const bytes=await this.db.transaction(async()=>{const p=await this.actor(lease);if(!await this.fence(lease))throw new AppError('LEASE_EXPIRED','文档检查租约已失效。',409);return this.service.input(await this.service.row(p,lease.id));}),parsed=await this.reader(bytes,lease.format,this.root,signal),pages=z.array(pageSchema).min(1).max(40).parse(parsed.pages),warnings=z.array(z.string().max(500)).max(100).parse(parsed.warnings);
  const media=z.array(z.strictObject({id:z.uuid(),png:z.instanceof(Buffer),width:z.int().positive().max(16777216),height:z.int().positive().max(16777216),kind:z.enum(['image','reference'])})).max(2400).parse(parsed.media),ids=new Map(media.map(m=>[m.id,m])),elements=pages.flatMap(p=>p.elements);
  if(ids.size!==media.length||new Set(pages.map(p=>p.id)).size!==pages.length||new Set(elements.map(e=>e.id)).size!==elements.length||pages.some((p,i)=>p.number!==i+1||p.referenceMediaId&&ids.get(p.referenceMediaId)?.kind!=='reference'||p.elements.some(e=>e.type==='image'&&(e.assetId||!e.importMediaId||!ids.has(e.importMediaId)))))throw new AppError('DOCUMENT_RESULT_INVALID','文档检查回执的页序、编号或图片引用不一致。',422);
  if(media.reduce((n,m)=>n+m.png.length,0)>25165824)throw new AppError('DOCUMENT_RESULT_INVALID','实际导入图片总量超过24MB，请拆分文档。',422);
  const prepared=[];for(const m of media){signal.throwIfAborted();const inspected=inspectMedia(m.png);if(inspected.mediaType!=='image/png'||inspected.specs.width!==m.width||inspected.specs.height!==m.height)throw new AppError('DOCUMENT_RESULT_INVALID','实际图片的PNG内容或尺寸与回执不符。',422);const stored=await this.service.objects.write(m.png);await this.service.objects.verify(stored,8388608,signal);prepared.push({id:m.id,key:stored.storage_key,sha256:stored.sha256,size:stored.size,width:m.width,height:m.height,kind:m.kind});}
  return{result:{pages,warnings},media:prepared};
 }
 async runOne(stopSignal?:AbortSignal,onClaim?:(lease:NativeImportRow)=>void){
  if(stopSignal?.aborted)return false;const lease=await this.claim();if(!lease)return false;onClaim?.(lease);const abort=new AbortController(),stop=()=>abort.abort();stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();let timer:ReturnType<typeof setInterval>|undefined,pendingTick:Promise<void>|undefined,lastRenew=Date.now();
  const tick=async()=>this.db.transaction(async()=>{await this.actor(lease);if(!await this.fence(lease,true))throw new AppError('LEASE_EXPIRED','文档已取消或失去租约。',409);const renew=Date.now()-lastRenew>=15000;if(renew){const update=await this.db.query("UPDATE studio_imports SET lease_until=to_char((clock_timestamp()+interval '90 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),updated_at=dg_utc_now() WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>dg_utc_now()",[lease.id,lease.lease_token]);if(!update.rowCount)throw new AppError('LEASE_EXPIRED','文档租约已经到期，未续约。',409);lastRenew=Date.now();}});
  try{
   await this.db.transaction(async()=>{await this.actor(lease);if(!await this.fence(lease))throw new AppError('LEASE_EXPIRED','文档租约已失效。',409);});timer=setInterval(()=>{if(pendingTick)return;pendingTick=tick().catch(()=>abort.abort()).finally(()=>{pendingTick=undefined;});},500);
   const prepared=await this.prepare(lease,abort.signal);clearInterval(timer);timer=undefined;await pendingTick;abort.signal.throwIfAborted();
   await this.db.transaction(async()=>{const p=await this.actor(lease,true),current=await this.fence(lease,true);if(!current)throw new AppError('LEASE_EXPIRED','旧租约不能提交文档结果。',409);await this.service.input(await this.service.row(p,lease.id));
    await this.db.query('SELECT dg_native_commit_import($1,$2,$3,$4,$5)',[lease.id,lease.lease_token,lease.sha256,JSON.stringify(prepared.result),JSON.stringify(prepared.media)]);await this.service.reviewed(p,lease.id);for(const m of prepared.media)await this.service.objects.verify({storage_key:m.key,size:m.size,sha256:m.sha256},8388608,abort.signal);
    await this.core.event(lease.tenant_id,lease.workspace_id,lease.id,'studio.import_review_ready');await this.actor(lease,true);await this.service.reviewed(p,lease.id);for(const m of prepared.media)await this.service.objects.verify({storage_key:m.key,size:m.size,sha256:m.sha256},8388608,abort.signal);if(current.lease_until!<=await this.db.now())throw new AppError('LEASE_EXPIRED','提交前原租约已到期，文档结果全部回滚。',409);
   });
  }catch(e){await this.db.transaction(async()=>{const release=stopSignal?.aborted;await this.db.query("UPDATE studio_imports SET status=$1,error_code=$2,error_message=$3,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now()"+(release?',attempts=attempts-1':'')+" WHERE id=$4 AND status='processing' AND lease_token=$5 AND lease_until>dg_utc_now()",[release?'queued':'failed',release?null:e instanceof AppError?e.code:'DOCUMENT_IMPORT_FAILED',release?null:e instanceof AppError?e.message:'文档解析未完成，请检查文件或拆分后重新上传。',lease.id,lease.lease_token]);});}finally{if(timer)clearInterval(timer);await pendingTick;stopSignal?.removeEventListener('abort',stop);}return true;
 }
}
