import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const root='docs/evidence/T20/postgres-dining';
for(const file of ['migration-frozen.json','clock-frozen.json']){
 const frozen=JSON.parse(fs.readFileSync(root+'/'+file,'utf8'));
 assert.equal(createHash('sha256').update(fs.readFileSync('migrations/postgres/'+frozen.migration)).digest('hex'),frozen.sha256);
}
const source=fs.readFileSync('migrations/postgres/091-native-dining-clock.sql','utf8');
const start=source.indexOf('CREATE OR REPLACE FUNCTION dg_native_dining_apply(');
assert.ok(start>=0);
const original=source.slice(start,source.indexOf('$dg$;',start)+6);
const before='SELECT old_owner.id,coalesce(max(version),0)+1,NULL,action_id,now_value';
assert.equal(original.split(before).length,2);
const sql='-- Preserve090/091 and all stored deadlines. Qualify the operation variable against the selection ledger column.\n'+original.replace(before,'SELECT old_owner.id,coalesce(max(version),0)+1,NULL,dg_native_dining_apply.action_id,now_value')+'\n';
const migration='092-native-dining-claim-owner.sql';
fs.writeFileSync('migrations/postgres/'+migration,sql,{flag:'wx'});
const manifestFile='migrations/postgres/runtime.json',manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
assert.equal(manifest.version,88);assert.equal(manifest.migrations.at(-1).name,'091-native-dining-clock.sql');
manifest.version=89;manifest.migrations.push({name:migration,sha256:createHash('sha256').update(sql).digest('hex')});
for(const file of ['packages/postgres/src/runtime-database.ts','tests/unit/postgres-runtime.test.ts']){
 let text=fs.readFileSync(file,'utf8');const before="'091-native-dining-clock.sql']";
 assert.equal(text.split(before).length,2);text=text.replace(before,"'091-native-dining-clock.sql','"+migration+"']");
 if(file.includes('runtime-database')){assert.ok(text.includes('manifest.version!==88'));text=text.replace('manifest.version!==88','manifest.version!==89');}
 fs.writeFileSync(file,text);
}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({migration,version:89,sha256:manifest.migrations.at(-1).sha256,applied:false}));
