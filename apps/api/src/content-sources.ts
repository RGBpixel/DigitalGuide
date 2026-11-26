import { randomUUID, createHash } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, assertUsableAsset, requirePermission, requireWorkspace, type Principal } from '@digitalguide/domain';
import { contentBriefConfig, type contentSourceInput, type contentRights, type ContentSource, type ContentBrief } from '@digitalguide/contracts';
import {isVideoMediaType} from '@digitalguide/contracts';
import { capturePlainText, captureHtml, captureDocx, type CapturedContent } from '../../../packages/media/src/content-text.js';
import { contentUrl, fetchContentWeb } from '../../../packages/media/src/content-web.js';
import type { Config } from './config.js';
interface SourceRow {
  id:string;tenant_id:string;workspace_id:string;name:string;kind:ContentSource['kind'];text:string;paragraphs:string;
  material_sha256:string;text_sha256:string;origin:string;warnings:string;subject:string;proof:string;expires_at:string;
  withdrawn:number;version:number;environment:string;app_env:string;updated_at:string;
}
interface BriefRow {id:string;tenant_id:string;workspace_id:string;configuration:string;version:number;updated_at:string}
export interface SourceCapture extends CapturedContent { origin:ContentSource['origin'] }
const now=()=>new Date().toISOString();
export class ContentSources {
  constructor(public repo:Repository, public config:Config){}
  scope(p:Principal,workspaceId:string,write=false) { requireWorkspace(p,workspaceId);if(write)requirePermission(p,'studio.write'); }
  rights(p:Principal,workspaceId:string,rights:z.infer<typeof contentRights>) {
    this.scope(p,workspaceId,true);
    if(rights.expiresAt<=now())throw new AppError('CONTENT_RIGHTS_EXPIRED','内容来源使用期限已到期，请核对授权。',409);
  }
  source(p:Principal,id:string,write=false) {
    const r=this.repo.get<SourceRow>('SELECT * FROM studio_content_sources WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.config.providerMode,this.config.appEnv);
    if(!r)throw new AppError('NOT_FOUND','内容来源不存在或不在当前环境。',404);this.scope(p,r.workspace_id,write);return r;
  }
  reason(p:Principal,r:SourceRow) {
    if(r.withdrawn)return '内容来源已撤回，不能再读取正文或用于新草稿。';
    if(r.expires_at<=now())return '内容来源的使用期限已到期，请重新核对授权。';
    const origin=JSON.parse(r.origin) as ContentSource['origin'];
    if(r.kind==='video')try{
      const asset=this.repo.asset(p,String(origin.assetId));assertUsableAsset(asset);
      if(asset.workspaceId!==r.workspace_id||asset.version!==origin.assetVersion||asset.sha256!==origin.assetSHA256) return '转写引用的原视频版本或范围已变化，请重新核对。';
      this.repo.transcriptionContentSource(p,r.id);
    }catch{return '转写引用的原视频不可用，请重新核对素材及权限。';}
    if(createHash('sha256').update(r.text).digest('hex')!==r.text_sha256)return '正文与保存的字节校验不一致，请重新导入来源。';
    return null;
  }
  view(p:Principal,r:SourceRow):ContentSource {
    this.scope(p,r.workspace_id);const reason=this.reason(p,r);
    return {id:r.id,workspaceId:r.workspace_id,name:r.name,kind:r.kind,version:r.version,text:reason?null:r.text,paragraphs:reason?[]:JSON.parse(r.paragraphs),materialSHA256:r.material_sha256,textSHA256:r.text_sha256,origin:JSON.parse(r.origin),warnings:JSON.parse(r.warnings),subject:r.subject,proof:r.proof,expiresAt:r.expires_at,withdrawn:!!r.withdrawn,available:!reason,unavailableReason:reason,updatedAt:r.updated_at};
  }
  async capture(p:Principal,input:z.infer<typeof contentSourceInput>):Promise<SourceCapture> {
    this.rights(p,input.workspaceId,input.rights);
    try{
      if(input.kind==='text')return {...capturePlainText(input.text),origin:{mode:'user_text'}};
      if(input.kind==='docx'){
        const bytes=Buffer.from(input.contentBase64,'base64');
        if(bytes.toString('base64')!==input.contentBase64)throw new AppError('CONTENT_SOURCE_INVALID','文件编码无效，请重新选择DOCX。',422);
        return {...await captureDocx(bytes),origin:{mode:'docx_body',fileName:input.fileName,byteLength:bytes.length}};
      }
      if(input.kind==='web'){
        const url=contentUrl(input.url);
        if(input.capture==='snapshot')return {...captureHtml(input.html),origin:{mode:'user_html_snapshot',url:url.href,networkFetched:false}};
        if(input.html)throw new AppError('CONTENT_SOURCE_INVALID','在线读取不能同时提交手工快照，请选择一种来源。',422);
        const fetched=await fetchContentWeb(url.href),content=fetched.contentType.startsWith('text/plain')?capturePlainText(new TextDecoder('utf-8',{fatal:true}).decode(fetched.bytes),fetched.bytes):captureHtml(fetched.bytes);
        return {...content,origin:{mode:'public_https',url:fetched.url,requestedUrl:url.href,contentType:fetched.contentType,networkFetched:true,capturedAt:now()}};
      }
      const a=this.repo.asset(p,input.assetId);assertUsableAsset(a);
      if(a.workspaceId!==input.workspaceId||!isVideoMediaType(a.mediaType)||a.version!==input.assetVersion||!this.repo.get('SELECT asset_id FROM video_sources WHERE asset_id=?',a.id))throw new AppError('CONTENT_VIDEO_UNAVAILABLE','请选择当前空间已实际解码的MP4/MOV和当前版本。',409);
      return {...capturePlainText(input.transcript,input.transcript,['此正文由人工录入或校对，不代表已自动识别视频语音或画面。']),origin:{mode:'manual_video_transcript',assetId:a.id,assetVersion:a.version,assetSHA256:a.sha256,videoDurationMs:a.specs.durationMs,transcriptOrigin:'manual'}};
    }catch(error){
      if(error instanceof AppError)throw error;
      throw new AppError('CONTENT_SOURCE_INVALID','正文解析失败；请另存为UTF-8网页/无宏DOCX，或复制需要的文字。',422);
    }
  }
  create(p:Principal,input:z.infer<typeof contentSourceInput>,capture:SourceCapture) {
    this.rights(p,input.workspaceId,input.rights);
    if(input.kind==='video'){
      const a=this.repo.asset(p,input.assetId);assertUsableAsset(a);
      if(a.workspaceId!==input.workspaceId||a.version!==capture.origin.assetVersion||a.sha256!==capture.origin.assetSHA256)throw new AppError('CONTENT_VIDEO_UNAVAILABLE','读取期间视频来源已变化，请重新选择。',409);
    }
    const quota=this.repo.get<{n:number;bytes:number}>('SELECT count(*) n,coalesce(sum(length(text)),0) bytes FROM studio_content_sources WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=?',p.tenantId,input.workspaceId,this.config.providerMode,this.config.appEnv)!;
    if(quota.n>=200||quota.bytes+capture.text.length>6000000)throw new AppError('CONTENT_QUOTA_EXCEEDED','本空间内容来源达到本地容量限制，请联系管理员整理后重试。',409);
    const id=randomUUID(),time=now();
    this.repo.run('INSERT INTO studio_content_sources(id,tenant_id,workspace_id,name,kind,text,paragraphs,material_sha256,text_sha256,origin,warnings,subject,proof,expires_at,environment,app_env,actor_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id,p.tenantId,input.workspaceId,input.name,input.kind,capture.text,JSON.stringify(capture.paragraphs),capture.materialSHA256,capture.textSHA256,JSON.stringify(capture.origin),JSON.stringify(capture.warnings),input.rights.subject,input.rights.proof,input.rights.expiresAt,this.config.providerMode,this.config.appEnv,p.userId,time,time);
    this.repo.run('INSERT INTO studio_content_source_versions VALUES (?,1,?,?,?,?,?)',id,'captured',capture.materialSHA256,capture.textSHA256,p.userId,time);
    return id;
  }
  withdraw(p:Principal,r:SourceRow,version:number) {
    this.scope(p,r.workspace_id,true);
    if(r.version!==version)throw new AppError('VERSION_CONFLICT','来源已更新，请载入当前状态后再撤回。',409);
    if(r.withdrawn)throw new AppError('CONTENT_ALREADY_WITHDRAWN','来源已经撤回，请新建有当前授权的来源。',409);
    const time=now();
    this.repo.run('UPDATE studio_content_sources SET withdrawn=1,version=version+1,updated_at=? WHERE id=?',time,r.id);
    this.repo.run('INSERT INTO studio_content_source_versions VALUES (?,?,?,?,?,?,?)',r.id,r.version+1,'withdrawn',r.material_sha256,r.text_sha256,p.userId,time);
    return r.id;
  }
  brief(p:Principal,id:string,write=false) {
    const r=this.repo.get<BriefRow>('SELECT * FROM studio_content_briefs WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.config.providerMode,this.config.appEnv);
    if(!r)throw new AppError('NOT_FOUND','账号定位不存在或不在当前环境。',404);this.scope(p,r.workspace_id,write);return r;
  }
  briefView(p:Principal,r:BriefRow):ContentBrief {this.scope(p,r.workspace_id);return {...contentBriefConfig.parse(JSON.parse(r.configuration)),id:r.id,workspaceId:r.workspace_id,version:r.version,updatedAt:r.updated_at};}
  saveBrief(p:Principal,workspaceId:string,configuration:z.infer<typeof contentBriefConfig>,previous?:BriefRow,version?:number) {
    this.scope(p,workspaceId,true);
    const topics=configuration.topics.map(t=>t.normalize('NFKC').toLowerCase());
    if(new Set(topics).size!==topics.length)throw new AppError('CONTENT_DUPLICATE_TOPIC','选题重复，请合并后再保存。',422);
    if(previous&&previous.version!==version)throw new AppError('VERSION_CONFLICT','账号定位已被另一窗口修改，当前输入保留；请先载入当前版本。',409);
    if(!previous && this.repo.get<{n:number}>('SELECT count(*) n FROM studio_content_briefs WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=?',p.tenantId,workspaceId,this.config.providerMode,this.config.appEnv)!.n>=100)throw new AppError('CONTENT_QUOTA_EXCEEDED','本空间账号定位已达100项，请编辑已有定位。',409);
    const id=previous?.id||randomUUID(),time=now(),payload=JSON.stringify(configuration);
    if(previous)this.repo.run('UPDATE studio_content_briefs SET configuration=?,version=version+1,updated_at=? WHERE id=?',payload,time,id);
    else this.repo.run('INSERT INTO studio_content_briefs(id,tenant_id,workspace_id,configuration,environment,app_env,actor_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',id,p.tenantId,workspaceId,payload,this.config.providerMode,this.config.appEnv,p.userId,time,time);
    this.repo.run('INSERT INTO studio_content_brief_versions VALUES (?,?,?,?,?)',id,(previous?.version||0)+1,payload,p.userId,time);
    return id;
  }
}
