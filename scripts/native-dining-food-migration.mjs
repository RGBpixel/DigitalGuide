import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-food',migration='094-native-dining-food.sql',file='migrations/postgres/'+migration;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const previous=JSON.parse(read('docs/evidence/T20/postgres-dining/ui-verification.json'));for(const frozen of previous.frozenMigrations)assert.equal(hash(fs.readFileSync('migrations/postgres/'+frozen.migration)),frozen.migrationSHA256);
const source=read('migrations/postgres/091-native-dining-clock.sql');
function extract(name){const start=source.indexOf('CREATE OR REPLACE FUNCTION '+name+'(');assert.ok(start>=0,name);return source.slice(start,source.indexOf('$dg$;',start)+6);}
function replace(text,before,after){assert.equal(text.split(before).length,2,before);return text.replace(before,after);}
let sql=['native-dining-food-base.sql','native-dining-food-commands.sql','native-dining-food-guards.sql'].map(file=>read('scripts/'+file)).join('\n\n');
let guard=extract('dg_native_dining_row_guard');guard=replace(guard,' OR party_current.current_preference_id IS NOT NULL','');sql+='\n\n'+guard+'\n';
const views=[['dg_native_dining_party_view','dg_native_dining_party_projection(target,session_value IS NOT NULL OR p.owner_session_id IS NULL)','dg_native_food_party_projection(target,session_value IS NOT NULL OR p.owner_session_id IS NULL,meta)'],['dg_native_dining_parties','dg_native_dining_party_projection(row_value.id,false)','dg_native_food_party_projection(row_value.id,false,meta)'],['dg_native_dining_guest_view','dg_native_dining_party_projection(p.id,true)','dg_native_food_party_projection(p.id,true,meta)'],['dg_native_dining_action_result','dg_native_dining_party_projection(p.id,session_value IS NOT NULL OR p.owner_session_id IS NULL)','dg_native_food_party_projection(p.id,session_value IS NOT NULL OR p.owner_session_id IS NULL,meta)']];
for(const[name,before,after]of views)sql+='\n'+replace(extract(name),before,after)+'\n';
sql+="\nDO $food_acl$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_food_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$food_acl$;\n";
const manifestFile='migrations/postgres/runtime.json',manifest=JSON.parse(read(manifestFile));
if(fs.existsSync(file)){
 assert.ok(process.argv.includes('--regenerate-uncommitted'));assert.equal(fs.existsSync(root+'/migration-frozen.json'),false,'Committed094 must not be edited.');const bytes=fs.readFileSync(file),archive=root+'/unapplied-'+hash(bytes)+'.sql';if(!fs.existsSync(archive))fs.writeFileSync(archive,bytes,{flag:'wx'});assert.equal(manifest.version,91);assert.equal(manifest.migrations.at(-1).name,migration);manifest.migrations.at(-1).sha256=hash(sql);fs.writeFileSync(file,sql);
}else{
 assert.equal(manifest.version,90);assert.equal(manifest.migrations.at(-1).name,'093-native-dining-operation-variable.sql');fs.writeFileSync(file,sql,{flag:'wx'});manifest.version=91;manifest.migrations.push({name:migration,sha256:hash(sql)});
 for(const file of ['packages/postgres/src/runtime-database.ts','tests/unit/postgres-runtime.test.ts']){let text=read(file);text=replace(text,"'093-native-dining-operation-variable.sql']","'093-native-dining-operation-variable.sql','"+migration+"']");if(file.includes('runtime-database'))text=replace(text,'manifest.version!==90','manifest.version!==91');fs.writeFileSync(file,text);}
}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({migration,sha256:hash(sql),runtime:91,applied:false}));
