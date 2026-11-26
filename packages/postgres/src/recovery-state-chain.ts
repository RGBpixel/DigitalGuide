import {readDirectoryErasureApplication,type DirectoryErasureApplication} from './recovery-directory-erasure-receipts.js';
import {recoveryDirectoryErasureRulesSHA256} from './recovery-directory-erasure-selection.js';
import {readDirectoryAuthorityApplication,type DirectoryAuthorityApplication} from './recovery-directory-receipts.js';
import {recoveryDirectoryRulesSHA256} from './recovery-directory-selection.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {RecoveryError} from '../../recovery/src/guard.js';
import {ensureRecoveryOperationObject,recoveryOperationTable} from './recovery-operation-objects.js';
import {ensureRecoveryPrivacyReceipts,readPrivacyApplication,type PrivacyApplication} from './recovery-privacy-receipts.js';
import {readAuthorityApplication,type AuthorityApplication} from './recovery-authority-receipts.js';
import {journalSHA} from './recovery-journal-format.js';
import {recoveryPrivacyRulesSHA256} from './recovery-privacy-selection.js';
import {recoveryAuthorityRulesSHA256} from './recovery-authority-selection.js';
import {readIdentityAuthorityApplication,type IdentityAuthorityApplication} from './recovery-identity-receipts.js';
import {recoveryIdentityRulesSHA256} from './recovery-identity-selection.js';
import type {VerifiedJournalContext} from './recovery-journal-plan.js';

export type RecoveryStateKind='privacy_v1'|'authority_v1'|'identity_authority_v1'|'directory_authority_v1'|'directory_erasure_v1';
const edgeSchema=z.object({id:z.uuid(),backup_id:z.uuid(),plan_id:z.uuid(),head_sha256:journalSHA,kind:z.enum(['privacy_v1','authority_v1','identity_authority_v1','directory_authority_v1','directory_erasure_v1']),receipt_id:z.uuid(),before_sha256:journalSHA,after_sha256:journalSHA,created_at:z.iso.datetime()}).strict(),invalid=()=>new RecoveryError('PG_RECOVERY_STATE_CHAIN_INVALID','恢复操作状态链缺失、分叉、循环或未绑定已验证的操作收据。');
async function applicationForEdge(context:VerifiedJournalContext,kind:RecoveryStateKind){
 if(kind==='directory_erasure_v1'){if(!await ensureRecoveryOperationObject(context.client,'directory_erasure'))throw invalid();return readDirectoryErasureApplication(context.client,context.policy.backupId,context.previous!.id);}
 if(kind==='directory_authority_v1'){if(!await ensureRecoveryOperationObject(context.client,'directory_authority'))throw invalid();return readDirectoryAuthorityApplication(context.client,context.policy.backupId,context.previous!.id);}
 if(kind==='identity_authority_v1'){if(!await ensureRecoveryOperationObject(context.client,'identity_authority'))throw invalid();return readIdentityAuthorityApplication(context.client,context.policy.backupId,context.previous!.id);}
 if(kind==='privacy_v1'){if(!await ensureRecoveryPrivacyReceipts(context.client,false))throw invalid();await context.client.query('LOCK TABLE public._dg_native_recovery_privacy_receipts IN SHARE ROW EXCLUSIVE MODE');await ensureRecoveryPrivacyReceipts(context.client,false);return readPrivacyApplication(context.client,context.policy.backupId,context.previous!.id);}
 if(!await ensureRecoveryOperationObject(context.client,'authority'))throw invalid();return readAuthorityApplication(context.client,context.policy.backupId,context.previous!.id);
}
export async function verifyRecoveryStateContinuation(context:VerifiedJournalContext,from:string,to:string){
 const installed=await ensureRecoveryOperationObject(context.client,'state');if(from===to)return true;if(!installed)return false;let current=from;const seen=new Set<string>();
 for(let n=0;n<Math.min(context.cap.maxFiles,64);n++){
  if(seen.has(current))throw invalid();seen.add(current);const rows=(await context.client.query('SELECT * FROM '+recoveryOperationTable('state')+' WHERE backup_id=$1 AND plan_id=$2 AND before_sha256=$3',[context.policy.backupId,context.previous!.id,current])).rows;if(!rows.length)return false;if(rows.length!==1)throw invalid();const parsed=edgeSchema.safeParse(rows[0]);if(!parsed.success)throw invalid();const e=parsed.data;if(e.head_sha256!==context.previous!.head_sha256||e.before_sha256===e.after_sha256)throw invalid();
  const receipt=await applicationForEdge(context,e.kind);if(!receipt||receipt.id!==e.receipt_id||receipt.application.runtimeId!==context.policy.runtimeId||receipt.application.streamId!==context.identity.streamId||receipt.application.generation!==context.head.metadata.generation||receipt.application.rulesSHA256!==(e.kind==='directory_erasure_v1'?recoveryDirectoryErasureRulesSHA256:e.kind==='directory_authority_v1'?recoveryDirectoryRulesSHA256:e.kind==='privacy_v1'?recoveryPrivacyRulesSHA256:e.kind==='identity_authority_v1'?recoveryIdentityRulesSHA256:recoveryAuthorityRulesSHA256)||receipt.application.headSHA256!==e.head_sha256||receipt.application.beforeDatabaseSHA256!==e.before_sha256||receipt.application.afterDatabaseSHA256!==e.after_sha256||receipt.application.createdAt!==e.created_at)throw invalid();current=e.after_sha256;if(current===to)return true;
 }
 throw invalid();
}
export async function appendRecoveryStateEdge(context:VerifiedJournalContext,kind:RecoveryStateKind,receiptId:string,application:PrivacyApplication|AuthorityApplication|IdentityAuthorityApplication|DirectoryAuthorityApplication|DirectoryErasureApplication){
 if(application.beforeDatabaseSHA256===application.afterDatabaseSHA256)return;
 await ensureRecoveryOperationObject(context.client,'state',true);const receipt=await applicationForEdge(context,kind);if(!receipt||receipt.id!==receiptId||receipt.application.beforeDatabaseSHA256!==application.beforeDatabaseSHA256||receipt.application.afterDatabaseSHA256!==application.afterDatabaseSHA256||receipt.application.headSHA256!==context.previous!.head_sha256)throw invalid();
 await context.client.query('INSERT INTO '+recoveryOperationTable('state')+'(id,backup_id,plan_id,head_sha256,kind,receipt_id,before_sha256,after_sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),application.backupId,application.planId,application.headSHA256,kind,receiptId,application.beforeDatabaseSHA256,application.afterDatabaseSHA256,application.createdAt]);
}
