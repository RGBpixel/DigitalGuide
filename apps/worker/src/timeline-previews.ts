import fs from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError,requirePermission,requireWorkspace } from '@digitalguide/domain';
import { TimelinePreviews,type TimelineJobRow } from '../../api/src/timeline-preview-service.js';
import type { Config } from '../../api/src/config.js';
import { runTimelineRender } from '../../../packages/media/src/run-timeline-render.js';
export async function runTimelinePreview(repo: Repository,config: Config) {
  const previews = new TimelinePreviews(repo,config.providerMode,config.appEnv,config.dataDir,config.root),token = randomUUID(),at = () => new Date().toISOString();
  const row = repo.transaction(() => {
    repo.run("UPDATE studio_timeline_previews SET status='failed',error_message='预览恢复次数已用完，请重新审阅后生成。',lease_token=NULL,lease_until=NULL,updated_at=? WHERE environment=? AND app_env=? AND status='rendering' AND lease_until<=? AND attempts>=2",at(),config.providerMode,config.appEnv,at());
    const next = repo.get<TimelineJobRow>("SELECT * FROM studio_timeline_previews WHERE environment=? AND app_env=? AND (status='queued' OR (status='rendering' AND lease_until<=? AND attempts<2)) ORDER BY created_at,id LIMIT 1",config.providerMode,config.appEnv,at());if (!next) return null;
    repo.run("UPDATE studio_timeline_previews SET status='rendering',attempts=attempts+1,lease_token=?,lease_until=?,progress=0,updated_at=? WHERE id=?",token,new Date(Date.now()+90000).toISOString(),at(),next.id);return next;
  });if (!row) return false;
  const abort = new AbortController(),written: string[] = [];let heartbeat = Date.now();
  const timer = setInterval(() => { try {
    const current = repo.get<TimelineJobRow>('SELECT * FROM studio_timeline_previews WHERE id=?',row.id),project = repo.get<{ version: number;archived: number }>('SELECT version,archived FROM studio_projects WHERE id=?',row.project_id);
    if (current?.status !== 'rendering' || current.lease_token !== token || current.lease_until! <= at() || project?.version !== row.project_version || project.archived) return abort.abort();
    if (Date.now()-heartbeat >= 15000) { repo.run("UPDATE studio_timeline_previews SET lease_until=? WHERE id=? AND status='rendering' AND lease_token=?",new Date(Date.now()+90000).toISOString(),row.id,token);heartbeat = Date.now(); }
  } catch { abort.abort(); } },500);
  try {
    const p = repo.principal(row.actor_id);requirePermission(p,'studio.write');requireWorkspace(p,row.workspace_id);const project = previews.studio.project(p,row.project_id),plan = previews.plan(p,project,row.project_version,row.start_ms,row.duration_ms);
    if (!plan.canRender || plan.hash !== row.plan_hash) throw new AppError('PLAN_CHANGED','工程或授权已变化，请重新审阅。',409);
    const doc = previews.studio.view(p,project).document,files = previews.files(p,doc,row.workspace_id),objects = path.resolve(config.dataDir,'objects'),directory = path.resolve(config.dataDir,'timeline-work',row.id+'-'+token);
    const result = await runTimelineRender({ document: doc,...files,objects,directory,root: config.root,startMs: row.start_ms,durationMs: row.duration_ms },abort.signal,progress => { repo.run("UPDATE studio_timeline_previews SET progress=?,updated_at=? WHERE id=? AND status='rendering' AND lease_token=?",progress,at(),row.id,token); });
    for (const file of [result.videoFile,result.audioFile]) if (!path.resolve(file).startsWith(directory+path.sep) || !/^[a-f0-9-]{36}\.(mp4|wav)$/.test(path.basename(file))) throw new Error('Unexpected render output');
    if (result.size > 64*1024*1024 || fs.statSync(result.videoFile).size !== result.size || createHash('sha256').update(fs.readFileSync(result.videoFile)).digest('hex') !== result.sha256 || result.width !== plan.width || result.height !== plan.height || result.fps !== 15) throw new Error('Unexpected output metadata');
    repo.transaction(() => {
      const current = repo.get<TimelineJobRow>('SELECT * FROM studio_timeline_previews WHERE id=?',row.id);if (abort.signal.aborted || current?.status !== 'rendering' || current.lease_token !== token || current.lease_until! <= at()) throw new AppError('CANCELLED','预览已取消或失去租约。',409);
      const owner = repo.principal(row.actor_id);requirePermission(owner,'studio.write');requireWorkspace(owner,row.workspace_id);const fresh = previews.plan(owner,previews.studio.project(owner,row.project_id),row.project_version,row.start_ms,row.duration_ms);if (!fresh.canRender || fresh.hash !== row.plan_hash) throw new AppError('PLAN_CHANGED','生成期间工程或授权已变化，旧结果没有提交。',409);
      const videoKey = randomUUID()+'.mp4',audioKey = randomUUID()+'.wav';for (const [from,key] of [[result.videoFile,videoKey],[result.audioFile,audioKey]]) { const dest = path.resolve(objects,key);if (!dest.startsWith(objects+path.sep)) throw new Error('Invalid target');fs.copyFileSync(from,dest,fs.constants.COPYFILE_EXCL);written.push(dest); }
      const warnings = [...(result.missingAudioClipIds.length ? ['部分台词未绑定音源，输出保留静音；未自动合成人声。'] : []),...(result.limitedSamples ? ['混音出现峰值限幅，请降低片段音量后复核。'] : []),'角色为静态参考，音频来自原始素材；未执行真实克隆或真人口型驱动。'];
      repo.run("UPDATE studio_timeline_previews SET status='succeeded',progress=1,video_key=?,audio_key=?,result=?,error_message=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",videoKey,audioKey,JSON.stringify({ width: result.width,height: result.height,fps: result.fps,durationMs: result.durationMs,sha256: result.sha256,size: result.size,warnings }),at(),row.id);repo.event(row.tenant_id,row.workspace_id,row.project_id,'studio.timeline_preview_completed',config.providerMode);
    });
    for (const file of [result.videoFile,result.audioFile]) if (path.resolve(file).startsWith(directory+path.sep)) try { fs.unlinkSync(file); } catch { /* A staging cleanup failure cannot undo committed media. */ }
  } catch (e) {
    for (const file of written) if (path.resolve(file).startsWith(path.resolve(config.dataDir,'objects')+path.sep) && fs.existsSync(file)) fs.unlinkSync(file);
    repo.transaction(() => repo.run("UPDATE studio_timeline_previews SET status='failed',error_message=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='rendering' AND lease_token=?",e instanceof AppError ? e.message : '本地时间线预览失败，请缩短区间或检查素材与编码工具。',at(),row.id,token));
  } finally { clearInterval(timer); }
  return true;
}
