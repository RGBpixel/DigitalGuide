// Append derivatives to the not-yet-applied 075. Applied 001--074 stay frozen.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='migrations/postgres/075-native-speaker-references.sql',base=fs.readFileSync('migrations/postgres/072-native-speaker-control.sql','utf8');
assert.ok(!fs.readFileSync(file,'utf8').includes('-- Enrolled control extension.'));
function fn(name){const start=base.indexOf('CREATE FUNCTION '+name+'('),end=base.indexOf('END;$dg$;',start);assert.ok(start>=0&&end>start);return base.slice(start,end+10).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');}
function swap(source,before,after){assert.equal(source.split(before).length,2,before.slice(0,100));return source.replace(before,()=>after);}
let apply=fn('dg_native_speaker_apply');
apply=swap(apply,'rebind_value text;','rebind_value text;ticket_value speaker_use_tickets%ROWTYPE;ticket_origin _dg_native_speaker_ticket_origins%ROWTYPE;original_ticket text;');
apply=swap(apply,"IF input->>'mode' IS DISTINCT FROM 'temporary' THEN PERFORM dg_native_speaker_error('CAPABILITY_UNAVAILABLE');END IF;","IF input->>'mode' IS NULL OR input->>'mode' NOT IN('temporary','enrolled') THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;");
apply=swap(apply,"OR input ? 'useCode' THEN", "OR input->>'mode'='temporary' AND input ? 'useCode' THEN");
apply=swap(apply,"s:=dg_native_speaker_advance(target,'start',id_value);r:=dg_native_speaker_temporary(target,policy->>'provider');expires_value:=r.expires_at;",`IF input->>'mode'='enrolled' THEN
   IF coalesce(input->>'useCode','') !~ '^SF1\\.[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}$' THEN PERFORM dg_native_speaker_error('REFERENCE_USE_DENIED');END IF;
   SELECT * INTO ticket_value FROM speaker_use_tickets WHERE id=split_part(input->>'useCode','.',2) FOR UPDATE;SELECT * INTO ticket_origin FROM _dg_native_speaker_ticket_origins WHERE ticket_id=ticket_value.id;SELECT * INTO r FROM speaker_references WHERE id=ticket_origin.reference_id;
   IF ticket_value.id IS NULL OR ticket_origin.ticket_id IS NULL OR ticket_value.session_id<>target OR ticket_value.focus_version<>s.focus_version OR ticket_value.used_at IS NOT NULL OR ticket_value.revoked_at IS NOT NULL OR ticket_value.expires_at<=now_value OR ticket_value.token_hash IS DISTINCT FROM encode(sha256(convert_to(input->>'useCode','UTF8')),'hex') OR NOT dg_native_speaker_reference_valid(r.id) OR r.version<>ticket_origin.reference_version OR r.provider_id IS DISTINCT FROM policy->>'provider' OR r.tenant_id<>s.tenant_id OR r.workspace_id<>s.workspace_id THEN PERFORM dg_native_speaker_error('REFERENCE_USE_DENIED');END IF;
   UPDATE speaker_use_tickets SET used_at=now_value,token_hash='' WHERE id=ticket_value.id;original_ticket:=ticket_value.id;
  END IF;
  s:=dg_native_speaker_advance(target,'start',id_value);IF input->>'mode'='temporary' THEN r:=dg_native_speaker_temporary(target,policy->>'provider');END IF;expires_value:=least(s.expires_at,r.expires_at,dg_native_people_iso(now_value::timestamptz+interval '5 minutes'));`);
apply=swap(apply,"VALUES(target,'acquiring',r.id,'temporary',policy->>'provider'","VALUES(target,'acquiring',r.id,input->>'mode',policy->>'provider'");
apply=swap(apply,"OR f.mode<>'temporary' OR input->>'fixture'", "OR input->>'fixture'");
apply=swap(apply,"WHEN input->>'fixture'='overlapping' THEN 'overlap' ELSE 'adequate' END;", "WHEN input->>'fixture'='overlapping' THEN 'overlap' WHEN f.mode='enrolled' AND input->>'fixture'='registered_mismatch' THEN 'mismatch' ELSE 'adequate' END;");
apply=swap(apply,"UPDATE speaker_references SET quality=quality_value", "IF f.mode='temporary' THEN UPDATE speaker_references SET quality=quality_value");
apply=swap(apply,"version=version+1 WHERE id=r.id;", "version=version+1 WHERE id=r.id;END IF;");
apply=swap(apply,"usage_target_token=(SELECT target_token FROM speaker_references WHERE id=r.id)", "usage_target_token=CASE WHEN quality_value='adequate' THEN 'mock-session-target:'||gen_random_uuid()::text END");
apply=swap(apply,"old:=dg_native_speaker_active(target);IF old.mode<>'temporary' THEN PERFORM dg_native_speaker_error('CAPABILITY_UNAVAILABLE');END IF;",`old:=dg_native_speaker_active(target);IF old.mode='enrolled' THEN
   SELECT u.ticket_id INTO original_ticket FROM _dg_native_speaker_enrolled_uses u WHERE u.session_id=target AND u.focus_version=old.focus_version;SELECT * INTO r FROM speaker_references WHERE id=old.reference_id;
   IF original_ticket IS NULL OR NOT dg_native_speaker_reference_valid(r.id) THEN PERFORM dg_native_speaker_error('REFERENCE_EXPIRED');END IF;
  END IF;`);
apply=swap(apply,"s:=dg_native_speaker_advance(target,'reacquire',id_value);r:=dg_native_speaker_temporary(target,policy->>'provider');expires_value:=least(s.expires_at,r.expires_at);", "s:=dg_native_speaker_advance(target,'reacquire',id_value);IF old.mode='temporary' THEN r:=dg_native_speaker_temporary(target,policy->>'provider');END IF;expires_value:=least(s.expires_at,r.expires_at,dg_native_people_iso(now_value::timestamptz+interval '5 minutes'));");
apply=swap(apply,"f.config_version,f.expires_at,now_value);END IF;", "f.config_version,f.expires_at,now_value);IF f.mode='enrolled' THEN INSERT INTO _dg_native_speaker_enrolled_uses VALUES(target,s.focus_version,original_ticket,r.id,r.version,now_value);END IF;END IF;");
let final=fn('dg_native_speaker_focus_final');
final=swap(final,'r speaker_references%ROWTYPE;', 'r speaker_references%ROWTYPE;u _dg_native_speaker_enrolled_uses%ROWTYPE;t speaker_use_tickets%ROWTYPE;origin _dg_native_speaker_ticket_origins%ROWTYPE;');
final=swap(final,' RETURN NULL;\nEND;',` IF f.mode='enrolled' THEN
  SELECT * INTO u FROM _dg_native_speaker_enrolled_uses WHERE session_id=target AND focus_version=f.focus_version;SELECT * INTO t FROM speaker_use_tickets WHERE id=u.ticket_id;SELECT * INTO origin FROM _dg_native_speaker_ticket_origins WHERE ticket_id=t.id;
  IF u.ticket_id IS NULL OR NOT dg_native_speaker_reference_valid(r.id) OR u.reference_id<>r.id OR u.reference_version<>r.version OR origin.reference_id<>r.id OR origin.reference_version<>r.version OR origin.session_id<>s.id OR origin.focus_version>=f.focus_version OR origin.provider_id<>f.provider_id OR t.used_at IS NULL OR t.used_at>t.expires_at OR t.token_hash<>'' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enrolled focus requires an original single-use grant and current owner consent';END IF;
 END IF;
 RETURN NULL;
END;`);
// Strip CR only in this derivative so the exact source match is portable.
// fn() retains original newlines; the guard above matches LF in repository files.
fs.appendFileSync(file,'\n-- Enrolled control extension.\n'+apply+'\n'+final+'\n');
