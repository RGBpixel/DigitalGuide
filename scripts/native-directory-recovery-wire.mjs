import fs from 'node:fs';
import assert from 'node:assert/strict';
const edit=(file,transform)=>{const original=fs.readFileSync(file,'utf8'),changed=transform(original);assert.notEqual(changed,original,file);fs.writeFileSync(file,changed);};
edit('packages/postgres/src/recovery-directory-selection.ts',s=>s.replace('c.id IN(SELECT id FROM dg_scim_changed_connectors)','EXISTS(SELECT 1 FROM dg_scim_changed_connectors direct WHERE direct.tenant_id=c.tenant_id AND direct.environment=c.environment AND direct.app_env=c.app_env AND direct.id=c.id)'));
edit('packages/postgres/src/recovery-state-chain.ts',s=>{
 s="import {readDirectoryAuthorityApplication,type DirectoryAuthorityApplication} from './recovery-directory-receipts.js';\nimport {recoveryDirectoryRulesSHA256} from './recovery-directory-selection.js';\n"+s;
 s=s.replace("|'identity_authority_v1';","|'identity_authority_v1'|'directory_authority_v1';").replace("'authority_v1','identity_authority_v1']","'authority_v1','identity_authority_v1','directory_authority_v1']");
 s=s.replace(" if(kind==='identity_authority_v1')", " if(kind==='directory_authority_v1'){if(!await ensureRecoveryOperationObject(context.client,'directory_authority'))throw invalid();return readDirectoryAuthorityApplication(context.client,context.policy.backupId,context.previous!.id);}\n if(kind==='identity_authority_v1')");
 s=s.replace("e.kind==='privacy_v1'?recoveryPrivacyRulesSHA256:","e.kind==='directory_authority_v1'?recoveryDirectoryRulesSHA256:e.kind==='privacy_v1'?recoveryPrivacyRulesSHA256:");
 return s.replace('application:PrivacyApplication|AuthorityApplication|IdentityAuthorityApplication)','application:PrivacyApplication|AuthorityApplication|IdentityAuthorityApplication|DirectoryAuthorityApplication)');
});
edit('packages/postgres/src/recovery-authority.ts',s=>{
 s="import {readDirectoryAuthorityApplication} from './recovery-directory-receipts.js';\nimport {recoveryDirectoryRulesSHA256} from './recovery-directory-selection.js';\n"+s;
 const needle=' if(prior&&(prior.application.runtimeId';assert.ok(s.includes(needle));
 return s.replace(needle," if(context.identity.tables.has('enterprise_directory_group_access')){const ready=await ensureRecoveryOperationObject(context.client,'directory_authority'),directory=ready?await readDirectoryAuthorityApplication(context.client,context.policy.backupId,plan.id):undefined;if(!directory||directory.application.runtimeId!==context.policy.runtimeId||directory.application.streamId!==context.identity.streamId||directory.application.headSHA256!==plan.head_sha256||directory.application.rulesSHA256!==recoveryDirectoryRulesSHA256||!await verifyRecoveryStateContinuation(context,directory.application.afterDatabaseSHA256,before))throw fail('SCIM_RECONCILIATION_REQUIRED','恢复库含SCIM目录与组授权，请先执行directory-preview及明确的directory-apply，不能以旧身份收据代替目录核对。');}\n"+needle);
});
edit('scripts/postgres-recovery.ts',s=>{
 s="import {previewNativeRecoveryDirectory,applyNativeRecoveryDirectory} from '../packages/postgres/src/recovery-directory-authority.js';\n"+s;
 s=s.replace("const common=['root'", "const common=['root'");
 s=s.replace("'identity-preview':privacyCommon", "'directory-preview':privacyCommon,'directory-apply':[...privacyCommon,'preview-sha256','confirm-directory-restriction'],'identity-preview':privacyCommon");
 s=s.replace("'confirm-identity-restriction'].includes", "'confirm-identity-restriction','confirm-directory-restriction'].includes");
 const needle="   else if(command==='identity-preview')";assert.ok(s.includes(needle));s=s.replace(needle,"   else if(command==='directory-preview')result=await previewNativeRecoveryDirectory({...options,loader:loadConnectionConfig(required('loader-file')),dataDir:required('data-dir'),storeDir:required('store-dir'),planId:required('plan-id')});\n   else if(command==='directory-apply')result=await applyNativeRecoveryDirectory({...options,loader:loadConnectionConfig(required('loader-file')),dataDir:required('data-dir'),storeDir:required('store-dir'),planId:required('plan-id'),previewSHA256:required('preview-sha256'),confirmed:values.has('confirm-directory-restriction')});\n"+needle);
 return s.replace('日志锁可用inspect/unlock', 'directory-preview使用同一计划参数核对SCIM目录组与来源；directory-apply另需 --preview-sha256 <固定摘要> --confirm-directory-restriction。先identity再directory后基础撤权，不恢复同步、身份或生产业务。\\n日志锁可用inspect/unlock');
});
