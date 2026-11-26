import {z} from 'zod';
import type pg from 'pg';
import {RecoveryError} from '../../recovery/src/guard.js';
import {journalInteger,journalSHA} from './recovery-journal-format.js';
import {recoveryPrivacyAlgorithm} from './recovery-privacy-selection.js';

const table='public._dg_native_recovery_privacy_receipts',fn='public._dg_native_recovery_privacy_immutable';
const immutableBody="BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recovery privacy receipts are immutable';END;";
const columns=[['id','text'],['backup_id','text'],['plan_id','text'],['head_sha256','text'],['preview_sha256','text'],['result','jsonb'],['created_at','text']];
const invalid=()=>new RecoveryError('PG_RECOVERY_PRIVACY_RECEIPT_INVALID','恢复清理收据的结构、权限、不可变保护或内容已变化，保留现场。');
export async function ensureRecoveryPrivacyReceipts(client:pg.Client,create=true){
 const found=(await client.query('SELECT to_regclass($1) value',[table])).rows[0].value;
 if(!found){
  if((await client.query('SELECT to_regprocedure($1) value',[fn+'()'])).rows[0].value)throw invalid();
  if(!create)return false;
  await client.query(`CREATE TABLE ${table}(id text COLLATE "C" PRIMARY KEY,backup_id text COLLATE "C" NOT NULL,plan_id text COLLATE "C" NOT NULL,head_sha256 text COLLATE "C" NOT NULL,preview_sha256 text COLLATE "C" NOT NULL,result jsonb NOT NULL,created_at text COLLATE "C" NOT NULL,UNIQUE(backup_id,plan_id));REVOKE ALL ON TABLE ${table} FROM PUBLIC;CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $privacy$${immutableBody}$privacy$;REVOKE ALL ON FUNCTION ${fn}() FROM PUBLIC;CREATE TRIGGER recovery_privacy_row_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}();CREATE TRIGGER recovery_privacy_truncate_immutable BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`);
 }
 const relation=(await client.query("SELECT c.oid,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,pg_get_userbyid(c.relowner)=current_user own,NOT EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) no_inheritance,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner) private,NOT EXISTS(SELECT 1 FROM pg_attribute ca CROSS JOIN LATERAL aclexplode(ca.attacl) acl WHERE ca.attrelid=c.oid AND ca.attnum>0 AND NOT ca.attisdropped AND acl.grantee<>c.relowner) columns_private FROM pg_class c WHERE c.oid=$1::regclass",[table])).rows[0];
 if(!relation?.own||!relation.private||!relation.columns_private||!relation.no_inheritance||relation.relkind!=='r'||relation.relpersistence!=='p'||relation.relrowsecurity||relation.relforcerowsecurity||relation.relispartition)throw invalid();
 const actual=(await client.query("SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.attidentity,a.attgenerated,co.collname,pg_get_expr(d.adbin,d.adrelid) default_value FROM pg_attribute a LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",[table])).rows;
 if(actual.length!==columns.length||actual.some((a,i)=>a.attname!==columns[i][0]||a.type!==columns[i][1]||!a.attnotnull||a.attidentity||a.attgenerated||a.default_value!==null||a.collname!==(a.type==='text'?'C':null)))throw invalid();
 const constraints=(await client.query('SELECT contype,convalidated,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY contype',[table])).rows;
 const notNull=constraints.filter(c=>c.contype==='n').map(c=>c.definition).sort(),keys=constraints.filter(c=>c.contype!=='n');
 if(constraints.length!==columns.length+2||JSON.stringify(notNull)!==JSON.stringify(columns.map(([name])=>'NOT NULL '+name).sort())||keys.length!==2||keys[0].contype!=='p'||keys[0].definition!=='PRIMARY KEY (id)'||keys[1].contype!=='u'||keys[1].definition!=='UNIQUE (backup_id, plan_id)'||constraints.some(c=>!c.convalidated))throw invalid();
 const functionRow=(await client.query("SELECT p.oid,p.prosrc,p.prosecdef,p.pronargs,p.proconfig,p.prorettype='trigger'::regtype trigger_result,pg_get_userbyid(p.proowner)=current_user own,l.lanname,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) private FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure($1)",[fn+'()'])).rows[0];
 if(!functionRow?.own||!functionRow.private||!functionRow.trigger_result||functionRow.prosecdef||functionRow.pronargs!==0||functionRow.lanname!=='plpgsql'||functionRow.prosrc!==immutableBody||JSON.stringify(functionRow.proconfig)!==JSON.stringify(['search_path=pg_catalog']))throw invalid();
 const triggers=(await client.query('SELECT tgname,tgtype,tgenabled,tgfoid,tgnargs,tgqual IS NULL unqualified FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal ORDER BY tgname',[table])).rows;
 if(triggers.length!==2||triggers.some((t,i)=>t.tgname!==['recovery_privacy_row_immutable','recovery_privacy_truncate_immutable'][i]||t.tgtype!==[27,34][i]||t.tgenabled!=='O'||t.tgfoid!==functionRow.oid||t.tgnargs!==0||!t.unqualified))throw invalid();
 return true;
}
const rule=z.object({table:z.string(),matchedRows:journalInteger,matchedPeople:journalInteger,newPeople:journalInteger}).strict();
export const privacyApplicationSchema=z.object({version:z.literal(1),algorithm:z.literal(recoveryPrivacyAlgorithm),planId:z.uuid(),backupId:z.uuid(),runtimeId:z.uuid(),streamId:z.uuid(),generation:journalInteger.min(1),headSHA256:journalSHA,previewSHA256:journalSHA,beforeDatabaseSHA256:journalSHA,afterDatabaseSHA256:journalSHA,peoplePurged:journalInteger,loginsInvalidated:journalInteger,selectionSHA256:journalSHA,rulesSHA256:journalSHA,summary:z.array(rule).max(100),unsupported:z.array(z.object({table:z.string(),events:journalInteger}).strict()).max(2048),remainingPlanEvents:journalInteger,createdAt:z.iso.datetime()}).strict();
export type PrivacyApplication=z.infer<typeof privacyApplicationSchema>;
export async function readPrivacyApplication(client:pg.Client,backupId:string,planId:string){
 const row=(await client.query('SELECT * FROM '+table+' WHERE backup_id=$1 AND plan_id=$2',[backupId,planId])).rows[0];if(!row)return undefined;const result=privacyApplicationSchema.safeParse(row.result);if(!result.success||!z.uuid().safeParse(row.id).success||row.backup_id!==result.data.backupId||row.plan_id!==result.data.planId||row.head_sha256!==result.data.headSHA256||row.preview_sha256!==result.data.previewSHA256||row.created_at!==result.data.createdAt)throw invalid();return{id:row.id as string,application:result.data};
}
export async function insertPrivacyApplication(client:pg.Client,id:string,result:PrivacyApplication){privacyApplicationSchema.parse(result);await client.query('INSERT INTO '+table+'(id,backup_id,plan_id,head_sha256,preview_sha256,result,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[id,result.backupId,result.planId,result.headSHA256,result.previewSHA256,JSON.stringify(result),result.createdAt]);}
