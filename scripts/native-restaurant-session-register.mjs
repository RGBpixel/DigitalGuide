import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const file='087-native-restaurant-sessions.sql',manifestFile='migrations/postgres/runtime.json',manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
assert.equal(manifest.version,83);assert.equal(manifest.migrations.at(-1).name,'086-native-restaurant-item-alias.sql');
manifest.version=84;manifest.migrations.push({name:file,sha256:createHash('sha256').update(fs.readFileSync('migrations/postgres/'+file)).digest('hex')});
for(const source of ['packages/postgres/src/runtime-database.ts','tests/unit/postgres-runtime.test.ts']){let text=fs.readFileSync(source,'utf8');const old="'086-native-restaurant-item-alias.sql']";assert.equal(text.split(old).length,2);text=text.replace(old,"'086-native-restaurant-item-alias.sql','"+file+"']");if(source.includes('runtime-database')){assert.ok(text.includes('manifest.version!==83'));text=text.replace('manifest.version!==83','manifest.version!==84');}fs.writeFileSync(source,text);}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({registered:file,version:84,sha256:manifest.migrations.at(-1).sha256,applied:false}));
