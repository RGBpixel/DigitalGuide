import fs from 'node:fs';
import {createHash,createPrivateKey,createPublicKey,randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeRuntimeFixture} from './postgres-runtime-helpers.js';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {identifier} from '../../packages/postgres/src/config.js';
import {within,inventory,defaultLimits} from '../../packages/recovery/src/files.js';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';

describe.skipIf(!nativePostgresAvailable)('原生恢复日志与业务同事务捕获',()=>{
 let x:Awaited<ReturnType<typeof nativeRuntimeFixture>>;
 const events=()=>x.owner(async c=>(await c.query('SELECT id,payload,event_hash FROM _dg_native_recovery_journal_events ORDER BY id')).rows),count=()=>x.owner(async c=>(await c.query('SELECT count(*)::int n FROM _dg_native_recovery_journal_events')).rows[0].n as number);
 beforeAll(async()=>{x=await nativeRuntimeFixture({onInitialized:(result,cluster)=>{const root='docs/evidence/T20/postgres-recovery-journal',file=root+'/126-first-committed.json',sha256=createHash('sha256').update(fs.readFileSync('migrations/postgres/126-native-recovery-journal.sql')).digest('hex');if(fs.existsSync(file))expect(JSON.parse(fs.readFileSync(file,'utf8')).sha256).toBe(sha256);else fs.writeFileSync(file,JSON.stringify({result:'PASS_FIRST_COMMITTED_NATIVE_JOURNAL',checkedAt:new Date().toISOString(),runtime:123,name:'126-native-recovery-journal.sql',sha256,root:cluster.root,schema:result.schema},null,2)+'\n',{flag:'wx'});}});},120000);
 afterAll(async()=>{await x?.close();},60000);
 it('全部原生应用表有I/U/D及TRUNCATE覆盖，签名私钥在DATA_DIR之外',async()=>{
  await x.owner(async c=>{const coverage=(await c.query('SELECT dg_native_recovery_journal_coverage() value')).rows[0].value as {tableName:string;keys:string[];tracked:boolean}[];expect(coverage.length).toBeGreaterThan(480);expect(coverage.every(v=>v.tracked&&v.keys.length>0)).toBe(true);expect(coverage.some(v=>v.tableName==='_dg_native_recovery_journal_events')).toBe(false);expect((await c.query('SELECT coverage=dg_native_recovery_journal_coverage() same FROM _dg_native_recovery_journal_control WHERE id=1')).rows[0].same).toBe(true);expect((await c.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname=$1",[x.result.schema])).rows[0].n).toBe(495);});
  expect(within(x.result.journalSignerFile,x.result.api.dataDir)).toBe(false);const privateText=fs.readFileSync(x.result.journalSignerFile,'utf8'),privateKey=createPrivateKey(privateText);expect(privateKey.asymmetricKeyType).toBe('ed25519');const pub=createPublicKey(privateKey).export({type:'spki',format:'pem'}).toString();await x.owner(async c=>expect((await c.query('SELECT public_key FROM _dg_native_recovery_journal_control WHERE id=1')).rows[0].public_key===pub).toBe(true));
  for(const file of inventory(x.result.api.dataDir,defaultLimits).files)expect(fs.readFileSync(file.absolute,'utf8').includes(privateText)).toBe(false);
 });
 it('提交的最小记录绑定不同主键，不复制姓名正文或凭据',async()=>{
  const before=await count(),value='原创合成私密姓名-'+randomUUID();await x.owner(c=>c.query('UPDATE users SET name=$1 WHERE id=$2',[value,f.adminA]));expect(await count()).toBe(before+1);const all=await events(),changed=all.filter(r=>r.payload.tableName==='users'&&r.payload.operation==='U').at(-1);expect(changed).toBeDefined();expect(JSON.stringify(all).includes(value)).toBe(false);expect(changed!.payload.recordHash).toMatch(/^[a-f0-9]{64}$/);const initial=all.filter(r=>r.payload.tableName==='users'&&r.payload.operation==='I');expect(new Set(initial.map(r=>r.payload.recordHash)).size).toBe(4);
 });
 it('回滚业务更新也回滚恢复证据',async()=>{
  const before=await count();await x.owner(async c=>{await c.query('BEGIN');try{await c.query('UPDATE users SET name=$1 WHERE id=$2',['原创必须回滚',f.adminA]);expect((await c.query('SELECT count(*)::int n FROM _dg_native_recovery_journal_events')).rows[0].n).toBe(before+1);}finally{await c.query('ROLLBACK');}});expect(await count()).toBe(before);
 });
 it('不同业务行可独立提交，较早开始的事务可在另一个事务之后出现',async()=>{
  await x.owner(async a=>{await a.query('BEGIN');let committed=false;const b=await x.cluster.client();try{await b.query('SET search_path TO '+identifier(x.result.schema)+',pg_catalog,pg_temp');await a.query('UPDATE users SET name=$1 WHERE id=$2',['原创稍后提交',f.adminA]);const tx=(await a.query('SELECT pg_current_xact_id()::text value')).rows[0].value;await b.query('UPDATE users SET name=$1 WHERE id=$2',['原创先提交',f.adminB]);expect((await b.query("SELECT count(*)::int n FROM _dg_native_recovery_journal_events WHERE payload->>'transactionId'=$1",[tx])).rows[0].n).toBe(0);await a.query('COMMIT');committed=true;expect((await b.query("SELECT count(*)::int n FROM _dg_native_recovery_journal_events WHERE payload->>'transactionId'=$1",[tx])).rows[0].n).toBe(1);}finally{if(!committed)await a.query('ROLLBACK');await b.end();}});
 });
 it('TRUNCATE也产生同事务最小证据，回滚后原表与日志保持',async()=>{
  const before=await count();await x.owner(async c=>{const candidates=(await c.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='native_recovery_truncate') AND NOT EXISTS(SELECT 1 FROM pg_constraint f WHERE f.contype='f' AND f.confrelid=c.oid) ORDER BY c.relname",[x.result.schema])).rows;let table:string|undefined;for(const row of candidates){if((await c.query('SELECT 1 FROM '+identifier(row.relname)+' LIMIT 1')).rowCount===0){table=row.relname;break;}}expect(table).toBeDefined();await c.query('BEGIN');try{await c.query('TRUNCATE '+identifier(table!));const rows=(await c.query("SELECT payload FROM _dg_native_recovery_journal_events WHERE payload->>'tableName'=$1 AND payload->>'operation'='T'",[table])).rows;expect(rows).toHaveLength(1);expect(rows[0].payload.tenantId).toBeNull();}finally{await c.query('ROLLBACK');}});expect(await count()).toBe(before);
 });
 it('API和worker不能读写日志或安装捕获函数',async()=>{
  for(const[config,role]of [[x.result.api,'api'],[x.result.worker,'worker']] as const){const db=await NativePostgresDatabase.open(config,role);try{for(const sql of ['SELECT * FROM _dg_native_recovery_journal_events','SELECT * FROM _dg_native_recovery_journal_control','SELECT dg_native_recovery_journal_install()'])await expect(db.transaction(()=>db.query(sql),true)).rejects.toThrow();}finally{await db.close();}}
 });
 it('原生API正常创建队列和审计，事件与业务一起持久化',async()=>{
  const headers=await x.login(),response=await x.app.inject({method:'POST',url:'/api/v1/jobs',headers:{...headers,'idempotency-key':randomUUID()},payload:{workspaceId:f.workspaceA,kind:'provider.check'}});expect(response.statusCode).toBeGreaterThanOrEqual(200);expect(response.statusCode).toBeLessThan(300);const journal=await events();expect(journal.some(r=>r.payload.tableName==='jobs'&&r.payload.operation==='I')).toBe(true);expect(journal.some(r=>r.payload.tableName==='audit_events')).toBe(true);
 });
 it('日志、信任根与计划不可覆盖、删除或TRUNCATE',async()=>{
  const before=await count();for(const sql of ['UPDATE _dg_native_recovery_journal_events SET payload=payload','DELETE FROM _dg_native_recovery_journal_events','TRUNCATE _dg_native_recovery_journal_events','UPDATE _dg_native_recovery_journal_control SET public_key=public_key','TRUNCATE _dg_native_recovery_journal_plans'])await x.owner(async c=>{await expect(c.query(sql)).rejects.toThrow();});expect(await count()).toBe(before);
 });
});
