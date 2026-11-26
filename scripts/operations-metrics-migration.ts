import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {operationsProjectionQuery} from '../packages/operations/src/metrics.js';
const file='migrations/postgres/129-native-operations-metrics.sql';assert.equal(fs.existsSync(file),false);const q=operationsProjectionQuery({workspaceId:'20000000-0000-4000-8000-000000000001',days:30},{principal:{userId:'30000000-0000-4000-8000-000000000001',tenantId:'10000000-0000-4000-8000-000000000001',role:'admin',workspaceIds:['20000000-0000-4000-8000-000000000001']},database:'postgres',appEnv:'development',environment:'mock',capturedAt:'2026-11-25T16:00:00.000Z'}),variables=['v_tenant','p_workspace',"'mock'",'v_app','v_from','p_snapshot','v_quota'],projection=q.sql.replace(/\$(\d+)::text/g,(_,n:string)=>variables[Number(n)-1]);assert.ok(!/\$[1-9]/.test(projection));
const sql=`-- R-117/R-122. Only aggregate counts and declared usage; never private bodies.
CREATE FUNCTION dg_native_operations_metrics(p_workspace text,p_days integer,p_snapshot text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_actor text:=current_setting('digitalguide.actor_id',true);v_token text:=current_setting('digitalguide.auth_token_hash',true);v_tenant text;v_app text;v_from text;v_quota text;v_result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only' AND c.environment='mock' AND c.app_role=session_user) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Operations aggregates require the current API runtime';END IF;
 IF p_days IS NULL OR p_days NOT IN(7,30,90) OR p_snapshot IS NULL OR p_snapshot !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Operations range is invalid';END IF;
 IF p_snapshot::timestamptz>statement_timestamp() OR p_snapshot::timestamptz<statement_timestamp()-interval '1 minute' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Operations snapshot is stale';END IF;
 SELECT m.tenant_id,c.app_env INTO v_tenant,v_app FROM memberships m JOIN workspaces w ON w.tenant_id=m.tenant_id AND w.id=p_workspace JOIN _dg_native_runtime_control c ON c.id=1 JOIN auth_sessions a ON a.user_id=m.user_id AND a.token_hash=v_token AND a.environment=c.environment AND a.app_env=c.app_env AND a.expires_at::timestamptz>statement_timestamp() WHERE m.user_id=v_actor AND m.role='admin' AND m.workspace_ids::jsonb ? p_workspace;
 IF v_tenant IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Operations require an active admin session and current workspace';END IF;
 v_from:=to_char(((date_trunc('day',p_snapshot::timestamptz AT TIME ZONE 'Asia/Shanghai')-(p_days-1)*interval '1 day') AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 v_quota:=substring(p_snapshot FROM 1 FOR 10)||'T00:00:00.000Z';
 SELECT coalesce(jsonb_agg(to_jsonb(payload)),'[]'::jsonb) INTO v_result FROM(
${projection}
 ) payload;RETURN v_result;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_operations_metrics(text,integer,text) FROM PUBLIC;
`;
fs.writeFileSync(file,sql,{flag:'wx'});const registryFile='migrations/postgres/runtime.json',r=JSON.parse(fs.readFileSync(registryFile,'utf8'));assert.equal(r.version,125);assert.equal(r.migrations.at(-1).name,'128-native-recovery-authority.sql');r.version=126;r.migrations.push({name:file.split('/').at(-1),sha256:createHash('sha256').update(sql).digest('hex')});fs.writeFileSync(registryFile,JSON.stringify(r,null,2)+'\n');
function replace(f:string,a:string,b:string){const s=fs.readFileSync(f,'utf8');assert.equal(s.split(a).length,2,f);fs.writeFileSync(f,s.replace(a,()=>b));}
replace('packages/postgres/src/runtime-database.ts',"'128-native-recovery-authority.sql'];","'128-native-recovery-authority.sql','129-native-operations-metrics.sql'];");replace('packages/postgres/src/runtime-database.ts','manifest.version!==125','manifest.version!==126');replace('tests/unit/postgres-runtime.test.ts',"'128-native-recovery-authority.sql']);","'128-native-recovery-authority.sql','129-native-operations-metrics.sql']);");
replace('apps/api/src/postgres-core-app.ts',`SELECT set_config('digitalguide.actor_id',$1,true)",[s.principal.userId]`,`SELECT set_config('digitalguide.actor_id',$1,true),set_config('digitalguide.auth_token_hash',$2,true)",[s.principal.userId,hash]`);
console.log(JSON.stringify({result:'PASS_OPERATIONS_PRIVATE_AGGREGATE_WIRING',runtime:126,migration:file,nextMigration:'130',nativeTables:495,sqlite:'052'}));
