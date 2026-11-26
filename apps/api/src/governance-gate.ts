import fs from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {Repository} from '@digitalguide/database';
import {AppError,canonical,requirePermission,requireWorkspace,type Principal} from '@digitalguide/domain';
import {governancePolicyDefinition,governancePublicReceiptSchema,type GovernancePublicReceipt} from '@digitalguide/contracts';
import {ownedFile} from '../../../packages/media/src/files.js';
import type {Config} from './config.js';
import type {DistributionFile,VariantRow,DistributionService} from './distribution-service.js';
export const governanceDigest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export interface GovernancePolicyRow{id:string;tenant_id:string;workspace_id:string;actor_id:string;platform:VariantRow['platform'];name:string;definition:string;definition_hash:string;version:number;enabled:number;updated_at:string}
export interface GovernanceDeliveryRow{id:string;tenant_id:string;workspace_id:string;actor_id:string;variant_id:string;variant_version:number;platform:VariantRow['platform'];policy_id:string;policy_version:number;policy_hash:string;source_hash:string;source_snapshot:string;input:string;plan:string;plan_hash:string;public_id:string;status:'queued'|'rendering'|'ready'|'failed'|'cancelled'|'withdrawn';version:number;attempts:number;progress:number;lease_token:string|null;lease_until:string|null;error_message:string|null;created_at:string;updated_at:string}
export interface GovernanceReviewRow{id:string;delivery_id:string;requester_id:string;reviewer_id:string;snapshot_hash:string;status:'pending'|'approved'|'changes_requested';version:number;note:string;acknowledged_issues:string;decision_at:string|null;invalidated_at:string|null;invalidation_reason:string|null;created_at:string}
export interface GovernanceArtifactRow{id:string;delivery_id:string;kind:'video'|'cover';name:string;media_type:string;storage_key:string;size:number;sha256:string}
export const policyFingerprint=(p:GovernancePolicyRow)=>governanceDigest({id:p.id,version:p.version,name:p.name,enabled:!!p.enabled,definitionHash:p.definition_hash});
export function provenanceSigningSecret(config:Config){if(config.provenanceSecret&&config.provenanceSecret.length>=48)return config.provenanceSecret;if(!config.provenanceSecret&&config.appEnv!=='production'&&config.providerMode==='mock')return config.sessionSecret;throw new AppError('PROVENANCE_SIGNING_NOT_CONFIGURED','生成来源签名未配置，请在服务端设置独立的 CONTENT_PROVENANCE_SIGNING_KEY（至少48字符）。',503);}
export function parsedPolicy(p:GovernancePolicyRow){const d=governancePolicyDefinition.parse(JSON.parse(p.definition));if(governanceDigest(d)!==p.definition_hash)throw new AppError('GOVERNANCE_POLICY_CHANGED','渠道规则内容与摘要不符，请联系管理员。',409);return d;}
export const signGovernanceReceipt=(receipt:Omit<GovernancePublicReceipt,'signature'>,secret:string)=>createHmac('sha256',secret).update('digitalguide-generation-receipt-v1\n'+canonical(receipt)).digest('hex');
export function governanceReviewSnapshot(d:GovernanceDeliveryRow,artifacts:GovernanceArtifactRow[]){return governanceDigest({planHash:d.plan_hash,sourceHash:d.source_hash,policyHash:d.policy_hash,files:artifacts.map(a=>({id:a.id,kind:a.kind,sha256:a.sha256,size:a.size})).sort((a,b)=>a.kind.localeCompare(b.kind))});}
export function reviewerReason(repo:Repository,d:GovernanceDeliveryRow,r:GovernanceReviewRow,artifacts:GovernanceArtifactRow[]):string|null{
 if(r.invalidated_at)return r.invalidation_reason||'审核已撤回或成员权限已变化。';
 try{const p=repo.principal(r.reviewer_id),requester=repo.principal(r.requester_id);requirePermission(p,'studio.approve');requireWorkspace(p,d.workspace_id);requirePermission(requester,'studio.write');requireWorkspace(requester,d.workspace_id);if(p.tenantId!==d.tenant_id||requester.tenantId!==d.tenant_id||p.userId===d.actor_id||p.userId===r.requester_id) return '审核人与制作/提交人不独立。';if(d.status!=='ready'||governanceReviewSnapshot(d,artifacts)!==r.snapshot_hash)return '实际文件或固定计划已变化，请重新审核。';return null;}catch(e){return e instanceof AppError?e.message:'成员或文件无法核对。';}
}
export function governanceReceipt(repo:Repository,config:Config,d:GovernanceDeliveryRow,review:GovernanceReviewRow){
 const row=repo.get<{receipt:string;receipt_hash:string}>('SELECT receipt,receipt_hash FROM content_governance_receipts WHERE delivery_id=? AND review_id=?',d.id,review.id);if(!row)throw new AppError('GOVERNANCE_RECEIPT_REQUIRED','已批准记录缺少固定来源回执，请重新审核。',409);
 const receipt=governancePublicReceiptSchema.parse(JSON.parse(row.receipt));if(governanceDigest(receipt)!==row.receipt_hash)throw new AppError('GOVERNANCE_RECEIPT_CHANGED','生成来源回执摘要不符。',409);const {signature,...unsigned}=receipt,expected=signGovernanceReceipt(unsigned,provenanceSigningSecret(config));if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new AppError('GOVERNANCE_RECEIPT_SIGNATURE','生成来源签名无法由当前服务核对，请重新审核签发。',409);return receipt;
}
type BaseRelease=ReturnType<DistributionService['baseReleased']>;
export function applyGovernance(repo:Repository,config:Config,p:Principal,v:VariantRow,base:BaseRelease):BaseRelease&{metadata:BaseRelease['metadata']&{governance?:GovernancePublicReceipt}}{
 const policy=repo.get<GovernancePolicyRow>('SELECT * FROM content_governance_policies WHERE tenant_id=? AND workspace_id=? AND platform=? AND environment=? AND app_env=?',p.tenantId,v.workspace_id,v.platform,config.providerMode,config.appEnv);
 if(!policy){if(config.providerMode==='live'||config.appEnv==='production')throw new AppError('GOVERNANCE_POLICY_REQUIRED','当前渠道尚未配置来源、审核与AI标识规则，不能用于真实传播。',409);return base;}
 parsedPolicy(policy);if(!policy.enabled)throw new AppError('GOVERNANCE_POLICY_DISABLED','当前渠道规则已停用，请管理员核对规则；不会退回无标识版本。',409);
 const records=repo.all<GovernanceDeliveryRow>('SELECT * FROM content_governance_deliveries WHERE variant_id=? AND variant_version=? AND policy_id=? AND policy_version=? AND policy_hash=? AND source_hash=? ORDER BY rowid DESC LIMIT 1',v.id,v.version,policy.id,policy.version,policyFingerprint(policy),base.hash);
 for(const d of records){
  try{
   if(d.status!=='ready')continue;
   const actor=repo.principal(d.actor_id);requirePermission(actor,'studio.write');requireWorkspace(actor,d.workspace_id);if(actor.tenantId!==d.tenant_id)continue;
   const artifacts=repo.all<GovernanceArtifactRow>('SELECT * FROM content_governance_artifacts WHERE delivery_id=? ORDER BY kind',d.id);if(artifacts.length!==2)continue;
   const review=repo.all<GovernanceReviewRow>('SELECT * FROM content_governance_reviews WHERE delivery_id=? AND status=\'approved\' ORDER BY decision_at DESC,id DESC',d.id).find(r=>!reviewerReason(repo,d,r,artifacts));if(!review)continue;
   const receipt=governanceReceipt(repo,config,d,review),replaced=base.files.map<DistributionFile>(f=>{const a=artifacts.find(a=>a.kind===f.kind);if(!a)return f;const file=ownedFile(path.join(config.dataDir,'objects'),a.storage_key),stat=fs.statSync(file);if(!stat.isFile()||stat.size!==a.size)throw new AppError('GOVERNANCE_MEDIA_MISSING','带标识文件缺失或大小变化，请重新制作并审核。',409);return{file,name:a.name,kind:a.kind,size:a.size,sha256:a.sha256};});
   for(const a of artifacts){const r=receipt.outputs.find(o=>o.kind===a.kind);if(!r||r.sha256!==a.sha256||r.size!==a.size)throw new AppError('GOVERNANCE_RECEIPT_CHANGED','来源回执与标识文件不一致。',409);}
   const metadata={...base.metadata,aiDisclosure:receipt.label+'。'+base.metadata.aiDisclosure,files:replaced.map(({name,kind,size,sha256})=>({name,kind,size,sha256})),governance:receipt};
   return{...base,files:replaced,metadata,videoUrl:'/api/v1/content-governance/deliveries/'+d.id+'/video',coverUrl:'/api/v1/content-governance/deliveries/'+d.id+'/cover',hash:governanceDigest({baseHash:base.hash,policyHash:policyFingerprint(policy),deliveryId:d.id,reviewId:review.id,receiptHash:governanceDigest(receipt),files:metadata.files})};
  }catch(e){if(!(e instanceof AppError)&&!(e instanceof Error&&'code'in e))throw e;}
 }
 throw new AppError('GOVERNANCE_APPROVAL_REQUIRED','此渠道要求带标识的成片、封面和生成来源通过独立审核；请到“内容审核与标识”处理当前版本。',409);
}
