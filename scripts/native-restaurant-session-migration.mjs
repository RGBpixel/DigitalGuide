// Generate the append-only restaurant bridge from reviewed, frozen enterprise
// functions. Exact substitutions fail closed if those historical files change.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const target='migrations/postgres/087-native-restaurant-sessions.sql';
const extract=(file,name)=>{const source=fs.readFileSync('migrations/postgres/'+file,'utf8').replace(/\r\n/g,'\n'),pattern=new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+name.replaceAll('(','\\(')+'\\('),m=pattern.exec(source);assert.ok(m,name);const end=source.indexOf('$dg$;',m.index);assert.ok(end>m.index);return source.slice(m.index,end+6);};
const replace=(source,old,next)=>{assert.equal(source.split(old).length,2,old);return source.replace(old,next);};
const override=source=>source.replace(/^CREATE (?:OR REPLACE )?FUNCTION /,'CREATE OR REPLACE FUNCTION ');
let sql=fs.readFileSync('scripts/native-restaurant-session-base.sql','utf8');
let source=extract('062-native-reception-profile-history.sql','dg_native_reception_source_valid');
source=replace(source,'dg_native_reception_source_valid(','dg_native_dining_source_valid(');
source=replace(source,"IF NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=v_origin.actor_id AND m.tenant_id=v_origin.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? v_origin.workspace_id) OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=v_terminal.actor_id AND m.tenant_id=v_terminal.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? v_terminal.workspace_id) THEN RETURN false;END IF;",`IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins o JOIN _dg_native_dining_terminal_origins t ON t.terminal_id=o.terminal_id AND t.restaurant_id=o.restaurant_id JOIN restaurant_terminals rt ON rt.terminal_id=t.terminal_id AND rt.restaurant_id=t.restaurant_id JOIN restaurants r ON r.id=o.restaurant_id WHERE o.session_id=target AND o.actor_id=v_origin.actor_id AND o.terminal_id=v_session.terminal_id AND o.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND t.runtime_id=o.runtime_id AND v_session.service_scene='restaurant' AND r.tenant_id=v_origin.tenant_id AND r.workspace_id=v_origin.workspace_id AND r.environment='mock' AND r.app_env=v_session.app_env AND r.scene_app_id IS NOT DISTINCT FROM (v_origin.scene::jsonb->>'id') AND coalesce(r.profile_id,v_origin.scene::jsonb->>'profileId') IS NOT DISTINCT FROM (v_origin.profile::jsonb->>'id') AND dg_native_dining_authority(o.actor_id,o.restaurant_id,o.actor_epoch,o.grant_version)) THEN RETURN false;END IF;`);
source=source.replaceAll("'reception'","'restaurant'");
sql+='\n'+source+'\n'+`ALTER FUNCTION dg_native_reception_source_valid(text) RENAME TO dg_native_reception_source_valid_before_dining;
CREATE FUNCTION dg_native_reception_source_valid(target text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=target AND service_scene='restaurant') THEN RETURN dg_native_dining_source_valid(target);END IF;RETURN dg_native_reception_source_valid_before_dining(target);END;$dg$;\n`;
source=override(extract('061-native-reception.sql','dg_native_reception_session_guard'));
source=replace(source,"NEW.service_scene<>'reception'","(NEW.service_scene NOT IN('reception','restaurant') OR NEW.service_scene='restaurant' AND NOT EXISTS(SELECT 1 FROM restaurant_terminals rt JOIN _dg_native_dining_terminal_origins o ON o.terminal_id=rt.terminal_id AND o.restaurant_id=rt.restaurant_id WHERE rt.terminal_id=NEW.terminal_id))");
sql+='\n'+source+'\n';
source=override(extract('061-native-reception.sql','dg_native_reception_scope_invalidate'));
source=replace(source,'WHERE actor_id=OLD.user_id AND invalidated_at IS NULL ORDER BY terminal_id LOOP','WHERE actor_id=OLD.user_id AND invalidated_at IS NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_dining_terminal_origins d WHERE d.terminal_id=_dg_native_reception_terminals.terminal_id) ORDER BY terminal_id LOOP');
source=replace(source,"IF TG_OP='DELETE' OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=v_origin.actor_id AND m.tenant_id=v_origin.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? v_origin.workspace_id) THEN", "IF EXISTS(SELECT 1 FROM _dg_native_dining_session_origins d WHERE d.session_id=v_origin.session_id) THEN IF NOT dg_native_dining_source_valid(v_origin.session_id) THEN PERFORM dg_native_reception_workspace(v_origin.tenant_id,v_origin.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=v_origin.terminal_id FOR UPDATE;PERFORM dg_native_reception_end(v_origin.session_id,'restaurant_scope_withdrawn',false,true);END IF;ELSIF TG_OP='DELETE' OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=v_origin.actor_id AND m.tenant_id=v_origin.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? v_origin.workspace_id) THEN");
sql+='\n'+source+'\n';
source=override(extract('063-native-guest-memory.sql','dg_native_reception_authorize'));
source=replace(source,'dg_native_reception_authorize(','dg_native_reception_authorize_before_handoff(');
source=replace(source,'PERFORM user_id FROM dg_native_locked_membership(v_terminal.actor_id);',"IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=target) THEN PERFORM user_id FROM dg_native_locked_membership(v_terminal.actor_id);END IF;");
sql+='\n'+source+'\n';
for(const[file,name]of [['072-native-speaker-control.sql','dg_native_speaker_prelock'],['077-native-speaker-known-grant-prelock.sql','dg_native_speaker_prelock'],['080-native-speaker-handoff-replay.sql','dg_native_speaker_handoff_prelock']]){
 source=override(extract(file,name));
 source=replace(source,"WHERE terminal_id=meta->>'terminalId' UNION", "WHERE terminal_id=meta->>'terminalId' AND NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=target) UNION");
 if(name==='dg_native_speaker_prelock')source=replace(source,"IF token_hash_value IS NULL THEN PERFORM dg_native_reception_admin(meta->>'workspaceId');END IF;", "IF token_hash_value IS NULL AND meta->>'serviceScene' IS DISTINCT FROM 'restaurant' THEN PERFORM dg_native_reception_admin(meta->>'workspaceId');END IF;");
 sql+='\n'+source+'\n';
}
source=override(extract('075-native-speaker-references.sql','dg_native_speaker_reference_member_ids'));
source=replace(source,'JOIN sessions s ON s.id=o.session_id\n UNION SELECT d.recipient_id','JOIN sessions s ON s.id=o.session_id WHERE NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins d WHERE d.session_id=s.id)\n UNION SELECT d.recipient_id');
sql+='\n'+source+'\n';
source=override(extract('080-native-speaker-handoff-replay.sql','dg_native_speaker_handoff_scope'));
source=replace(source,"'assets',origin.assets::jsonb);", "'assets',origin.assets::jsonb,'serviceScene',s.service_scene,'restaurantId',(SELECT restaurant_id FROM _dg_native_dining_session_origins WHERE session_id=s.id));");
sql+='\n'+source+'\n';
// Enterprise-only feature routes reject restaurant credentials on the server.
for(const[file,name,signature]of [['063-native-guest-memory.sql','dg_native_guest_memory_session','text,text,text,bigint,boolean'],['065-native-visits.sql','dg_native_visit_session','text,text,text,bigint,boolean']]){
 source=override(extract(file,name));source=replace(source,'IF focus_value IS NOT NULL',"IF s.service_scene='restaurant' THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;\n IF focus_value IS NOT NULL");sql+='\n'+source+'\n';void signature;
}
sql+='\n'+fs.readFileSync('scripts/native-restaurant-session-wrappers.sql','utf8');
sql+=`\nDO $acl$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND (p.proname LIKE 'dg_native_dining_%' OR p.proname LIKE '%_before_dining' OR p.proname=ANY(ARRAY['dg_native_reception_source_valid','dg_native_reception_meta','dg_native_reception_terminal_scope','dg_native_reception_spawn','dg_native_reception_create_session','dg_native_reception_issue','dg_native_reception_access'])) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.signature);END LOOP;
END;$acl$;\n`;
fs.writeFileSync(target,sql,{flag:'wx'});console.log(JSON.stringify({migration:target,bytes:Buffer.byteLength(sql)}));
