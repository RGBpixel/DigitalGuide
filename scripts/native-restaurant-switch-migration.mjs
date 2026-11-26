import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-restaurant-session',read=f=>JSON.parse(fs.readFileSync(f,'utf8')),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'),previous=root+'/terminal-phase-verification.json';
assert.equal(hash(previous),'bfb83102d81d867aaf00673048e96b899582e6078109471aafb933f9216398d7');const prior=read(previous);for(const[file,sha]of Object.entries(prior.sourceSHA256))assert.equal(hash(file),sha,file);for(const[file,sha]of Object.entries(prior.compiledSHA256))assert.equal(hash(file),sha,file);assert.equal(read(root+'/final-read-only-audit.json').result,'PASS');
fs.writeFileSync(root+'/switch-phase-start.json',JSON.stringify({result:'PASS_START_REVALIDATED',checkedAt:new Date().toISOString(),previousManifest:previous,previousManifestSHA256:hash(previous),previousAuditSHA256:hash(root+'/final-read-only-audit.json'),identifiedGap:'A next-guest confirmation must name the original session and monotonic version/focus, rather than ending whichever visitor is current after another staff action.',nativeRuntimeBefore:85,nextMigration:'089',originalCompiledRoot:prior.compiled.compiledRoot,originalSuccessfulProducersRepeated:false,goalStatus:'active'},null,2)+'\n',{flag:'wx'});
const migration='089-native-restaurant-switch-target.sql',sql=`-- A staff next-guest intent is bound to the visitor who was actually confirmed.
CREATE OR REPLACE FUNCTION dg_native_dining_terminal_view(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT jsonb_build_object('id',t.id,'restaurantId',d.restaurant_id,'name',t.name,'currentSessionId',s.id,'currentSessionVersion',s.version,'currentFocusVersion',s.focus_version) FROM reception_terminals t JOIN _dg_native_dining_terminal_origins d ON d.terminal_id=t.id LEFT JOIN reception_sessions s ON s.terminal_id=t.id AND s.status IN('active','human') WHERE t.id=target
$dg$;
CREATE OR REPLACE FUNCTION dg_native_dining_open(target text,input jsonb,inputs_value jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;m memberships%ROWTYPE;s reception_sessions%ROWTYPE;next_value text;version_value bigint;focus_value bigint;
BEGIN
 meta:=dg_native_dining_terminal_prepare(target,false,true);m:=dg_native_restaurant_actor();PERFORM dg_native_restaurant_fields(input,ARRAY['action','confirmed','sessionId','version','focusVersion']);
 IF input->>'action' NOT IN('open','next') OR input->>'action' IS NULL OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'action'='open' AND input ?| ARRAY['sessionId','version','focusVersion'] THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
 SELECT * INTO s FROM reception_sessions WHERE terminal_id=target AND status IN('active','human') FOR UPDATE;
 IF input->>'action'='next' THEN
  version_value:=dg_native_restaurant_integer(input->'version',1,9007199254740991);focus_value:=dg_native_restaurant_integer(input->'focusVersion',0,9007199254740991);
  IF s.id IS NULL OR input->>'sessionId' IS DISTINCT FROM s.id OR s.version<>version_value OR s.focus_version<>focus_value THEN PERFORM dg_native_restaurant_error('VERSION_CONFLICT');END IF;
 END IF;
 IF s.id IS NOT NULL AND input->>'action'='open' THEN IF NOT dg_native_dining_source_valid(s.id) THEN PERFORM dg_native_reception_error('SOURCE_UNAVAILABLE');END IF;next_value:=s.id;
 ELSE
  IF s.id IS NOT NULL THEN PERFORM dg_native_reception_end(s.id,'restaurant_next_guest');END IF;
  next_value:=dg_native_dining_spawn(target,m.user_id,'manual',encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),inputs_value);
 END IF;RETURN dg_native_dining_operation(meta->>'restaurantId',target,next_value,NULL,input->>'action');
END;$dg$;
`;
fs.writeFileSync('migrations/postgres/'+migration,sql,{flag:'wx'});const manifestFile='migrations/postgres/runtime.json',manifest=read(manifestFile);assert.equal(manifest.version,85);assert.equal(manifest.migrations.at(-1).name,'088-native-restaurant-feature-scope.sql');manifest.version=86;manifest.migrations.push({name:migration,sha256:hash('migrations/postgres/'+migration)});
for(const file of ['packages/postgres/src/runtime-database.ts','tests/unit/postgres-runtime.test.ts']){let source=fs.readFileSync(file,'utf8'),old="'088-native-restaurant-feature-scope.sql']";assert.equal(source.split(old).length,2);source=source.replace(old,"'088-native-restaurant-feature-scope.sql','"+migration+"']");if(file.includes('runtime-database'))source=source.replace('manifest.version!==85','manifest.version!==86');fs.writeFileSync(file,source);}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({migration,version:86,sha256:manifest.migrations.at(-1).sha256,applied:false}));
