import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const root='docs/evidence/T20/postgres-dining',frozen=JSON.parse(fs.readFileSync(root+'/claim-frozen.json','utf8'));
const source=fs.readFileSync('migrations/postgres/'+frozen.migration,'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),frozen.sha256);
const start=source.indexOf('CREATE OR REPLACE FUNCTION dg_native_dining_apply(');assert.ok(start>=0);
const original=source.slice(start,source.indexOf('$dg$;',start)+6);
assert.equal(original.split('dg_native_dining_apply.action_id').length,2);
// All action_id tokens in this routine are the local operation value. The
// INSERT statements use positional values; no column declarations are changed.
assert.doesNotMatch(original.replace('dg_native_dining_apply.action_id',''),/\w+\.action_id\b/);
const sql='-- Preserve090-092. The local operation identifier must not shadow the selection ledger column.\n'+original.replace('dg_native_dining_apply.action_id','action_id').replace(/\baction_id\b/g,'dining_action_identifier')+'\n';
const migration='093-native-dining-operation-variable.sql';fs.writeFileSync('migrations/postgres/'+migration,sql,{flag:'wx'});
const manifestFile='migrations/postgres/runtime.json',manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));assert.equal(manifest.version,89);assert.equal(manifest.migrations.at(-1).name,frozen.migration);
manifest.version=90;manifest.migrations.push({name:migration,sha256:createHash('sha256').update(sql).digest('hex')});
for(const file of ['packages/postgres/src/runtime-database.ts','tests/unit/postgres-runtime.test.ts']){
 let text=fs.readFileSync(file,'utf8');const before="'092-native-dining-claim-owner.sql']";assert.equal(text.split(before).length,2);text=text.replace(before,"'092-native-dining-claim-owner.sql','"+migration+"']");
 if(file.includes('runtime-database')){assert.ok(text.includes('manifest.version!==89'));text=text.replace('manifest.version!==89','manifest.version!==90');}fs.writeFileSync(file,text);
}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({migration,version:90,sha256:manifest.migrations.at(-1).sha256,applied:false}));
