import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-runtime',read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const files=[...fs.readdirSync('packages/postgres/src').map(f=>'packages/postgres/src/'+f),'packages/database/src/index.ts','packages/database/src/store-selection.ts','apps/api/src/app.ts','apps/api/src/config.ts','apps/api/src/api-errors.ts','apps/api/src/postgres-core-app.ts','apps/worker/src/main.ts','apps/worker/src/postgres-core.ts','migrations/postgres/runtime.json','migrations/postgres/004-native-runtime.sql','migrations/postgres/005-native-tenant-lock.sql','scripts/postgres-runtime.ts','scripts/postgres-runtime-compiled-proof.ts','scripts/postgres-runtime-transaction-probe.ts','tests/unit/postgres-runtime.test.ts','tests/integration/postgres-runtime.test.ts','tests/integration/postgres-runtime-helpers.ts'];
const backend=read(root+'/backend-final.json'),proof=read(root+'/compiled-current/proof.json');
assert.equal(backend.success,true);assert.equal(backend.numPassedTests,146);assert.equal(backend.testResults.length,9);assert.equal(backend.numPendingTests,0);
const native=backend.testResults.filter(t=>t.name.replaceAll('\\','/').endsWith('/postgres-runtime.test.ts'));assert.equal(native.length,2);assert.equal(native.reduce((n,t)=>n+t.assertionResults.length,0),50);
const reviews=[
 ['same_real_repository','API factory and worker entry select native async repository explicitly. Actual PostgreSQL/TLS processes execute SQL, not an in-memory SQLite or SQL mirror.'],
 ['transaction_boundary','One pooled connection across await; nested errors poison outer transactions; outstanding queries, detached work and readonly writes fail closed.'],
 ['current_identity_and_scope','Signed instance-specific cookies, persisted sessions, final expiry check, membership shared locks, real workspace ownership, server permissions, CSRF and Origin checks.'],
 ['jobs_and_quota','Reference-only idempotency rechecks current permissions; advisory/tenant locks serialize same-key and quota competition.'],
 ['lease_completion','SKIP LOCKED claims; actual DB time after locks; fixed ten seconds; token and current DB expiry in final UPDATE; current member authorization before adopting results.'],
 ['native_roles_and_catalog','Separate non-superuser loader/API/worker, explicit connection/TLS, fixed function search_path, PUBLIC function privileges revoked, catalog ACL fingerprint, no member/tenant updates or schema DDL for runtime roles.'],
 ['archive_and_directory','Empty validation schemas only; fresh marked private directory and keys; imported archives stay isolated; intended PostgreSQL never falls back to SQLite.'],
 ['limits','Only provider.check native task execution, with explicit simulated result. All other platform modules require migration; unsupported routes return a clear 503. No production or real supplier acceptance.'],
 ['process_evidence','Two compiled HTTP API processes and two workers, actual SIGKILL before COMMIT and after lease commit, natural lease recovery, API and database restarts, independent process cleanup.'],
 ['preservation_and_audit','Original SQLite business rows and keys preserved; original failures retained. Positive ProcessId is the reviewed OS field; earlier weak pid audit supplemented without rewriting its evidence. Vite metadata is a generated cache.']
].map(([id,finding])=>({id,result:'REVIEWED',finding}));
assert.equal(proof.result,'PASS');assert.equal(proof.checks.length,10);
const result={result:'PASS',checkedAt:new Date().toISOString(),requirements:['R-058','R-007','R-009','R-052','R-054'],reviews,sourceSHA256:Object.fromEntries(files.sort().map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),actualBackendTests:146,actualBackendFiles:9,newNativeTests:50,existingTests:96,skippedTests:0,productionBusinessEnabled:false,wholeT20Completed:false,wholeG2Completed:false,goalComplete:false};
fs.writeFileSync(root+'/current-source-review.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'PASS',sourceFiles:files.length,reviews:reviews.length,actualTests:146,newTests:50}));
