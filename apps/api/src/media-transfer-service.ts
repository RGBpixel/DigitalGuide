import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { transferCreateInput,transferChunkInput,type MediaTransfer } from '@digitalguide/contracts';
import { AppError,requireWorkspace,requirePermission,type Principal } from '@digitalguide/domain';
import { ownedFile } from '../../../packages/media/src/files.js';
export const transferChunkSize = 4*1024*1024;
export interface TransferRow { id: string;tenant_id: string;workspace_id: string;actor_id: string;kind: MediaTransfer['kind'];name: string;category: string;file_name: string;size: number;expected_sha256: string|null;sha256: string|null;part_hashes: string|null;fingerprint: string|null;chunk_size: number;chunk_count: number;status: MediaTransfer['status'];version: number;progress: number;attempts: number;lease_token: string|null;lease_until: string|null;asset_id: string|null;project_id: string|null;warnings: string;error_message: string|null;chunks_cleaned_at: string|null;updated_at: string }
export interface TransferPart { part_index: number;size: number;sha256: string;storage_key: string }
export class MediaTransfers {
  chunks: string;
  constructor(public repo: Repository,public environment: string,public appEnv: string,public dataDir: string) { this.chunks = path.resolve(dataDir,'transfer-chunks'); }
  row(p: Principal,id: string) { const r = this.repo.get<TransferRow>('SELECT * FROM media_transfers WHERE id=? AND tenant_id=? AND actor_id=? AND environment=? AND app_env=?',id,p.tenantId,p.userId,this.environment,this.appEnv);if (!r) throw new AppError('NOT_FOUND','本人上传任务不存在或不在当前环境。',404);requireWorkspace(p,r.workspace_id);return r; }
  view(r: TransferRow): MediaTransfer { return { id: r.id,workspaceId: r.workspace_id,kind: r.kind,name: r.name,fileName: r.file_name,size: r.size,sha256: r.sha256 || r.expected_sha256,fingerprint: r.fingerprint,chunkSize: r.chunk_size,chunkCount: r.chunk_count,receivedParts: this.parts(r.id).map(p => p.part_index),version: r.version,status: r.status,progress: r.progress,errorMessage: r.error_message,assetId: r.asset_id,projectId: r.project_id,warnings: JSON.parse(r.warnings),updatedAt: r.updated_at }; }
  parts(id: string) { return this.repo.all<TransferPart>('SELECT * FROM media_transfer_parts WHERE transfer_id=? ORDER BY part_index',id); }
  current(p:Principal,r:TransferRow) {
    requirePermission(p,'asset.write');requireWorkspace(p,r.workspace_id);
    if(r.kind==='package'||r.kind==='recording')requirePermission(p,'studio.write');
    if(r.kind==='recording'){
      const recording=this.repo.get<{id:string;actor_id:string}>('SELECT id,actor_id FROM studio_recordings WHERE transfer_id=?',r.id);
      if(!recording||recording.actor_id!==p.userId)throw new AppError('RECORDING_UNAVAILABLE','录制传输绑定不存在或操作账号变化。',409);
      this.repo.recordingSource(p,r.workspace_id,this.environment,this.appEnv,recording.id);
    }
  }
  create(p: Principal,input: z.infer<typeof transferCreateInput>,recordingId?:string) {
    requireWorkspace(p,input.workspaceId);
    const kind:MediaTransfer['kind']=recordingId?'recording':input.kind;
    if(recordingId){requirePermission(p,'studio.write');this.repo.recordingSource(p,input.workspaceId,this.environment,this.appEnv,recordingId);const r=this.repo.get<{actor_id:string;transfer_id:string|null}>('SELECT actor_id,transfer_id FROM studio_recordings WHERE id=?',recordingId);if(r?.actor_id!==p.userId||r.transfer_id)throw new AppError('RECORDING_STATE_CONFLICT','录制已有传输或不属于本人，请新建录制方案。',409);}
    if (input.kind === 'package') { requirePermission(p,'studio.write');if (!input.acceptNonPortable) throw new AppError('CONFIRM_REQUIRED','请确认不可迁移项及目标用途权限。',409); }
    if (kind !== 'package' && input.size > 128*1024*1024) throw new AppError('FILE_TOO_LARGE','单个视频最多128 MB，请压缩或拆分后上传。',413);
    if (!(kind === 'recording' ? /\.(webm|mp4)$/i : kind === 'video' ? /\.(mp4|mov)$/i : /\.zip$/i).test(input.fileName) || /[\\/:]/.test(input.fileName) || [...input.fileName].some(c => c.codePointAt(0)! < 32)) throw new AppError('UNSUPPORTED_MEDIA','录制请选择WebM/MP4，视频请选择H.264 MP4或ProRes 4444 MOV，工程请选择本平台ZIP。',422);
    const count = Math.ceil(input.size/transferChunkSize);if (input.partHashes && input.partHashes.length !== count) throw new AppError('PART_COUNT_MISMATCH','分片校验数量与文件大小不一致，请重新选择文件。',409);
    if (this.repo.get<{n: number}>("SELECT count(*) n FROM media_transfers WHERE tenant_id=? AND actor_id=? AND environment=? AND app_env=? AND status IN ('uploading','queued','processing')",p.tenantId,p.userId,this.environment,this.appEnv)!.n >= 3) throw new AppError('TRANSFER_LIMIT','本人当前最多三项未完成上传，请继续或取消已有任务。',429);
    const id = randomUUID(),at = new Date().toISOString(),fingerprint = input.partHashes ? createHash('sha256').update(input.partHashes.join('\n')).digest('hex') : null;
    this.repo.run('INSERT INTO media_transfers(id,tenant_id,workspace_id,actor_id,kind,name,category,file_name,size,expected_sha256,part_hashes,fingerprint,chunk_size,chunk_count,rights_note,rights_confirmed_at,environment,app_env,created_at,updated_at,nonportable_confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,p.tenantId,input.workspaceId,p.userId,kind,input.name,input.category,input.fileName,input.size,input.sha256,input.partHashes ? JSON.stringify(input.partHashes) : null,fingerprint,transferChunkSize,count,input.rightsNote,at,this.environment,this.appEnv,at,at,input.kind === 'package' ? at : null);return id;
  }
  part(r: TransferRow,input: z.infer<typeof transferChunkInput>) {
    if (r.status !== 'uploading') throw new AppError('STATE_CONFLICT','上传阶段已结束，请刷新查看处理结果。',409);
    if (input.index >= r.chunk_count || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64) || input.contentBase64.length%4) throw new AppError('INVALID_PART','视频分片编号或编码无效，请重新选择文件。',422);
    const bytes = Buffer.from(input.contentBase64,'base64'),expectedSize = Math.min(r.chunk_size,r.size-input.index*r.chunk_size),hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== expectedSize || bytes.toString('base64') !== input.contentBase64 || hash !== input.sha256 || (r.part_hashes && (JSON.parse(r.part_hashes) as string[])[input.index] !== hash)) throw new AppError('PART_HASH_MISMATCH','分片大小或校验不一致，请选择内容相同的原文件重试。',422);
    const existing = this.parts(r.id).find(p => p.part_index === input.index);if (existing && (existing.sha256 !== hash || existing.size !== bytes.length)) throw new AppError('PART_CONFLICT','同一分片已经上传了不同内容，请新建上传任务。',409);
    if (existing && fs.existsSync(ownedFile(this.chunks,existing.storage_key))) return;
    fs.mkdirSync(this.chunks,{ recursive: true });const key = existing?.storage_key || randomUUID()+'.part',file = ownedFile(this.chunks,key);fs.writeFileSync(file,bytes,{ flag: 'wx' });
    try { if (!existing) this.repo.run('INSERT INTO media_transfer_parts VALUES (?,?,?,?,?)',r.id,input.index,bytes.length,hash,key);this.repo.run('UPDATE media_transfers SET version=version+1,updated_at=? WHERE id=?',new Date().toISOString(),r.id); }
    catch (e) { try { fs.unlinkSync(file); } catch { /* A later storage sweep can retry. */ }throw e; }
  }
  finalize(r: TransferRow,version: number) {
    if (r.version !== version) throw new AppError('VERSION_CONFLICT','上传进度已变化，请刷新后继续。',409);
    if (r.status !== 'uploading') throw new AppError('STATE_CONFLICT','此任务已提交或结束。',409);
    const parts = this.parts(r.id);if (parts.length !== r.chunk_count || parts.reduce((n,p) => n+p.size,0) !== r.size) throw new AppError('PARTS_INCOMPLETE','文件分片尚未完整上传，请继续上传后再提交。',409);
    this.repo.run("UPDATE media_transfers SET status='queued',version=version+1,updated_at=? WHERE id=?",new Date().toISOString(),r.id);
  }
  cancel(r: TransferRow,version: number) {
    if (r.version !== version) throw new AppError('VERSION_CONFLICT','上传状态已变化，请刷新后再取消。',409);
    if (!['uploading','queued','processing'].includes(r.status)) throw new AppError('STATE_CONFLICT','任务已结束；素材就绪后请从素材库管理。',409);
    this.repo.run("UPDATE media_transfers SET status='cancelled',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=?",new Date().toISOString(),r.id);
  }
  cleanup(r: TransferRow) {
    if (!['ready','failed','cancelled'].includes(r.status) || r.chunks_cleaned_at) return;
    let removed = true;for (const part of this.parts(r.id)) { const file = ownedFile(this.chunks,part.storage_key);try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { removed = false; } }
    if (removed) this.repo.run('UPDATE media_transfers SET chunks_cleaned_at=? WHERE id=? AND status IN (?,?,?)',new Date().toISOString(),r.id,'ready','failed','cancelled');
  }
}
