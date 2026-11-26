import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError,requirePermission,requireWorkspace } from '@digitalguide/domain';
import { inspectMedia } from '@digitalguide/media';
import { videoSpecsSchema,alphaVideoSpecsSchema } from '@digitalguide/contracts';
import {createAlphaBrowserPreview} from '../../../packages/media/src/alpha-video-source.js';
import { z } from 'zod';
import { fileDigest,ownedFile } from '../../../packages/media/src/files.js';
import { runVideoInspection } from '../../../packages/media/src/run-video-inspection.js';
import { MediaTransfers,type TransferRow } from '../../api/src/media-transfer-service.js';
import type { Config } from '../../api/src/config.js';
import { preparePackageImport } from './project-package-import.js';
export async function runMediaTransfer(repo: Repository,config: Config,stopSignal?: AbortSignal) {
  if (stopSignal?.aborted) return false;const service = new MediaTransfers(repo,config.providerMode,config.appEnv,config.dataDir),at = () => new Date().toISOString(),token = randomUUID();
  repo.transaction(() => {
    repo.run("UPDATE media_transfers SET status='failed',version=version+1,error_message='上传超过24小时未完成，请重新选择文件上传。',updated_at=? WHERE environment=? AND app_env=? AND status='uploading' AND updated_at<?",at(),config.providerMode,config.appEnv,new Date(Date.now()-86400000).toISOString());
    repo.run("UPDATE media_transfers SET status='failed',version=version+1,error_message='检查恢复次数已用完，请新建上传。',lease_token=NULL,lease_until=NULL,updated_at=? WHERE environment=? AND app_env=? AND status='processing' AND lease_until<=? AND attempts>=2",at(),config.providerMode,config.appEnv,at());
  });
  for (const row of repo.all<TransferRow>("SELECT * FROM media_transfers WHERE environment=? AND app_env=? AND status IN ('ready','failed','cancelled') AND chunks_cleaned_at IS NULL LIMIT 10",config.providerMode,config.appEnv)) service.cleanup(row);
  const row = repo.transaction(() => {
    const r = repo.get<TransferRow>("SELECT * FROM media_transfers WHERE environment=? AND app_env=? AND (status='queued' OR (status='processing' AND lease_until<=? AND attempts<2)) ORDER BY created_at,id LIMIT 1",config.providerMode,config.appEnv,at());if (!r) return null;
    repo.run("UPDATE media_transfers SET status='processing',version=version+1,attempts=attempts+1,lease_token=?,lease_until=?,progress=0,updated_at=? WHERE id=?",token,new Date(Date.now()+90000).toISOString(),at(),r.id);return r;
  });if (!row) return false;
  const abort = new AbortController(),stop = () => abort.abort(),workRoot = path.resolve(config.dataDir,'transfer-work'),directory = ownedFile(workRoot,row.id+'-'+token),file = ownedFile(directory,row.kind === 'package' ? 'input.zip' : row.kind==='recording'?'input.webm':'input.mp4'),objects = path.resolve(config.dataDir,'objects'),written: string[] = [];let heartbeat = Date.now(),committed = false;
  stopSignal?.addEventListener('abort',stop,{ once: true });if (stopSignal?.aborted) stop();
  const timer = setInterval(() => { try { const r = repo.get<TransferRow>('SELECT * FROM media_transfers WHERE id=?',row.id);if (r?.status !== 'processing' || r.lease_token !== token || r.lease_until! <= at()) return abort.abort();if (Date.now()-heartbeat >= 15000) { service.current(repo.principal(row.actor_id),r);repo.run("UPDATE media_transfers SET lease_until=? WHERE id=? AND status='processing' AND lease_token=?",new Date(Date.now()+90000).toISOString(),row.id,token);heartbeat = Date.now(); } } catch { abort.abort(); } },500);
  try {
    const p = repo.principal(row.actor_id);service.current(p,row);fs.mkdirSync(directory,{ recursive: true });
    const out = await fs.promises.open(file,'wx'),hash = createHash('sha256');let size = 0;
    try { for (const part of service.parts(row.id)) { if (abort.signal.aborted) throw new Error('Cancelled');const source = ownedFile(service.chunks,part.storage_key),bytes = await fs.promises.readFile(source);if (bytes.length !== part.size || createHash('sha256').update(bytes).digest('hex') !== part.sha256) throw new AppError('PART_HASH_MISMATCH','已上传分片校验失败，请重新上传原文件。',409);hash.update(bytes);size += bytes.length;let offset = 0;while (offset < bytes.length) { const result = await out.write(bytes,offset,bytes.length-offset);if (!result.bytesWritten) throw new Error('Empty transfer write');offset += result.bytesWritten; } } } finally { await out.close(); }
    const sha256 = hash.digest('hex');if (size !== row.size || (row.expected_sha256 && sha256 !== row.expected_sha256)) throw new AppError('SOURCE_HASH_MISMATCH','文件整体大小或校验不一致，请重新上传。',409);
    if (row.kind === 'package') {
      const prepared = await preparePackageImport(repo,config,row,file,directory,abort.signal,written,progress => repo.run("UPDATE media_transfers SET progress=?,updated_at=? WHERE id=? AND status='processing' AND lease_token=?",progress,at(),row.id,token));
      repo.transaction(() => {
        const current = repo.get<TransferRow & {nonportable_confirmed_at: string|null}>('SELECT * FROM media_transfers WHERE id=?',row.id);
        if (abort.signal.aborted || current?.status !== 'processing' || current.lease_token !== token || current.lease_until! <= at() || !current.nonportable_confirmed_at) throw new AppError('CANCELLED','工程包检查已取消或缺少确认，未创建工程。',409);
        const owner = repo.principal(row.actor_id);requirePermission(owner,'asset.write');requirePermission(owner,'studio.write');requireWorkspace(owner,row.workspace_id);
        const projectId = prepared.commit(owner,sha256);repo.run("UPDATE media_transfers SET status='ready',project_id=?,sha256=?,progress=1,warnings=?,error_message=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=?",projectId,sha256,JSON.stringify(prepared.warnings),at(),row.id);repo.event(row.tenant_id,row.workspace_id,row.id,'media.package_ready',config.providerMode);committed = true;
      });return true;
    }
    const recordingId=row.kind==='recording'?repo.get<{id:string}>('SELECT id FROM studio_recordings WHERE transfer_id=?',row.id)!.id:null,alphaVideo=row.kind==='video'&&/\.mov$/i.test(row.file_name);
    const inspected = await runVideoInspection({ file,directory,root: config.root,alphaVideo,...(recordingId?{recording:true,recordingDurationMs:repo.get<{duration_hint_ms:number|null}>('SELECT duration_hint_ms FROM studio_recordings WHERE id=?',recordingId)!.duration_hint_ms}:{}) },abort.signal,progress => repo.run("UPDATE media_transfers SET progress=?,updated_at=? WHERE id=? AND status='processing' AND lease_token=?",progress*0.95,at(),row.id,token));
    const specs = (alphaVideo?alphaVideoSpecsSchema:videoSpecsSchema).parse(inspected.specs),warnings = z.array(z.string().max(500)).max(20).parse(inspected.warnings);
    const sourceFile=recordingId?ownedFile(directory,'recording.mp4'):file;
    if(recordingId&&path.resolve(inspected.normalizedFile||'')!==sourceFile)throw new Error('Unexpected recording output path');
    const inputContainer=recordingId?z.enum(['webm','mp4']).parse(inspected.sourceContainer):null,sourceSpecs=recordingId?z.record(z.string(),z.number()).parse(inspected.sourceSpecs):null,outputDigest=recordingId?await fileDigest(sourceFile,abort.signal):{sha256,size};
    if(outputDigest.size>134217728)throw new Error('Recording output exceeds limit');
    if (path.resolve(inspected.posterFile) !== ownedFile(directory,'poster.png')) throw new Error('Unexpected poster path');const poster = inspectMedia(fs.readFileSync(inspected.posterFile)),posterDigest = await fileDigest(inspected.posterFile,abort.signal);
    if (poster.mediaType !== 'image/png' || !Number.isFinite(inspected.specs.durationMs) || inspected.specs.durationMs > 600000 || inspected.specs.width > 4096 || inspected.specs.height > 4096) throw new Error('Unexpected video inspection');
    const previewFile=alphaVideo?ownedFile(directory,'browser-preview.mp4'):null,previewKey=alphaVideo?randomUUID()+'.mp4':null;if(previewFile)await createAlphaBrowserPreview(sourceFile,previewFile,config.root,abort.signal);const previewDigest=previewFile?await fileDigest(previewFile,abort.signal):null;
    const sourceKey = randomUUID()+(alphaVideo?'.mov':'.mp4'),posterKey = randomUUID()+'.png',rawKey=recordingId?randomUUID()+'.'+inputContainer:null;for (const [from,key] of [[sourceFile,sourceKey],[inspected.posterFile,posterKey],...(rawKey?[[file,rawKey]]:[]),...(previewFile&&previewKey?[[previewFile,previewKey]]:[])]) { const dest = ownedFile(objects,key);await fs.promises.copyFile(from,dest,fs.constants.COPYFILE_EXCL);written.push(dest); }
    repo.transaction(() => {
      const current = repo.get<TransferRow>('SELECT * FROM media_transfers WHERE id=?',row.id);if (abort.signal.aborted || current?.status !== 'processing' || current.lease_token !== token || current.lease_until! <= at()) throw new AppError('CANCELLED','上传检查已取消或失去租约，未创建素材。',409);
      const owner = repo.principal(row.actor_id);service.current(owner,current);const uploadId = randomUUID(),assetId = randomUUID(),recordingSnapshot=recordingId?repo.recordingSource(owner,row.workspace_id,config.providerMode,config.appEnv,recordingId):null;
      repo.run('INSERT INTO uploads VALUES (?,?,?,?,?,?,?,?,?,?)',uploadId,row.tenant_id,row.workspace_id,row.actor_id,sourceKey,outputDigest.sha256,outputDigest.size,alphaVideo?'video/quicktime':'video/mp4',JSON.stringify(specs),at());
      repo.run('INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',assetId,row.tenant_id,row.workspace_id,uploadId,row.name,row.category,at(),recordingSnapshot?.expiresAt||null);
      repo.run('INSERT INTO video_sources VALUES (?,?,?,?,?)',assetId,posterKey,posterDigest.sha256,posterDigest.size,at());
      if(previewKey&&previewDigest)repo.run('INSERT INTO alpha_video_previews VALUES (?,?,?,?,?)',assetId,previewKey,previewDigest.sha256,previewDigest.size,at());
      if(recordingId)repo.run('INSERT INTO studio_recording_outputs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',recordingId,row.id,rawKey,sha256,size,inputContainer,assetId,outputDigest.sha256,outputDigest.size,JSON.stringify(sourceSpecs),JSON.stringify(specs),at());
      repo.run('INSERT INTO asset_versions VALUES (?,1,?,?)',assetId,JSON.stringify(repo.asset(owner,assetId)),at());
      repo.run("UPDATE media_transfers SET status='ready',asset_id=?,sha256=?,progress=1,warnings=?,error_message=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=?",assetId,sha256,JSON.stringify(warnings),at(),row.id);repo.event(row.tenant_id,row.workspace_id,row.id,'media.video_ready',config.providerMode);committed = true;
    });
  } catch (e) {
    if (!committed) for (const file of written) try { fs.unlinkSync(file); } catch { /* Storage maintenance can retry. */ }
    if (stopSignal?.aborted) repo.run("UPDATE media_transfers SET status='queued',attempts=MAX(0,attempts-1),progress=0,version=version+1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='processing' AND lease_token=?",at(),row.id,token);
    else { const message = e instanceof AppError ? e.message : e instanceof Error && /^(视频|录制|原片|透明视频)/.test(e.message) ? e.message : row.kind === 'package' ? '工程包解析失败，请核对ZIP格式和完整性后重新上传。' : '视频检查失败，请重新选择原文件或转换格式后上传。';repo.run("UPDATE media_transfers SET status='failed',version=version+1,error_message=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='processing' AND lease_token=?",message,at(),row.id,token); }
  } finally {
    clearInterval(timer);stopSignal?.removeEventListener('abort',stop);
    if (directory.startsWith(workRoot+path.sep) && fs.existsSync(directory)) { for (const name of fs.readdirSync(directory)) { const f = ownedFile(directory,name);if (fs.statSync(f).isFile()) try { fs.unlinkSync(f); } catch { /* Cleanup can be retried. */ } }try { fs.rmdirSync(directory); } catch { /* Do not undo committed output for a staging cleanup error. */ } }
    const current = repo.get<TransferRow>('SELECT * FROM media_transfers WHERE id=?',row.id);if (current) service.cleanup(current);
  }
  return true;
}
