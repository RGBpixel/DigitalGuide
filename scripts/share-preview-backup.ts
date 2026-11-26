import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
const root=process.cwd(),folder=path.resolve('docs/evidence/T25/shares/runtime'),database=path.resolve('storage/digitalguide.sqlite'),file=path.resolve('storage/backups/shares-before-037-'+Date.now()+'.sqlite');
assert.ok(file.startsWith(path.resolve('storage/backups')+path.sep));fs.mkdirSync(folder,{recursive:true});assert.ok(!fs.existsSync(path.join(folder,'upgrade-backup.json')),'Keep the original upgrade record.');fs.mkdirSync(path.dirname(file),{recursive:true});
const db=new DatabaseSync(database,{readOnly:true});
try{const migration=db.prepare('SELECT name,applied_at FROM schema_migrations ORDER BY name DESC LIMIT 1').get() as {name:string};assert.equal(migration.name,'036-ae-templates.sql');await backup(db,file);const hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex');fs.writeFileSync(path.join(folder,'upgrade-backup.json'),JSON.stringify({file,sha256:hash,migrationBefore:migration,source:path.relative(root,database),createdAt:new Date().toISOString(),containsPrivateData:true,doNotPublishDatabase:true},null,2)+'\n',{flag:'wx'});process.stdout.write(JSON.stringify({result:'PRIVATE_BACKUP_SAVED',migrationBefore:migration.name})+'\n');}finally{db.close();}
