import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),root='docs/evidence/T20/postgres-dining',frozen=JSON.parse(read(root+'/migration-frozen.json'));assert.equal(createHash('sha256').update(fs.readFileSync('migrations/postgres/'+frozen.migration)).digest('hex'),frozen.sha256);
const source=read('migrations/postgres/090-native-dining.sql'),functions=[...source.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (dg_native_dining_[a-z_]+)\(/g)].map(match=>{const end=source.indexOf('$dg$;',match.index);return{name:match[1],source:source.slice(match.index,end+6)};});
const replace=(text,old,next)=>{assert.equal(text.split(old).length,2,old);return text.replace(old,next);};
let sql=`-- Keep090 frozen. A statement can wait on a lock; business deadlines use the actual wall clock.
CREATE FUNCTION dg_native_dining_now() RETURNS text LANGUAGE sql SET search_path FROM CURRENT AS $dg$ SELECT dg_native_people_iso(clock_timestamp()) $dg$;
CREATE FUNCTION dg_native_dining_clock_authority(actor_value text,restaurant_value text,epoch_value bigint,grant_value bigint) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT dg_native_dining_authority(actor_value,restaurant_value,epoch_value,grant_value) AND(grant_value=0 OR EXISTS(SELECT 1 FROM restaurant_staff WHERE restaurant_id=restaurant_value AND user_id=actor_value AND version=grant_value AND(expires_at IS NULL OR expires_at>dg_native_dining_now())))
$dg$;\n`;
for(const item of functions){let text=item.source.replace(/^CREATE (?:OR REPLACE )?FUNCTION /,'CREATE OR REPLACE FUNCTION ').replaceAll('dg_utc_now()','dg_native_dining_now()');
 if(item.name==='dg_native_dining_context'){
  text=replace(text,"stamp_value:=dg_native_restaurant_role(restaurant_value,false);", "stamp_value:=dg_native_restaurant_role(restaurant_value,false);IF NOT dg_native_dining_clock_authority(m.user_id,restaurant_value,(SELECT epoch FROM _dg_native_restaurant_member_epochs WHERE user_id=m.user_id),stamp_value) THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;");
  text=replace(text,"SELECT * INTO s FROM reception_sessions WHERE id=session_value;", "SELECT * INTO s FROM reception_sessions WHERE id=session_value;IF s.expires_at<=dg_native_dining_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins origin WHERE origin.session_id=s.id AND dg_native_dining_clock_authority(origin.actor_id,origin.restaurant_id,origin.actor_epoch,origin.grant_version)) OR EXISTS(SELECT 1 FROM _dg_native_reception_origins origin CROSS JOIN LATERAL jsonb_array_elements(origin.assets::jsonb) fixed JOIN assets asset ON asset.id=fixed->>'id' WHERE origin.session_id=s.id AND asset.expires_at IS NOT NULL AND asset.expires_at<=dg_native_dining_now()) THEN PERFORM dg_native_dining_error('AUTH_REQUIRED');END IF;");
 }
 if(item.name==='dg_native_dining_apply')text=replace(text,"SELECT * INTO r FROM restaurants WHERE id=meta->>'restaurantId';", "SELECT * INTO r FROM restaurants WHERE id=meta->>'restaurantId';now_value:=dg_native_dining_now();");
 if(item.name==='dg_native_dining_business_final'){
  text=replace(text,"NOT dg_native_dining_authority(a.actor_id,a.restaurant_id,a.actor_epoch,a.grant_version)","NOT dg_native_dining_clock_authority(a.actor_id,a.restaurant_id,a.actor_epoch,a.grant_version)");
  text=replace(text,"IF s.status<>'active' OR NOT dg_native_reception_source_valid(s.id)","IF s.status<>'active' OR s.expires_at<=dg_native_dining_now() OR NOT dg_native_reception_source_valid(s.id)");
 }
 sql+='\n'+text+'\n';
}
sql+=`\nREVOKE ALL ON FUNCTION dg_native_dining_now(),dg_native_dining_clock_authority(text,text,bigint,bigint) FROM PUBLIC;\n`;
const migration='091-native-dining-clock.sql';fs.writeFileSync('migrations/postgres/'+migration,sql,{flag:'wx'});const manifestFile='migrations/postgres/runtime.json',manifest=JSON.parse(read(manifestFile));assert.equal(manifest.version,87);assert.equal(manifest.migrations.at(-1).name,'090-native-dining.sql');manifest.version=88;manifest.migrations.push({name:migration,sha256:createHash('sha256').update(sql).digest('hex')});
for(const file of ['packages/postgres/src/runtime-database.ts','tests/unit/postgres-runtime.test.ts']){let text=read(file);const old="'090-native-dining.sql']";assert.equal(text.split(old).length,2);text=text.replace(old,"'090-native-dining.sql','"+migration+"']");if(file.includes('runtime-database'))text=text.replace('manifest.version!==87','manifest.version!==88');fs.writeFileSync(file,text);}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({migration,version:88,functions: functions.length,sha256:manifest.migrations.at(-1).sha256,applied:false}));
