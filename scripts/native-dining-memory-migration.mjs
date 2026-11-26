import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const migration='095-native-dining-memory-purpose.sql',file='migrations/postgres/'+migration,manifestFile='migrations/postgres/runtime.json';
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
assert.equal(manifest.version,91);assert.equal(manifest.migrations.at(-1).name,'094-native-dining-food.sql');assert.equal(fs.existsSync(file),false);
for(const m of manifest.migrations)assert.equal(hash(fs.readFileSync('migrations/postgres/'+m.name)),m.sha256,m.name);
const sql=fs.readFileSync('scripts/native-dining-memory-purpose.sql','utf8').replace(/\r\n/g,'\n');
fs.writeFileSync(file,sql,{flag:'wx'});manifest.version=92;manifest.migrations.push({name:migration,sha256:hash(sql)});
for(const file of ['packages/postgres/src/runtime-database.ts','tests/unit/postgres-runtime.test.ts']){
 let source=fs.readFileSync(file,'utf8');const before="'094-native-dining-food.sql']";assert.equal(source.split(before).length,2);source=source.replace(before,"'094-native-dining-food.sql','"+migration+"']");
 if(file.includes('runtime-database')){assert.equal(source.split('manifest.version!==91').length,2);source=source.replace('manifest.version!==91','manifest.version!==92');}
 fs.writeFileSync(file,source);
}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({migration,sha256:hash(sql),runtime:92,applied:false}));
