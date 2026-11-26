import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError,type Principal } from '@digitalguide/domain';
import { inspectMedia,inspectStoredPng,inspectStoredWav } from '@digitalguide/media';
import { videoSpecsSchema,alphaVideoSpecsSchema,isVideoMediaType } from '@digitalguide/contracts';
import {createAlphaBrowserPreview} from '../../../packages/media/src/alpha-video-source.js';
import { remapPortableDocument } from '../../../packages/domain/src/portable-project.js';
import { canonical } from '@digitalguide/domain';
import { fileDigest,ownedFile } from '../../../packages/media/src/files.js';
import { readProjectPackage } from '../../../packages/media/src/project-package.js';
import { runVideoInspection } from '../../../packages/media/src/run-video-inspection.js';
import { StudioService } from '../../api/src/studio-service.js';
import type { TransferRow } from '../../api/src/media-transfer-service.js';
import type { Config } from '../../api/src/config.js';
export async function preparePackageImport(repo: Repository,config: Config,row: TransferRow,file: string,directory: string,signal: AbortSignal,written: string[],onProgress: (fraction: number) => void) {
  const { project,files } = await readProjectPackage(file,directory,signal,p => onProgress(p*0.3)),ids = new Map(project.assets.map(a => [a.id,randomUUID()])),prepared: {id: string;sourceId: string;key: string;specs: Record<string,number>;poster?: {key: string;size: number;sha256: string};preview?:{key:string;size:number;sha256:string}}[] = [];
  const objects = path.join(config.dataDir,'objects');
  for (const [index,a] of project.assets.entries()) {
    signal.throwIfAborted();let specs: Record<string,number>,poster: {key: string;size: number;sha256: string}|undefined,preview:{key:string;size:number;sha256:string}|undefined;
    if (isVideoMediaType(a.mediaType)) {
      const result = await runVideoInspection({ file: files[a.id],directory,root: config.root,alphaVideo:a.mediaType==='video/quicktime' },signal,p => onProgress(0.3+0.6*(index+p)/Math.max(1,project.assets.length)));specs = (a.mediaType==='video/quicktime'?alphaVideoSpecsSchema:videoSpecsSchema).parse(result.specs);
      if (path.resolve(result.posterFile) !== ownedFile(directory,'poster.png') || inspectMedia(fs.readFileSync(result.posterFile)).mediaType !== 'image/png') throw new AppError('INVALID_PROJECT_PACKAGE','工程包视频封面检查失败。',422);
      const key = randomUUID()+'.png',destination = ownedFile(objects,key);await fs.promises.copyFile(result.posterFile,destination,fs.constants.COPYFILE_EXCL);written.push(destination);poster = { key,...await fileDigest(result.posterFile,signal) };fs.unlinkSync(result.posterFile);
      if(a.mediaType==='video/quicktime'){const temp=ownedFile(directory,'browser-preview-'+index+'.mp4');await createAlphaBrowserPreview(files[a.id],temp,config.root,signal);const key=randomUUID()+'.mp4',destination=ownedFile(objects,key);await fs.promises.copyFile(temp,destination,fs.constants.COPYFILE_EXCL);written.push(destination);preview={key,...await fileDigest(temp,signal)};fs.unlinkSync(temp);}
    } else {const bytes=fs.readFileSync(files[a.id]),result=a.mediaType==='image/png'?inspectStoredPng(bytes):inspectStoredWav(bytes);if (result.mediaType !== a.mediaType) throw new AppError('INVALID_PROJECT_PACKAGE','工程包素材扩展名与实际内容不符。',422);specs = result.specs; }
    if (canonical(specs) !== canonical(a.specs)) throw new AppError('INVALID_PROJECT_PACKAGE','工程包素材规格与实际解码结果不一致。',422);
    const key = randomUUID()+path.extname(a.file),destination = ownedFile(objects,key);await fs.promises.copyFile(files[a.id],destination,fs.constants.COPYFILE_EXCL);written.push(destination);prepared.push({ id: ids.get(a.id)!,sourceId: a.id,key,specs,poster,preview });onProgress(0.3+0.6*(index+1)/Math.max(1,project.assets.length));
  }
  const document = remapPortableDocument(project,ids),warnings = ['已导入可编辑开放工程和源素材；未迁移账号、模型或原文档处理记录。',...project.nonPortable.map(n => n.reason)];
  return { warnings,commit(owner: Principal,sha256: string) {
    const at = new Date().toISOString();
    for (const item of prepared) {
      const a = project.assets.find(a => a.id === item.sourceId)!;if (a.expiresAt && a.expiresAt <= at) throw new AppError('ASSET_EXPIRED','导入期间素材已过期，未创建工程。',409);
      const uploadId = randomUUID();repo.run('INSERT INTO uploads VALUES (?,?,?,?,?,?,?,?,?,?)',uploadId,row.tenant_id,row.workspace_id,row.actor_id,item.key,a.sha256,a.size,a.mediaType,JSON.stringify(item.specs),at);
      repo.run('INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,expires_at,created_at,synthetic) VALUES (?,?,?,?,?,?,?,?,?)',item.id,row.tenant_id,row.workspace_id,uploadId,a.name,a.category,a.expiresAt,at,a.synthetic?1:0);repo.run('INSERT INTO asset_versions VALUES (?,1,?,?)',item.id,JSON.stringify(repo.asset(owner,item.id)),at);
      if (item.poster) repo.run('INSERT INTO video_sources VALUES (?,?,?,?,?)',item.id,item.poster.key,item.poster.sha256,item.poster.size,at);
      if(item.preview)repo.run('INSERT INTO alpha_video_previews VALUES (?,?,?,?,?)',item.id,item.preview.key,item.preview.sha256,item.preview.size,at);
    }
    const studio = new StudioService(repo,config.providerMode,config.appEnv,config.dataDir),projectId = studio.create(owner,{ workspaceId: row.workspace_id,name: row.name,purpose: project.purpose,document,variables: {} });
    repo.run('INSERT INTO studio_package_imports VALUES (?,?,?,?,?,?)',row.id,projectId,sha256,JSON.stringify(Object.fromEntries(ids)),JSON.stringify(project.nonPortable),at);return projectId;
  } };
}
