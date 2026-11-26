import { randomUUID } from 'node:crypto';
import type { FastifyRequest,FastifyReply } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { AppError,assertUsableAsset,requirePermission } from '@digitalguide/domain';
import { consentInput,id } from '@digitalguide/contracts';
import type { Config } from './config.js';
import { authenticatedSession } from './auth-check.js';
import { executeIdempotent } from './idempotency.js';
export function grantAssetConsent(repo:Repository,config:Config,req:FastifyRequest,reply:FastifyReply){
 const input=consentInput.parse(req.body),assetId=id.parse((req.params as {id:string}).id),guard=()=>{const p=authenticatedSession(repo,req,config).principal;requirePermission(p,'asset.train');const asset=repo.asset(p,assetId);assertUsableAsset(asset);if(input.purpose==='character_use'&&!['image/png','video/mp4','model/gltf-binary','application/vnd.digitalguide.puppet+json'].includes(asset.mediaType))throw new AppError('CHARACTER_REFERENCE_SCOPE','形象使用授权只适用于图片、视频及受支持的二维/三维来源。',409);if(input.purpose==='voice_style'&&asset.mediaType!=='audio/wav')throw new AppError('VOICE_REFERENCE_SCOPE','语气用途授权只适用于WAV声音参考。',409);if(input.expiresAt<=new Date().toISOString())throw new AppError('CONSENT_REQUIRED','授权已到期，请重新登记有效授权。',409);return {p,asset};};
 const {p}=guard(),result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>{const {p,asset}=guard(),consentId=randomUUID();repo.run('INSERT INTO consents VALUES (?,?,?,?,?,?,?,?,?,NULL,?)',consentId,p.tenantId,asset.workspaceId,asset.id,input.purpose,input.subject,input.proof,input.noticeVersion,input.expiresAt,new Date().toISOString());repo.audit(p,asset.workspaceId,'consent.grant',consentId,req.id);return {id:consentId};},201);
 // Legacy cache entries also contain id. Re-project the current record rather
 // than replaying an old non-revoked response or a previous workspace's data.
 const data=repo.transaction(()=>{const {p,asset}=guard(),row=repo.get('SELECT id,asset_id AS assetId,purpose,subject,expires_at AS expiresAt,revoked_at AS revokedAt FROM consents WHERE id=? AND asset_id=? AND tenant_id=?',result.data.id,asset.id,p.tenantId);if(!row)throw new AppError('NOT_FOUND','授权记录已不可用，请载入当前状态。',404);return row;});return reply.code(result.code).send({data,requestId:req.id});
}
export function revokeAssetConsent(repo:Repository,config:Config,req:FastifyRequest,reply:FastifyReply){
 const consentId=id.parse((req.params as {id:string}).id),guard=()=>{const p=authenticatedSession(repo,req,config).principal;requirePermission(p,'asset.train');const row=repo.get<{asset_id:string;workspace_id:string;revoked_at:string|null}>('SELECT asset_id,workspace_id,revoked_at FROM consents WHERE id=? AND tenant_id=?',consentId,p.tenantId);if(!row)throw new AppError('NOT_FOUND','授权不存在或无权访问。',404);const asset=repo.asset(p,row.asset_id);if(asset.workspaceId!==row.workspace_id)throw new AppError('CONSENT_SCOPE','授权和素材的工作空间不一致。',409);return {p,row};};
 const {p}=guard(),result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>{const {p,row}=guard();repo.run('UPDATE consents SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND tenant_id=?',new Date().toISOString(),consentId,p.tenantId);repo.audit(p,row.workspace_id,'consent.revoke',consentId,req.id);return {id:consentId};});const current=guard();return reply.code(result.code).send({data:{revoked:current.row.revoked_at!==null},requestId:req.id});
}
