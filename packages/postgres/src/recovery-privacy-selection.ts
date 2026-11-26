import {canonical} from '../../domain/src/index.js';
import {RecoveryError} from '../../recovery/src/guard.js';
import {identifier} from './config.js';
import {journalDigest} from './recovery-journal-format.js';
import type {VerifiedJournalContext} from './recovery-journal-plan.js';

export const recoveryPrivacyAlgorithm='personal-data-conservative-v1' as const;
// Routing is reviewed here. The journal category and tenant hints never confer
// authority or select an arbitrary SQL table supplied by a caller.
const rules=[
 {table:'people',subjects:'SELECT id FROM matched'},
 ...['memory_facts','memory_notes','memory_lookup','memory_session_links','memory_session_greetings','memory_recovery_credentials','privacy_requests','_dg_native_people_guards','_dg_native_guest_memory_origins','_dg_native_guest_memory_actions','_dg_native_food_memory_import_origins'].map(table=>({table,subjects:'SELECT person_id AS id FROM matched'})),
 {table:'users',subjects:'SELECT p.id FROM people p JOIN matched m ON p.owner_user_id=m.id'},
 {table:'memberships',subjects:'SELECT p.id FROM people p JOIN matched m ON p.owner_user_id=m.user_id AND p.tenant_id=m.tenant_id'},
 {table:'reception_messages',subjects:'SELECT memory_person_id AS id FROM matched WHERE memory_person_id IS NOT NULL UNION SELECT l.person_id AS id FROM matched m JOIN memory_session_links l ON l.session_id=m.session_id AND l.focus_version=m.focus_version'},
 {table:'visits',subjects:'SELECT l.person_id AS id FROM matched m JOIN memory_session_links l ON l.session_id=m.session_id AND l.focus_version=m.focus_version'},
 {table:'dining_memory_imports',subjects:'SELECT o.person_id AS id FROM matched m JOIN _dg_native_food_memory_import_origins o ON o.import_id=m.id'},
 {table:'dining_preferences',subjects:'SELECT o.person_id AS id FROM matched m JOIN _dg_native_food_memory_import_origins o ON o.import_id=m.source_import_id'}
] as const;
export const recoveryPrivacyRulesSHA256=journalDigest(canonical(rules));
export interface RecoveryPrivacyRuleSummary {table:string;matchedRows:number;matchedPeople:number;newPeople:number}
export async function selectRecoveryPrivacyPeople(context:Pick<VerifiedJournalContext,'client'|'identity'|'cap'>){
 const{client,identity,cap}=context;
 await client.query('CREATE TEMP TABLE dg_recovery_delta ON COMMIT DROP AS SELECT s.* FROM pg_temp.dg_journal_stage s LEFT JOIN _dg_native_recovery_journal_events b ON b.id=s.id WHERE b.id IS NULL');
 await client.query("CREATE INDEX ON pg_temp.dg_recovery_delta((payload->>'tableName'))");
 await client.query('CREATE TEMP TABLE dg_recovery_people_candidates(person_id text PRIMARY KEY,record_hash text NOT NULL UNIQUE) ON COMMIT DROP');
 const coverage=(await client.query<{coverage:{tableName:string;keys:string[]}[]}>('SELECT coverage FROM _dg_native_recovery_journal_control WHERE id=1')).rows[0].coverage,keys=new Map(coverage.map(t=>[t.tableName,t.keys])),summary:RecoveryPrivacyRuleSummary[]=[];
 for(const rule of rules){
  const columns=keys.get(rule.table);if(!columns?.length||!identity.tables.has(rule.table))throw new RecoveryError('PG_RECOVERY_PRIVACY_RULE_UNAVAILABLE','备份缺少保守清理规则要求的表或主键覆盖。');
  const row=(await client.query<{matched_rows:number;matched_people:number;new_people:number}>(
   'WITH changes AS(SELECT payload p FROM pg_temp.dg_recovery_delta WHERE payload->>\'tableName\'=$1),matched AS MATERIALIZED(SELECT r.* FROM '+identifier(rule.table)+' r WHERE EXISTS(SELECT 1 FROM changes c WHERE c.p->>\'operation\'=\'T\' OR dg_native_recovery_journal_key($2,$1,to_jsonb(r),$3::text[]) IN(c.p->>\'recordHash\',c.p->>\'nextRecordHash\'))),subjects AS MATERIALIZED(SELECT DISTINCT p.id,dg_native_recovery_journal_key($2,\'people\',to_jsonb(p),ARRAY[\'id\']) record_hash FROM people p WHERE p.status=\'active\' AND p.id IN('+rule.subjects+')),added AS(INSERT INTO pg_temp.dg_recovery_people_candidates SELECT id,record_hash FROM subjects ON CONFLICT DO NOTHING RETURNING person_id) SELECT(SELECT count(*)::int FROM matched) matched_rows,(SELECT count(*)::int FROM subjects) matched_people,(SELECT count(*)::int FROM added) new_people',[rule.table,identity.streamId,columns])).rows[0];
  if(row.matched_rows>cap.maxRows||row.matched_people>cap.maxRows)throw new RecoveryError('PG_RECOVERY_PRIVACY_LIMIT_EXCEEDED','待处理资料数量超过当前清理容量。');if(row.matched_rows)summary.push({table:rule.table,matchedRows:row.matched_rows,matchedPeople:row.matched_people,newPeople:row.new_people});
 }
 const selected=(await client.query<{record_hash:string}>('SELECT record_hash FROM pg_temp.dg_recovery_people_candidates ORDER BY record_hash COLLATE "C"')).rows;
 if(selected.length>Math.min(cap.maxRows,10000))throw new RecoveryError('PG_RECOVERY_PRIVACY_LIMIT_EXCEEDED','单次最多核对10000份受影响资料；当前范围超过此批次容量，未清理。');
 const unsupported=(await client.query<{table:string;events:number}>("SELECT payload->>'tableName' AS table,count(*)::int events FROM pg_temp.dg_recovery_delta WHERE NOT(payload->>'tableName'=ANY($1::text[])) GROUP BY 1 ORDER BY 1",[rules.map(r=>r.table)])).rows;
 return{people:selected.length,selectionSHA256:journalDigest(canonical(selected.map(r=>r.record_hash))),summary,unsupported};
}
