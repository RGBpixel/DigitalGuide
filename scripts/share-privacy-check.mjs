import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import cookie from '@fastify/cookie';
const folder='docs/evidence/T25/shares',output=process.argv[2]||folder+'/privacy.json',files=[],values=[],secret=fs.readFileSync('storage/.session-secret','utf8').trim();
const add=v=>{if(typeof v==='string'&&v.length>=16)values.push(Buffer.from(v));};add(secret);
const db=new DatabaseSync('storage/digitalguide.sqlite',{readOnly:true});
try{
 for(const r of db.prepare('SELECT csrf_token FROM auth_sessions').all())add(r.csrf_token);
 for(const r of db.prepare('SELECT csrf_token FROM studio_frame_review_sessions').all())add(r.csrf_token);
 for(const r of db.prepare('SELECT id,nonce FROM studio_share_links').all())add(createHmac('sha256',secret).update('digitalguide-share-link-v1|'+r.id+'|'+r.nonce).digest('hex'));
 for(const r of db.prepare('SELECT id,nonce FROM studio_share_sessions').all()){
  const token=createHmac('sha256',secret).update('digitalguide-share-session-v1|'+r.id+'|'+r.nonce).digest('hex');add(token);add(cookie.sign(token,secret));add(encodeURIComponent(cookie.sign(token,secret)));add(createHmac('sha256',secret).update('digitalguide-share-csrf-v1|'+r.id+'|'+r.nonce).digest('hex'));
 }
}finally{db.close();}
let compiledDatabases=0;
for(const directory of fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('compiled-'))){
 const proof=path.join(folder,directory.name,'proof.json');if(!fs.existsSync(proof))continue;const p=JSON.parse(fs.readFileSync(proof,'utf8')),database=path.join(p.privateDataDir,'digitalguide.sqlite');if(!fs.existsSync(database))continue;const d=new DatabaseSync(database,{readOnly:true});try{for(const r of d.prepare('SELECT csrf_token FROM auth_sessions').all())add(r.csrf_token);compiledDatabases++;}finally{d.close();}
}
function walk(directory){for(const e of fs.readdirSync(directory,{withFileTypes:true})){const f=path.posix.join(directory,e.name);if(e.isDirectory())walk(f);else if(e.isFile()&&f!==output)files.push(f);}}
walk(folder);walk('dist/web');files.push('dist/share-player.js','storage/share-preview-state.json');
const matches=[];
for(const file of files){const bytes=fs.readFileSync(file),text=bytes.toString('latin1');if(values.some(v=>bytes.includes(v))||/#access=[a-f0-9]{64}/i.test(text)||/\b(?:dg_session|dg_share)=[a-f0-9]{64,}(?:\.|%2e)[a-z0-9_+/%=-]{20,}/i.test(text)||/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(text))matches.push(file);}
const result={result:matches.length?'FAIL_RAW_CREDENTIALS':'PASS_NO_RAW_SHARE_CREDENTIALS',checkedAt:new Date().toISOString(),scannedFiles:files.length,retainedCredentialValuesChecked:values.length,isolatedCompiledDatabasesChecked:compiledDatabases,rawCredentialBytesFound:matches.length>0,matchedFiles:matches,checked:['retained main authentication/review CSRF','main private server secret','derived main share access/session/CSRF and signed credentials','retained compiled-process member CSRF','raw access-fragment and signed-cookie patterns','PEM private-key patterns','new evidence, resumable checkpoint and frontend bundles'],notChecked:['all transient isolated test credentials are not enumerated after process shutdown','private databases, configuration, TLS keys and backups remain under storage and are not delivered','screenshots are inspected visually, not OCR-scanned']};
assert.ok(!fs.existsSync(output),'Keep the original privacy report.');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});process.stdout.write(JSON.stringify({result:result.result,files:files.length,matches:matches.length})+'\n');assert.equal(matches.length,0);
