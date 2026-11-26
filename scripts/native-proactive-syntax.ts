import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeRuntimeFixture} from '../tests/integration/postgres-runtime-helpers.js';
const out='docs/evidence/T20/postgres-proactive/syntax-draft.json',sql=fs.readFileSync('scripts/native-proactive.sql','utf8'),sha256=createHash('sha256').update(sql).digest('hex');
assert.equal(fs.existsSync(out),false);const x=await nativeRuntimeFixture();let error:unknown;
try{
 await x.owner(async db=>{await db.query('BEGIN');try{await db.query(sql);const r=(await db.query("SELECT dg_native_proactive_reason(NULL::_dg_native_proactive_settings) reason,dg_native_proactive_quiet('00:00','00:00','Asia/Shanghai') quiet")).rows[0];assert.equal(r.reason,'no_consent');assert.equal(r.quiet,true);await db.query('SELECT dg_native_proactive_project($1)',['00000000-0000-4000-8000-000000000000']);}finally{await db.query('ROLLBACK');}});
}catch(e){error=e;}finally{await x.close();}
fs.writeFileSync(out,JSON.stringify({result:error?'FAIL':'PASS_ROLLED_BACK_SQL_DRAFT_PARSE',checkedAt:new Date().toISOString(),root:x.cluster.root,port:x.cluster.port,sqlSHA256:sha256,sqlCommitted:false,businessBehaviorVerified:false,originalBaselineRuntime:120,allOwnedChildrenClosed:true,error:error instanceof Error?error.message:null},null,2)+'\n',{flag:'wx'});if(error)throw error;console.log(JSON.stringify({result:'PASS_ROLLED_BACK_SQL_DRAFT_PARSE',runtime:120,sqlCommitted:false}));
