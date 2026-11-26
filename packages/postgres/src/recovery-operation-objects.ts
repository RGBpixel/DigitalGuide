import type pg from 'pg';
import {RecoveryError} from '../../recovery/src/guard.js';

const descriptors={
 directory_erasure:{columns:[['id','text'],['backup_id','text'],['plan_id','text'],['head_sha256','text'],['preview_sha256','text'],['result','jsonb'],['created_at','text']],unique:['backup_id','plan_id']},
 directory_authority:{columns:[['id','text'],['backup_id','text'],['plan_id','text'],['head_sha256','text'],['preview_sha256','text'],['result','jsonb'],['created_at','text']],unique:['backup_id','plan_id']},
 identity_authority:{columns:[['id','text'],['backup_id','text'],['plan_id','text'],['head_sha256','text'],['preview_sha256','text'],['result','jsonb'],['created_at','text']],unique:['backup_id','plan_id']},
 authority:{columns:[['id','text'],['backup_id','text'],['plan_id','text'],['head_sha256','text'],['preview_sha256','text'],['result','jsonb'],['created_at','text']],unique:['backup_id','plan_id']},
 state:{columns:[['id','text'],['backup_id','text'],['plan_id','text'],['head_sha256','text'],['kind','text'],['receipt_id','text'],['before_sha256','text'],['after_sha256','text'],['created_at','text']],unique:['backup_id','plan_id','before_sha256']}
} as const;
export type RecoveryOperationObjectKind=keyof typeof descriptors;
export const recoveryOperationTable=(kind:RecoveryOperationObjectKind)=>'public._dg_native_recovery_'+kind+'_receipts';
// Only code-owned descriptors reach SQL. An operation packet cannot name a
// table, column, function, role or cleanup procedure.
export async function ensureRecoveryOperationObject(client:pg.Client,kind:RecoveryOperationObjectKind,create=false){
 const d=descriptors[kind];if(!d)throw new RecoveryError('PG_RECOVERY_OBJECT_INVALID','未知恢复运维对象。');const table=recoveryOperationTable(kind),fn='public._dg_native_recovery_'+kind+'_immutable',body="BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recovery "+kind+" records are immutable';END;",invalid=()=>new RecoveryError('PG_RECOVERY_OBJECT_INVALID','恢复运维对象的结构、权限或不可变保护不符，保留现场。');
 const found=(await client.query('SELECT to_regclass($1) value',[table])).rows[0].value;
 if(!found){if((await client.query('SELECT to_regprocedure($1) value',[fn+'()'])).rows[0].value)throw invalid();if(!create)return false;
  const fields=d.columns.map(([name,type],i)=>name+' '+type+(type==='text'?' COLLATE "C"':'')+(i===0?' PRIMARY KEY':' NOT NULL')).join(',');await client.query(`CREATE TABLE ${table}(${fields},UNIQUE(${d.unique.join(',')}));REVOKE ALL ON TABLE ${table} FROM PUBLIC;CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog AS $record$${body}$record$;REVOKE ALL ON FUNCTION ${fn}() FROM PUBLIC;CREATE TRIGGER recovery_${kind}_row_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}();CREATE TRIGGER recovery_${kind}_truncate_immutable BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`);
 }
 await client.query('LOCK TABLE '+table+' IN SHARE ROW EXCLUSIVE MODE');
 const relation=(await client.query("SELECT c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,pg_get_userbyid(c.relowner)=current_user own,NOT EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) no_inheritance,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner) private,NOT EXISTS(SELECT 1 FROM pg_attribute ca CROSS JOIN LATERAL aclexplode(ca.attacl) acl WHERE ca.attrelid=c.oid AND ca.attnum>0 AND NOT ca.attisdropped AND acl.grantee<>c.relowner) columns_private FROM pg_class c WHERE c.oid=$1::regclass",[table])).rows[0];
 if(!relation?.own||!relation.private||!relation.columns_private||!relation.no_inheritance||relation.relkind!=='r'||relation.relpersistence!=='p'||relation.relrowsecurity||relation.relforcerowsecurity||relation.relispartition)throw invalid();
 const columns=(await client.query("SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.attidentity,a.attgenerated,co.collname,pg_get_expr(p.adbin,p.adrelid) default_value FROM pg_attribute a LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_attrdef p ON p.adrelid=a.attrelid AND p.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",[table])).rows;
 if(columns.length!==d.columns.length||columns.some((c,i)=>c.attname!==d.columns[i][0]||c.type!==d.columns[i][1]||!c.attnotnull||c.attidentity||c.attgenerated||c.default_value!==null||c.collname!==(c.type==='text'?'C':null)))throw invalid();
 const constraints=(await client.query('SELECT contype,convalidated,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY contype',[table])).rows,nn=constraints.filter(c=>c.contype==='n').map(c=>c.definition).sort(),keys=constraints.filter(c=>c.contype!=='n');
 if(constraints.length!==d.columns.length+2||JSON.stringify(nn)!==JSON.stringify(d.columns.map(([name])=>'NOT NULL '+name).sort())||keys.length!==2||keys[0].definition!=='PRIMARY KEY (id)'||keys[0].contype!=='p'||keys[1].contype!=='u'||keys[1].definition!=='UNIQUE ('+d.unique.join(', ')+')'||constraints.some(c=>!c.convalidated))throw invalid();
 const f=(await client.query("SELECT p.oid,p.prosrc,p.prosecdef,p.pronargs,p.proconfig,p.prorettype='trigger'::regtype trigger_result,pg_get_userbyid(p.proowner)=current_user own,l.lanname,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) private FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure($1)",[fn+'()'])).rows[0];
 if(!f?.own||!f.private||!f.trigger_result||f.prosecdef||f.pronargs!==0||f.lanname!=='plpgsql'||f.prosrc!==body||JSON.stringify(f.proconfig)!==JSON.stringify(['search_path=pg_catalog']))throw invalid();
 const triggers=(await client.query('SELECT tgname,tgtype,tgenabled,tgfoid,tgnargs,tgqual IS NULL unqualified FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal ORDER BY tgname',[table])).rows;
 if(triggers.length!==2||triggers.some((t,i)=>t.tgname!==['recovery_'+kind+'_row_immutable','recovery_'+kind+'_truncate_immutable'][i]||t.tgtype!==[27,34][i]||t.tgenabled!=='O'||t.tgfoid!==f.oid||t.tgnargs!==0||!t.unqualified))throw invalid();return true;
}
