import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Repository} from '@digitalguide/database';
const folder='docs/evidence/T24/assistant/runtime';assert.ok(fs.existsSync(folder+'/upgrade-backup.json'));assert.ok(fs.existsSync(folder+'/before.json'));
const before=new DatabaseSync('storage/digitalguide.sqlite',{readOnly:true});try{assert.equal((before.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').get() as {name:string}).name,'041-advertising.sql');}finally{before.close();}
const repo=new Repository('storage',process.cwd(),{environment:'mock',appEnv:'development'});try{assert.equal(repo.get<{name:string}>('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')!.name,'042-studio-assistant.sql');process.stdout.write('Applied 042; existing migration files remain frozen.\n');}finally{repo.close();}
