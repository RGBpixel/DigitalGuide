import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),hash=value=>createHash('sha256').update(value).digest('hex');
const migration='096-native-dining-memory-import.sql',file='migrations/postgres/'+migration,manifestFile='migrations/postgres/runtime.json',manifest=JSON.parse(read(manifestFile));
const regenerate=process.argv.includes('--regenerate-uncommitted');
if(regenerate){assert.equal(manifest.version,93);assert.equal(manifest.migrations.at(-1).name,migration);assert.equal(fs.existsSync('docs/evidence/T20/postgres-food/memory-import/migration-frozen.json'),false);const previous=fs.readFileSync(file),snapshot='docs/evidence/T20/postgres-food/memory-import/unapplied-'+hash(previous)+'.sql';fs.writeFileSync(snapshot,previous,{flag:'wx'});const failure=JSON.parse(read('docs/evidence/T20/postgres-food/memory-import/import-first-core.json'));assert.equal(failure.success,false);assert.equal(failure.numPassedTests,0);}
else{assert.equal(manifest.version,92);assert.equal(manifest.migrations.at(-1).name,'095-native-dining-memory-purpose.sql');assert.equal(fs.existsSync(file),false);}
for(const m of manifest.migrations)assert.equal(hash(fs.readFileSync('migrations/postgres/'+m.name)),m.sha256,m.name);
const replace=(source,before,after)=>{assert.equal(source.split(before).length,2,before);return source.replace(before,after);};
const extract=(source,name)=>{const start=source.indexOf('CREATE FUNCTION '+name+'(');assert.ok(start>=0,name);return source.slice(start,source.indexOf('$dg$;',start)+6).replace('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION ');};
let sql=read('scripts/native-dining-import-base.sql')+'\n'+read('scripts/native-dining-import-guards.sql');
let apply=extract(read('scripts/native-dining-food-commands.sql'),'dg_native_food_apply');
apply=replace(apply,"IF action_value NOT IN('draft','confirm','recommend')","IF action_value='memory' THEN RETURN dg_native_food_memory_import_create(target,input,session_value,token_value,csrf_value,focus_value);END IF;\n IF action_value NOT IN('draft','confirm','recommend')");
apply=replace(apply,"IF body->'importId' IS DISTINCT FROM 'null'::jsonb OR body->'sourceFactIds' IS DISTINCT FROM '[]'::jsonb THEN PERFORM dg_native_food_error('MEMORY_IMPORT_REQUIRED');END IF;","IF body->'importId' IS DISTINCT FROM 'null'::jsonb THEN PERFORM dg_native_food_memory_selected(body->>'importId',body->'sourceFactIds',target,meta,body->'preferences');ELSIF body->'sourceFactIds' IS DISTINCT FROM '[]'::jsonb THEN PERFORM dg_native_food_error('MEMORY_IMPORT_REQUIRED');END IF;");
apply=replace(apply,"expires:=dg_native_people_iso(created::timestamptz+interval '24 hours');","expires:=least(dg_native_people_iso(created::timestamptz+interval '24 hours'),(SELECT expires_at FROM dining_memory_imports WHERE id=body->>'importId'));");
apply=replace(apply,"CASE WHEN meta->>'actorType'='guest' THEN 'guest_manual' ELSE 'staff_confirmation' END,'[]',NULL,meta->>'sessionId'","CASE WHEN body->>'importId' IS NOT NULL THEN 'memory_suggestion' WHEN meta->>'actorType'='guest' THEN 'guest_manual' ELSE 'staff_confirmation' END,(body->'sourceFactIds')::text,body->>'importId',meta->>'sessionId'");
apply=replace(apply,"PERFORM dg_native_dining_effect(operation_value,'dining_preferences',f.id);UPDATE dining_preferences SET status='confirmed'","IF f.source='memory_suggestion' THEN PERFORM dg_native_food_memory_selected(f.source_import_id,f.source_fact_ids::jsonb,target,meta);END IF;\n  PERFORM dg_native_dining_effect(operation_value,'dining_preferences',f.id);UPDATE dining_preferences SET status='confirmed'");
sql+='\n'+apply;
let guard=extract(read('scripts/native-dining-food-guards.sql'),'dg_native_food_guard');
guard=replace(guard,"'food_recommend','food_expire'","'food_recommend','food_expire','food_memory_redact'");
guard=replace(guard,"IF TG_TABLE_NAME='dining_preferences' THEN",`IF TG_TABLE_NAME='dining_preferences' AND TG_OP='UPDATE' AND previous->>'source'='memory_suggestion' AND j->>'payload'='{}' AND EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations WHERE import_id=previous->>'source_import_id') THEN
  IF j-ARRAY['status','payload'] IS DISTINCT FROM previous-ARRAY['status','payload'] OR previous->>'status' NOT IN('draft','confirmed','superseded') OR j->>'status' IS DISTINCT FROM (CASE WHEN j->>'expires_at'<=dg_native_dining_now() THEN 'expired' ELSE 'superseded' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Source withdrawal only redacts derived payload without rewriting confirmation or deadline';END IF;RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='dining_preferences' THEN`);
guard=replace(guard,"j->>'source' NOT IN('guest_manual','staff_confirmation') OR j->>'source_fact_ids'<>'[]' OR j->>'source_import_id' IS NOT NULL","j->>'source' NOT IN('guest_manual','staff_confirmation','memory_suggestion') OR (CASE WHEN j->>'source'='memory_suggestion' THEN j->>'source_import_id' IS NULL OR jsonb_typeof((j->>'source_fact_ids')::jsonb) IS DISTINCT FROM 'array' OR jsonb_array_length((j->>'source_fact_ids')::jsonb) NOT BETWEEN 1 AND 20 ELSE j->>'source_fact_ids'<>'[]' OR j->>'source_import_id' IS NOT NULL END)");
sql+='\n'+guard;
let final=extract(read('scripts/native-dining-food-guards.sql'),'dg_native_food_final');
final=replace(final,"f.status<>'expired' AND o.payload_hash<>","f.status<>'expired' AND NOT(f.source='memory_suggestion' AND f.payload='{}' AND EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations WHERE import_id=f.source_import_id)) AND o.payload_hash<>");sql+='\n'+final;
sql+="\nDO $food_import_acl$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND(p.proname LIKE 'dg_native_food_%' OR p.proname='dg_native_people_invalidate_before_food_import') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$food_import_acl$;\n";
if(regenerate){fs.writeFileSync(file,sql);manifest.migrations.at(-1).sha256=hash(sql);}else{
 fs.writeFileSync(file,sql,{flag:'wx'});manifest.version=93;manifest.migrations.push({name:migration,sha256:hash(sql)});
 for(const file of ['packages/postgres/src/runtime-database.ts','tests/unit/postgres-runtime.test.ts']){let source=read(file);source=replace(source,"'095-native-dining-memory-purpose.sql']","'095-native-dining-memory-purpose.sql','"+migration+"']");if(file.includes('runtime-database'))source=replace(source,'manifest.version!==92','manifest.version!==93');fs.writeFileSync(file,source);}
}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({migration,sha256:hash(sql),runtime:93,applied:false}));
