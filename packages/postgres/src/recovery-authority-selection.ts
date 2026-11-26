import {canonical} from '../../domain/src/index.js';
import {RecoveryError} from '../../recovery/src/guard.js';
import {identifier} from './config.js';
import {journalDigest} from './recovery-journal-format.js';
import type {VerifiedJournalContext} from './recovery-journal-plan.js';

export const recoveryAuthorityAlgorithm='restored-authority-conservative-v1' as const;
const rules={memberships:['memberships','users'],assets:['assets'],consents:['consents','changed_asset_consents'],effect:'viewer-with-empty-workspaces;archive-changed-assets;revoke-corresponding-consents;invalidate-all-old-logins'};
export const recoveryAuthorityRulesSHA256=journalDigest(canonical(rules));
export async function selectRecoveryAuthority(context:VerifiedJournalContext){
 const{client,identity,cap}=context,coverage=(await client.query<{coverage:{tableName:string;keys:string[]}[]}>('SELECT coverage FROM _dg_native_recovery_journal_control WHERE id=1')).rows[0].coverage,keys=new Map(coverage.map(t=>[t.tableName,t.keys]));
 await client.query('CREATE TEMP TABLE dg_recovery_authority_delta ON COMMIT DROP AS SELECT s.* FROM pg_temp.dg_journal_stage s LEFT JOIN _dg_native_recovery_journal_events b ON b.id=s.id WHERE b.id IS NULL');await client.query("CREATE INDEX ON pg_temp.dg_recovery_authority_delta((payload->>'tableName'))");
 const match=(table:string)=>{const k=keys.get(table);if(!k?.length||!identity.tables.has(table))throw new RecoveryError('PG_RECOVERY_AUTHORITY_RULE_UNAVAILABLE','恢复库缺少撤权规则所需的表与主键覆盖。');return{sql:'SELECT r.* FROM '+identifier(table)+" r WHERE EXISTS(SELECT 1 FROM pg_temp.dg_recovery_authority_delta d WHERE d.payload->>'tableName'=$1 AND(d.payload->>'operation'='T' OR dg_native_recovery_journal_key($2,$1,to_jsonb(r),$3::text[]) IN(d.payload->>'recordHash',d.payload->>'nextRecordHash')))",args:[table,identity.streamId,k]};};
 for(const[table,temp]of [['memberships','dg_recovery_member_rows'],['users','dg_recovery_user_rows'],['assets','dg_recovery_asset_rows'],['consents','dg_recovery_consent_rows']] as const){const m=match(table);await client.query('CREATE TEMP TABLE '+temp+' ON COMMIT DROP AS '+m.sql,m.args);}
 await client.query("CREATE TEMP TABLE dg_recovery_membership_candidates ON COMMIT DROP AS SELECT m.user_id FROM memberships m WHERE(m.role<>'viewer' OR m.workspace_ids::jsonb<>'[]'::jsonb) AND(m.user_id IN(SELECT user_id FROM pg_temp.dg_recovery_member_rows) OR m.user_id IN(SELECT id FROM pg_temp.dg_recovery_user_rows))");
 await client.query('CREATE TEMP TABLE dg_recovery_asset_candidates ON COMMIT DROP AS SELECT a.id FROM assets a WHERE a.id IN(SELECT id FROM pg_temp.dg_recovery_asset_rows) AND a.archived<>1');
 await client.query('CREATE TEMP TABLE dg_recovery_consent_candidates ON COMMIT DROP AS SELECT c.id FROM consents c WHERE c.revoked_at IS NULL AND(c.id IN(SELECT id FROM pg_temp.dg_recovery_consent_rows) OR c.asset_id IN(SELECT id FROM pg_temp.dg_recovery_asset_rows))');
 const counts=(await client.query<{memberships:number;assets:number;consents:number;logins:number}>("SELECT(SELECT count(*)::int FROM pg_temp.dg_recovery_membership_candidates) memberships,(SELECT count(*)::int FROM pg_temp.dg_recovery_asset_candidates) assets,(SELECT count(*)::int FROM pg_temp.dg_recovery_consent_candidates) consents,(SELECT count(*)::int FROM auth_sessions) logins")).rows[0];
 if(counts.memberships+counts.assets+counts.consents>Math.min(cap.maxRows,10000))throw new RecoveryError('PG_RECOVERY_AUTHORITY_LIMIT_EXCEEDED','单次撤权超过10000条或当前容量，未修改业务数据。');
 const fingerprints=(await client.query<{kind:string;hash:string}>("SELECT 'membership' kind,dg_native_recovery_journal_key($1,'memberships',to_jsonb(m),ARRAY['user_id']) hash FROM memberships m JOIN pg_temp.dg_recovery_membership_candidates c ON c.user_id=m.user_id UNION ALL SELECT 'asset' kind,dg_native_recovery_journal_key($1,'assets',to_jsonb(a),ARRAY['id']) hash FROM assets a JOIN pg_temp.dg_recovery_asset_candidates c ON c.id=a.id UNION ALL SELECT 'consent' kind,dg_native_recovery_journal_key($1,'consents',to_jsonb(a),ARRAY['id']) hash FROM consents a JOIN pg_temp.dg_recovery_consent_candidates c ON c.id=a.id ORDER BY kind,hash",[identity.streamId])).rows;
 const unsupported=(await client.query<{table:string;events:number}>("SELECT payload->>'tableName' AS table,count(*)::int events FROM pg_temp.dg_recovery_authority_delta WHERE NOT(payload->>'tableName'=ANY($1::text[])) GROUP BY 1 ORDER BY 1",[['memberships','users','assets','consents']])).rows;
 return{...counts,selectionSHA256:journalDigest(canonical(fingerprints)),unsupported};
}
