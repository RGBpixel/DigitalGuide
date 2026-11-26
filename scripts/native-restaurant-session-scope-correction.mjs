import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=f=>fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n');
const extract=(file,name)=>{const source=read('migrations/postgres/'+file),pattern=new RegExp('CREATE (?:OR REPLACE )?FUNCTION '+name+'\\('),m=pattern.exec(source);assert.ok(m);const end=source.indexOf('$dg$;',m.index);assert.ok(end>m.index);return source.slice(m.index,end+6);};
const frozen=JSON.parse(read('docs/evidence/T20/postgres-restaurant-session/migration-frozen.json'));assert.equal(createHash('sha256').update(fs.readFileSync('migrations/postgres/'+frozen.migration)).digest('hex'),frozen.sha256);
let sql='-- Append-only correction: shared reception authorization is used by speaker control.\n-- Restrict memory business entry points, not that shared capability primitive.\n'+extract('063-native-guest-memory.sql','dg_native_guest_memory_session').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')+'\n';
for(const suffix of ['context','view','search','export','attempt','recovery_meta','apply','result']){
 const name='dg_native_guest_memory_'+suffix,source=extract('063-native-guest-memory.sql',name),header=source.slice(0,source.indexOf(' AS $dg$')),args=/\((.*?)\) RETURNS/s.exec(header)[1].split(',').map(v=>v.trim().split(' ')),signature=args.map(a=>a[1]).join(','),names=args.map(a=>a[0]).join(','),old=name+'_before_dining_scope';
 const target=suffix==='result'?"(SELECT session_id FROM _dg_native_guest_memory_actions WHERE id=target)":'target',call=suffix==='attempt'?'PERFORM':'RETURN';
 sql+='\nALTER FUNCTION '+name+'('+signature+') RENAME TO '+old+';\n'+header+' AS $dg$\nBEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id='+target+" AND service_scene='restaurant') THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;"+call+' '+old+'('+names+');END;$dg$;\n';
}
sql+=`\nCREATE OR REPLACE FUNCTION dg_native_speaker_event_actor(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;
BEGIN
 PERFORM dg_native_reception_runtime();meta:=dg_native_reception_meta(target,NULL);
 IF meta->>'serviceScene'='restaurant' THEN
  IF meta->>'actorId' IS DISTINCT FROM current_setting('digitalguide.actor_id',true) THEN PERFORM dg_native_speaker_error('FORBIDDEN');END IF;
  PERFORM dg_native_dining_meta_authorize(target);
 ELSE PERFORM dg_native_reception_admin(meta->>'workspaceId');END IF;RETURN meta;
END;$dg$;\n`;
let context=extract('078-native-speaker-events.sql','dg_native_speaker_event_context').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');assert.ok(context.includes('IF access_hash IS NOT NULL THEN'));context=context.replace('IF access_hash IS NOT NULL THEN',"IF access_hash IS NOT NULL AND meta->>'serviceScene' IS DISTINCT FROM 'restaurant' THEN");context=context.replace("'memory',dg_native_guest_memory_private_context(o.session_id)","'memory',CASE WHEN meta->>'serviceScene'='restaurant' THEN NULL ELSE dg_native_guest_memory_private_context(o.session_id) END");sql+='\n'+context+'\n';
sql+=`\nDO $scope_acl$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND(p.proname LIKE 'dg_native_guest_memory_%' OR p.proname=ANY(ARRAY['dg_native_speaker_event_actor','dg_native_speaker_event_context'])) LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$scope_acl$;\n`;
const migration='088-native-restaurant-feature-scope.sql';fs.writeFileSync('migrations/postgres/'+migration,sql,{flag:'wx'});
const manifestFile='migrations/postgres/runtime.json',manifest=JSON.parse(read(manifestFile));assert.equal(manifest.version,84);assert.equal(manifest.migrations.at(-1).name,'087-native-restaurant-sessions.sql');manifest.version=85;manifest.migrations.push({name:migration,sha256:createHash('sha256').update(sql).digest('hex')});
for(const file of ['packages/postgres/src/runtime-database.ts','tests/unit/postgres-runtime.test.ts']){let text=read(file);const old="'087-native-restaurant-sessions.sql']";assert.equal(text.split(old).length,2);text=text.replace(old,"'087-native-restaurant-sessions.sql','"+migration+"']");if(file.includes('runtime-database'))text=text.replace('manifest.version!==84','manifest.version!==85');fs.writeFileSync(file,text);}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({migration,version:85,sha256:manifest.migrations.at(-1).sha256,applied:false}));
