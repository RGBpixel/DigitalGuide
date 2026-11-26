import {assertSqliteDeveloperStudioJob} from '../../../packages/enterprise/src/developer-studio-jobs.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError,requirePermission,requireWorkspace } from '@digitalguide/domain';
import { StudioExports,type ExportRow } from '../../api/src/studio-export-service.js';
import type { Config } from '../../api/src/config.js';
import { runDelivery } from '../../../packages/media/src/run-delivery.js';
import { fileDigest,ownedFile } from '../../../packages/media/src/files.js';
import { probeLocalMedia } from '../../../packages/media/src/media-tools.js';
import { preparePackageExport,type PreparedArtifact } from './project-package-export.js';
export async function runStudioExport(repo: Repository,config: Config,stopSignal?: AbortSignal) {
  if (stopSignal?.aborted) return false;
  const service = new StudioExports(repo,config.providerMode,config.appEnv,config.dataDir,config.root),token = randomUUID(),at = () => new Date().toISOString();
  const row = repo.transaction(() => {
    repo.run("UPDATE studio_exports SET status='failed',error_message='导出恢复次数已用完，请重新审阅后生成。',lease_token=NULL,lease_until=NULL,updated_at=? WHERE environment=? AND app_env=? AND status='rendering' AND lease_until<=? AND attempts>=2",at(),config.providerMode,config.appEnv,at());
    const next = repo.get<ExportRow>("SELECT * FROM studio_exports WHERE environment=? AND app_env=? AND (status='queued' OR (status='rendering' AND lease_until<=? AND attempts<2)) ORDER BY created_at,id LIMIT 1",config.providerMode,config.appEnv,at());if (!next) return null;
    repo.run("UPDATE studio_exports SET status='rendering',attempts=attempts+1,lease_token=?,lease_until=?,progress=0,updated_at=? WHERE id=?",token,new Date(Date.now()+90000).toISOString(),at(),next.id);return next;
  });if (!row) return false;
  const abort = new AbortController(),written: string[] = [],objects = path.resolve(config.dataDir,'objects'),workRoot = path.resolve(config.dataDir,'export-work'),directory = ownedFile(workRoot,row.id+'-'+token);let committed = false,heartbeat = Date.now();
  const stop = () => abort.abort();stopSignal?.addEventListener('abort',stop,{ once: true });if (stopSignal?.aborted) stop();
  const timer = setInterval(() => { try {
    const current = repo.get<ExportRow>('SELECT * FROM studio_exports WHERE id=?',row.id),project = repo.get<{ version: number;archived: number }>('SELECT version,archived FROM studio_projects WHERE id=?',row.project_id);
    if (current?.status !== 'rendering' || current.lease_token !== token || current.lease_until! <= at() || project?.version !== row.project_version || project.archived) return abort.abort();
    assertSqliteDeveloperStudioJob(repo,row,config);
    if (Date.now()-heartbeat >= 15000) { const owner = repo.principal(row.actor_id);requirePermission(owner,'studio.write');requireWorkspace(owner,row.workspace_id);if (!service.current(owner,row)) return abort.abort();repo.run("UPDATE studio_exports SET lease_until=? WHERE id=? AND status='rendering' AND lease_token=?",new Date(Date.now()+90000).toISOString(),row.id,token);heartbeat = Date.now(); }
  } catch { abort.abort(); } },500);
  const commitArtifacts = async (artifacts: PreparedArtifact[],warnings: string[]) => {
    // Copy large artifacts without holding a database write transaction; commit only after a fresh lease and source check.
    for (const artifact of artifacts) { if (abort.signal.aborted) throw new Error('输出已取消。');const dest = ownedFile(objects,artifact.storageKey);await fs.promises.copyFile(artifact.file,dest,fs.constants.COPYFILE_EXCL);written.push(dest); }
    repo.transaction(() => {
      const current = repo.get<ExportRow>('SELECT * FROM studio_exports WHERE id=?',row.id);if (abort.signal.aborted || current?.status !== 'rendering' || current.lease_token !== token || current.lease_until! <= at()) throw new AppError('CANCELLED','导出已取消或失去租约，未提交产物。',409);
      assertSqliteDeveloperStudioJob(repo,row,config);
      const freshOwner = repo.principal(row.actor_id);requirePermission(freshOwner,'studio.write');requireWorkspace(freshOwner,row.workspace_id);if (!service.current(freshOwner,row)) throw new AppError('PLAN_CHANGED','生成期间工程或素材已变化，旧结果没有提交。',409);
      for (const a of artifacts) repo.run('INSERT INTO studio_export_artifacts VALUES (?,?,?,?,?,?,?,?,?)',a.id,row.id,a.kind,a.name,a.mediaType,a.storageKey,a.size,a.sha256,at());
      repo.run("UPDATE studio_exports SET status='succeeded',progress=1,result=?,error_message=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",JSON.stringify({ warnings }),at(),row.id);repo.event(row.tenant_id,row.workspace_id,row.project_id,'studio.export_completed',config.providerMode);committed = true;
    });
  };
  try {
    assertSqliteDeveloperStudioJob(repo,row,config);
    const owner = repo.principal(row.actor_id);requirePermission(owner,'studio.write');requireWorkspace(owner,row.workspace_id);
    const project = service.studio.project(owner,row.project_id),plan = service.plan(owner,project,service.request(row));if (!plan.canExport || plan.hash !== row.plan_hash) throw new AppError('PLAN_CHANGED','来源、规格或授权已变化，请重新审阅。',409);
    if (row.kind === 'package') {
      const prepared = await preparePackageExport(service,owner,row,directory,abort.signal,progress => repo.run("UPDATE studio_exports SET progress=?,updated_at=? WHERE id=? AND status='rendering' AND lease_token=?",Math.min(0.96,progress*0.96),at(),row.id,token));await commitArtifacts(prepared.artifacts,prepared.warnings);return true;
    }
    const doc = service.document(owner,project),files = service.previews.files(owner,doc,row.workspace_id);
    // Check bytes as well as database fingerprints before passing controlled files to the renderer.
    for (const key of new Set([...Object.values(files.images),...Object.values(files.audio),...Object.values(files.videos).map(v => v.key)])) {
      const expected = repo.get<{ sha256: string }>('SELECT sha256 FROM uploads WHERE storage_key=?',key) || repo.get<{ sha256: string }>('SELECT sha256 FROM studio_import_media WHERE storage_key=?',key);
      if (!expected || (await fileDigest(ownedFile(objects,key),abort.signal)).sha256 !== expected.sha256) throw new AppError('SOURCE_BYTES_CHANGED','源素材文件缺失或校验不一致，请重新上传后生成。',409);
    }
    const result = await runDelivery({ document: doc,...files,objects,directory,root: config.root,startMs: row.start_ms,durationMs: row.duration_ms,delivery: plan.settings,kind: row.kind },abort.signal,progress => { repo.run("UPDATE studio_exports SET progress=?,updated_at=? WHERE id=? AND status='rendering' AND lease_token=?",Math.min(0.96,progress*0.96),at(),row.id,token); });
    const kinds = result.files.map(f => f.kind).sort().join(',');if (kinds !== (row.kind === 'video' ? 'audio,srt,video,vtt' : 'audio,srt,vtt')) throw new Error('Unexpected delivery artifact set');
    const artifacts: { id: string;kind: string;name: string;mediaType: string;storageKey: string;file: string;size: number;sha256: string }[] = [];
    for (const item of result.files) {
      const base = path.basename(item.file);if (!/^[a-f0-9-]{36}\.(mp4|mov|wav|srt|vtt)$/.test(base) || path.resolve(item.file) !== ownedFile(directory,base)) throw new Error('Unexpected delivery file');
      const ext = path.extname(base),mediaType = ({ '.mp4': 'video/mp4','.mov': 'video/quicktime','.wav': 'audio/wav','.srt': 'application/x-subrip','.vtt': 'text/vtt' } as Record<string,string>)[ext];if (item.mediaType !== mediaType) throw new Error('Unexpected delivery media type');
      const digest = await fileDigest(item.file,abort.signal);if (digest.size > 32*1024*1024*1024 || (!digest.size && !['srt'].includes(item.kind))) throw new Error('Unexpected output size');
      artifacts.push({ id: randomUUID(),kind: item.kind,name: `${project.name}-${row.kind === 'video' ? plan.settings.preset : 'audio'}`+ext,mediaType,storageKey: randomUUID()+ext,file: item.file,...digest });
    }
    const primary = artifacts.find(a => a.kind === row.kind)!,probe = await probeLocalMedia(primary.file,config.root,abort.signal),video = probe.streams.find(s => s.codec_type === 'video'),audio = probe.streams.find(s => s.codec_type === 'audio');
    if (!Number.isFinite(Number(probe.format.duration)) || Math.abs(Number(probe.format.duration)*1000-row.duration_ms) > 160 || audio?.channels !== 2 || audio.sample_rate !== '48000') throw new Error('Output duration or audio specs mismatch');
    if (row.kind === 'video') {
      const [num,den] = (video?.r_frame_rate || '').split('/').map(Number);if (video?.width !== plan.width || video?.height !== plan.height || num/den !== plan.fps || video.codec_name !== (plan.alpha ? 'prores' : 'h264') || (plan.alpha && !video.pix_fmt?.startsWith('yuva444p')) || audio.codec_name !== (plan.alpha ? 'pcm_s16le' : 'aac')) throw new Error('Output video specs mismatch');
    } else if (audio.codec_name !== 'pcm_s16le') throw new Error('Output audio codec mismatch');
    const warnings = [...plan.warnings,...(result.missingAudioClipIds.length ? ['部分台词未绑定录音，对应区间保留静音；未自动合成人声。'] : []),...(result.limitedSamples ? ['混音出现峰值限幅，请降低片段音量后复核。'] : [])];
    const manifestFile = ownedFile(directory,randomUUID()+'.json');
    fs.writeFileSync(manifestFile,JSON.stringify({ format: 'digitalguide-delivery',version: 1,project: { id: project.id,name: project.name,version: row.project_version },planHash: plan.hash,kind: row.kind,range: { startMs: row.start_ms,durationMs: row.duration_ms },settings: plan.settings,output: { width: video?.width ?? null,height: video?.height ?? null,fps: plan.fps,videoCodec: video?.codec_name ?? null,pixelFormat: video?.pix_fmt ?? null,alpha: plan.alpha,audioCodec: audio.codec_name,sampleRate: 48000,channels: 2,formatDurationMs: Math.round(Number(probe.format.duration)*1000) },sources: plan.sourceSpecs,files: artifacts.map(a => ({ name: a.name,kind: a.kind,mediaType: a.mediaType,size: a.size,sha256: a.sha256 })),warnings,createdAt: at() },null,2),{ flag: 'wx' });
    artifacts.push({ id: randomUUID(),kind: 'manifest',name: project.name+'-manifest.json',mediaType: 'application/json',storageKey: randomUUID()+'.json',file: manifestFile,...await fileDigest(manifestFile,abort.signal) });
    await commitArtifacts(artifacts,warnings);
  } catch (e) {
    if (!committed) for (const file of written) if (fs.existsSync(file)) try { fs.unlinkSync(file); } catch { /* Retry cleanup on the next storage maintenance pass. */ }
    const message = e instanceof AppError ? e.message : e instanceof Error && /^(媒体导出失败|导出已取消|导出进程提前退出|本地导出超过六小时)/.test(e.message) ? e.message : '导出未完成，可能是源素材、规格、权限或本地文件异常，请重新审阅并重试。';
    if (stopSignal?.aborted && !committed) repo.run("UPDATE studio_exports SET status='queued',attempts=MAX(0,attempts-1),progress=0,error_message=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='rendering' AND lease_token=?",at(),row.id,token);
    else repo.run("UPDATE studio_exports SET status='failed',error_message=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='rendering' AND lease_token=?",message,at(),row.id,token);
  } finally {
    clearInterval(timer);stopSignal?.removeEventListener('abort',stop);
    if (directory.startsWith(workRoot+path.sep) && fs.existsSync(directory)) { for (const name of fs.readdirSync(directory)) { const file = ownedFile(directory,name);if (fs.statSync(file).isFile()) try { fs.unlinkSync(file); } catch { /* A staging cleanup failure cannot undo committed output. */ } }try { fs.rmdirSync(directory); } catch { /* Storage maintenance may retry. */ } }
  }
  return true;
}
