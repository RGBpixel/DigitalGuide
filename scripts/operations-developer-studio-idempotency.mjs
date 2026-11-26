import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
for(const name of ['062','141'])assert.equal(fs.existsSync('docs/evidence/T35/developer-studio/'+name+'-first-committed.json'),false);
for(const[file,native]of [['scripts/operations-developer-studio-sql.mjs',false],['migrations/sqlite/062-developer-studio.sql',false],['migrations/postgres/141-native-developer-studio.sql',true]]){
 let source=fs.readFileSync(file,'utf8');const from=native?'request_hash text NOT NULL CHECK(length(request_hash)=64),resource_id text':'request_hash TEXT NOT NULL CHECK(length(request_hash)=64),resource_id TEXT';assert.ok(source.includes(from));const typed=native?'idempotency_hash text CHECK(length(idempotency_hash)=64),':'idempotency_hash TEXT CHECK(length(idempotency_hash)=64),';source=source.replace(from,from.replace(',resource_id',','+typed+'resource_id'));
 const unique='UNIQUE(id,app_id,tenant_id,workspace_id,environment,app_env),FOREIGN KEY(app_id';assert.ok(source.includes(unique));source=source.replace(unique,'UNIQUE(app_id,kind,idempotency_hash),'+unique);fs.writeFileSync(file,source);
}
const file='migrations/postgres/runtime.json',manifest=JSON.parse(fs.readFileSync(file,'utf8'));manifest.migrations.find(item=>item.name==='141-native-developer-studio.sql').sha256=createHash('sha256').update(fs.readFileSync('migrations/postgres/141-native-developer-studio.sql')).digest('hex');fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({result:'UNCOMMITTED_STUDIO_OPERATIONS_APP_SCOPED_IDEMPOTENCY_BOUND'}));
