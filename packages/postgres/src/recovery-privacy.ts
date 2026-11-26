import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {canonical} from '../../domain/src/index.js';
import {RecoveryError} from '../../recovery/src/guard.js';
import {checkCancelled} from '../../recovery/src/files.js';
import {journalDigest,journalSHA} from './recovery-journal-format.js';
import {lockRecoveryReconciliation,recoveryDatabaseDigest} from './recovery-reconciliation.js';
import {withVerifiedNativeRecoveryJournal,type NativeJournalPlanOptions,type VerifiedJournalContext} from './recovery-journal-plan.js';
import {selectRecoveryPrivacyPeople,recoveryPrivacyAlgorithm,recoveryPrivacyRulesSHA256} from './recovery-privacy-selection.js';
import {ensureRecoveryPrivacyReceipts,readPrivacyApplication,insertPrivacyApplication,type PrivacyApplication} from './recovery-privacy-receipts.js';
import {verifyRecoveryStateContinuation,appendRecoveryStateEdge} from './recovery-state-chain.js';

export interface NativeRecoveryPrivacyOptions extends NativeJournalPlanOptions {planId:string}
export interface NativeRecoveryPrivacyApplyOptions extends NativeRecoveryPrivacyOptions {previewSHA256:string;confirmed:boolean}
const fail=(code:string,message:string)=>new RecoveryError(code,message);
function validPlan(id:string){if(!z.uuid().safeParse(id).success)throw fail('PG_RECOVERY_PRIVACY_ARGUMENT_INVALID','清理需要固定的恢复计划UUID。');}
function applicationReport(id:string,application:PrivacyApplication,reused:boolean){
 return{result:'PASS' as const,operation:'privacy-apply' as const,receiptId:id,...application,status:'privacy_applied' as const,reused,changesApplied:'personal_data_and_login_revocation' as const,wholePlanComplete:false,planStillPending:true,activationAllowed:false,productionFreshnessProven:false,remainingFamilies:['current_identity_and_permissions','assets_and_other_privacy_families','business_receipts','production_witness_and_activation']};
}
async function preparePrivacy(context:VerifiedJournalContext,input:NativeRecoveryPrivacyOptions){
 const plan=await lockRecoveryReconciliation(context,input),installed=await ensureRecoveryPrivacyReceipts(context.client,false);if(installed){await context.client.query('LOCK TABLE public._dg_native_recovery_privacy_receipts IN SHARE ROW EXCLUSIVE MODE');await ensureRecoveryPrivacyReceipts(context.client,false);}const prior=installed?await readPrivacyApplication(context.client,context.policy.backupId,plan.id):undefined,before=await recoveryDatabaseDigest(context,input);
 if(prior&&(prior.application.headSHA256!==plan.head_sha256||prior.application.runtimeId!==context.policy.runtimeId||prior.application.streamId!==context.identity.streamId||prior.application.rulesSHA256!==recoveryPrivacyRulesSHA256||!await verifyRecoveryStateContinuation(context,prior.application.afterDatabaseSHA256,before)))throw fail('PG_RECOVERY_PRIVACY_TARGET_CHANGED','已清理副本或规则与原收据及后续已验证操作链不符，不能直接复用；保留现场并重新核对。');
 return{plan,prior,before};
}
async function previewInTransaction(context:VerifiedJournalContext,input:NativeRecoveryPrivacyOptions,before:string){
 const selected=await selectRecoveryPrivacyPeople(context),logins=(await context.client.query<{n:number}>('SELECT count(*)::int n FROM auth_sessions')).rows[0].n;
 const previewSHA256=journalDigest(canonical({algorithm:recoveryPrivacyAlgorithm,rulesSHA256:recoveryPrivacyRulesSHA256,backupId:context.policy.backupId,planId:input.planId,headSHA256:journalDigest(context.headBytes),beforeDatabaseSHA256:before,selectionSHA256:selected.selectionSHA256,people:selected.people,logins,summary:selected.summary,unsupported:selected.unsupported}));
 return{result:'PASS' as const,operation:'privacy-preview' as const,algorithm:recoveryPrivacyAlgorithm,planId:input.planId,backupId:context.policy.backupId,generation:context.head.metadata.generation,headSHA256:journalDigest(context.headBytes),previewSHA256,beforeDatabaseSHA256:before,rulesSHA256:recoveryPrivacyRulesSHA256,selectionSHA256:selected.selectionSHA256,peopleToPurge:selected.people,loginsToInvalidate:logins,summary:selected.summary,unsupported:selected.unsupported,alreadyApplied:false,wholePlanComplete:false,activationAllowed:false,productionFreshnessProven:false};
}
export async function previewNativeRecoveryPrivacy(input:NativeRecoveryPrivacyOptions){
 validPlan(input.planId);return withVerifiedNativeRecoveryJournal(input,async context=>{
  context.phase('privacy_preview');const{prior,before}=await preparePrivacy(context,input);
  if(prior)return{result:'PASS' as const,operation:'privacy-preview' as const,algorithm:recoveryPrivacyAlgorithm,planId:input.planId,backupId:context.policy.backupId,generation:context.head.metadata.generation,headSHA256:prior.application.headSHA256,previewSHA256:prior.application.previewSHA256,beforeDatabaseSHA256:before,rulesSHA256:recoveryPrivacyRulesSHA256,selectionSHA256:prior.application.selectionSHA256,peopleToPurge:0,loginsToInvalidate:0,summary:[],unsupported:prior.application.unsupported,alreadyApplied:true,receiptId:prior.id,wholePlanComplete:false,activationAllowed:false,productionFreshnessProven:false};
  return previewInTransaction(context,input,before);
 },{privacyLocks:true});
}
async function assertPrivacyPostconditions(context:VerifiedJournalContext,expected:number){
 const row=(await context.client.query<{people:number;dirty:boolean}>("SELECT(SELECT count(*)::int FROM pg_temp.dg_recovery_people_candidates c JOIN people p ON p.id=c.person_id WHERE p.status='deleted' AND p.owner_user_id IS NULL AND p.guest_session_id IS NULL AND p.display_name='已删除资料' AND p.roles='[]' AND p.personalization=0) people,EXISTS(SELECT 1 FROM memory_facts f JOIN pg_temp.dg_recovery_people_candidates c ON c.person_id=f.person_id UNION ALL SELECT 1 FROM memory_notes f JOIN pg_temp.dg_recovery_people_candidates c ON c.person_id=f.person_id UNION ALL SELECT 1 FROM memory_lookup f JOIN pg_temp.dg_recovery_people_candidates c ON c.person_id=f.person_id UNION ALL SELECT 1 FROM memory_session_links f JOIN pg_temp.dg_recovery_people_candidates c ON c.person_id=f.person_id UNION ALL SELECT 1 FROM memory_session_greetings f JOIN pg_temp.dg_recovery_people_candidates c ON c.person_id=f.person_id UNION ALL SELECT 1 FROM memory_recovery_credentials f JOIN pg_temp.dg_recovery_people_candidates c ON c.person_id=f.person_id WHERE f.token_hash<>'' OR f.revoked_at IS NULL UNION ALL SELECT 1 FROM _dg_native_people_guards f JOIN pg_temp.dg_recovery_people_candidates c ON c.person_id=f.person_id WHERE f.invalidated_at IS NULL UNION ALL SELECT 1 FROM reception_messages m WHERE(m.memory_person_id IN(SELECT person_id FROM pg_temp.dg_recovery_people_candidates) OR EXISTS(SELECT 1 FROM pg_temp.dg_recovery_person_links l WHERE l.session_id=m.session_id AND l.focus_version=m.focus_version)) AND(m.text<>'' OR m.status<>'cancelled' OR m.knowledge_citations<>'[]')) dirty")).rows[0];
 if(row.people!==expected||row.dirty)throw fail('PG_RECOVERY_PRIVACY_POSTCONDITION_FAILED','关联资料、原文、索引或恢复凭证没有全部清理，已回滚本次操作。');
}
export async function applyNativeRecoveryPrivacy(input:NativeRecoveryPrivacyApplyOptions){
 validPlan(input.planId);if(!input.confirmed)throw fail('PG_RECOVERY_PRIVACY_CONFIRMATION_REQUIRED','此操作按保守策略实际清除受影响旧资料并使恢复登录失效，需要明确的清理确认。');if(!journalSHA.safeParse(input.previewSHA256).success)throw fail('PG_RECOVERY_PRIVACY_ARGUMENT_INVALID','清理需要本次预览的完整摘要。');
 return withVerifiedNativeRecoveryJournal(input,async context=>{
  const{client,policy,identity,head,phase}=context,{plan,prior,before}=await preparePrivacy(context,input);
  if(prior){if(input.previewSHA256!==prior.application.previewSHA256)throw fail('PG_RECOVERY_PRIVACY_PREVIEW_MISMATCH','此预览摘要不属于原清理收据。');return applicationReport(prior.id,prior.application,true);}
  const preview=await previewInTransaction(context,input,before);if(preview.previewSHA256!==input.previewSHA256)throw fail('PG_RECOVERY_PRIVACY_PREVIEW_MISMATCH','恢复数据、选择规则或清理范围在预览后改变，请重新预览。');
  phase('privacy_applying');await ensureRecoveryPrivacyReceipts(client);await client.query('CREATE TEMP TABLE dg_recovery_person_links ON COMMIT DROP AS SELECT l.session_id,l.focus_version FROM memory_session_links l JOIN pg_temp.dg_recovery_people_candidates c ON c.person_id=l.person_id');
  await client.query("SELECT set_config('digitalguide.recovery_privacy_plan',$1,true)",[plan.id]);const people=(await client.query<{person_id:string}>('SELECT person_id FROM pg_temp.dg_recovery_people_candidates ORDER BY person_id COLLATE "C"')).rows;
  for(const row of people){checkCancelled(input.signal);await client.query("SELECT dg_native_people_erase_internal($1,'recovery_conservative')",[row.person_id]);phase('privacy_subject_purged');}
  const deleted=await client.query('DELETE FROM auth_sessions');if(deleted.rowCount!==preview.loginsToInvalidate)throw fail('PG_RECOVERY_PRIVACY_POSTCONDITION_FAILED','旧登录数量与固定预览不符，已回滚清理。');
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');await assertPrivacyPostconditions(context,preview.peopleToPurge);const after=await recoveryDatabaseDigest(context,input),id=randomUUID(),application:PrivacyApplication={version:1,algorithm:recoveryPrivacyAlgorithm,planId:plan.id,backupId:policy.backupId,runtimeId:policy.runtimeId,streamId:identity.streamId,generation:head.metadata.generation,headSHA256:plan.head_sha256,previewSHA256:preview.previewSHA256,beforeDatabaseSHA256:before,afterDatabaseSHA256:after,peoplePurged:preview.peopleToPurge,loginsInvalidated:preview.loginsToInvalidate,selectionSHA256:preview.selectionSHA256,rulesSHA256:recoveryPrivacyRulesSHA256,summary:preview.summary,unsupported:preview.unsupported,remainingPlanEvents:Number(plan.delta_events),createdAt:new Date().toISOString()};
  await insertPrivacyApplication(client,id,application);await appendRecoveryStateEdge(context,'privacy_v1',id,application);phase('privacy_receipt_persisted');return applicationReport(id,application,false);
 },{privacyLocks:true});
}
