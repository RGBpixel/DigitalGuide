import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {resumeRecoveryCluster,observeRecoveryClusters} from './native-recovery-owned.js';
import {createPostgresClient} from '../packages/postgres/src/config.js';
import {withVerifiedNativeRecoveryJournal} from '../packages/postgres/src/recovery-journal-plan.js';
import {recoveryDatabaseDigest} from '../packages/postgres/src/recovery-reconciliation.js';
import {verifyRecoveryStateContinuation} from '../packages/postgres/src/recovery-state-chain.js';
import {readIdentityAuthorityApplication} from '../packages/postgres/src/recovery-identity-receipts.js';
const evidence='docs/evidence/T20/postgres-recovery-directory',read=(f:string)=>JSON.parse(fs.readFileSync(f,'utf8')),target=read(evidence+'/directory-target.json'),state=read(path.join(target.sourceRoot,'directory-recovery-state.private.json'));
assert.equal(read(evidence+'/directory-recovery-native-initial-command.json').result,'FAIL');
const cluster=await resumeRecoveryCluster(target.root,evidence+'/directory-before-retained-fixed-process-audit.json');
try{
 const client=createPostgresClient(cluster.connection);await client.connect();let planId:string;
 try{await client.query('SET search_path TO "'+state.schema+'",pg_catalog,pg_temp');planId=(await client.query('SELECT id FROM _dg_native_recovery_journal_plans ORDER BY generation DESC LIMIT 1')).rows[0].id;
 const person=(await client.query('SELECT status,display_name FROM people WHERE id=$1',[state.personId])).rows[0];assert.equal(person.status,'deleted');assert.equal(person.display_name,'已删除资料');
 const asset=(await client.query('SELECT archived FROM assets WHERE id=$1',[state.assetId])).rows[0];assert.equal(Number(asset.archived),1);
 const kinds=(await client.query('SELECT kind FROM public._dg_native_recovery_state_receipts ORDER BY kind')).rows.map(r=>r.kind);assert.deepEqual(kinds,['authority_v1','directory_authority_v1','identity_authority_v1','privacy_v1']);
 assert.equal(Number((await client.query('SELECT attempts FROM jobs WHERE id=$1',[state.queueId])).rows[0].attempts),0);
 }finally{await client.end();}
 const options={loader:cluster.connection,dataDir:state.dataDir,storeDir:state.storeDir,keyFile:state.keyFile,planId};
 const verified=await withVerifiedNativeRecoveryJournal(options,async context=>{const receipt=await readIdentityAuthorityApplication(context.client,context.policy.backupId,planId);assert.ok(receipt);return verifyRecoveryStateContinuation(context,receipt.application.beforeDatabaseSHA256,await recoveryDatabaseDigest(context,options));});assert.equal(verified,true);
 fs.writeFileSync(evidence+'/directory-retained-chain-supplement.json',JSON.stringify({result:'PASS_RETAINED_FOUR_STAGE_DIRECTORY_CHAIN',checkedAt:new Date().toISOString(),checksPassed:1,root:target.root,actualDeletedPersonStatus:true,personNameCleared:true,assetArchived:true,allFourReceiptKindsRetained:true,verifiedContinuationFromBeforeIdentityThroughAllFourOperations:true,originalTenSuccessfulNativeCasesNotRepeated:true,backupRepeated:false,restoreRepeated:false,identityApplyRepeated:false,directoryApplyRepeated:false,privacyApplyRepeated:false,authorityApplyRepeated:false,originalAssertionFailuresPreserved:true,activationAllowed:false,mainRestarted:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'PASS_RETAINED_FOUR_STAGE_DIRECTORY_CHAIN',checks:1}));
}finally{try{await observeRecoveryClusters(evidence+'/observed-directory-retained-'+process.pid+'.json',[process.pid,cluster.child.pid!],cluster.connection.port);}finally{await cluster.stop();}}
