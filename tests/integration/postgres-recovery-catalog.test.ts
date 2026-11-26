import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {nativeCluster,nativePostgresAvailable} from './postgres-native-cluster.js';
import {createPostgresClient,identifier} from '../../packages/postgres/src/config.js';
import {nativeRuntimeCatalog} from '../../packages/postgres/src/runtime-database.js';
import {recoveryCheckDefinition} from '../../packages/postgres/src/recovery-catalog.js';

describe.skipIf(!nativePostgresAvailable)('真实PostgreSQL恢复目录分组和篡改边界',()=>{
 let cluster:Awaited<ReturnType<typeof nativeCluster>>,source:ReturnType<typeof createPostgresClient>,target:ReturnType<typeof createPostgresClient>,canonical:string,original:string;
 const schema='dg_validation_'+randomUUID().replaceAll('-',''),targetDatabase='dg_catalog_'+randomUUID().replaceAll('-','').slice(0,16),reader='dg_catalog_reader';
 beforeAll(async()=>{
  cluster=await nativeCluster();const admin=await cluster.admin();try{await admin.query('CREATE ROLE '+identifier(reader)+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');await admin.query('CREATE DATABASE '+identifier(targetDatabase)+' OWNER '+identifier(cluster.connection.user)+" TEMPLATE template0 ENCODING 'UTF8'");}finally{await admin.end();}
  source=createPostgresClient(cluster.connection);target=createPostgresClient({...cluster.connection,database:targetDatabase});for(const c of [source,target]){await c.connect();await c.query('CREATE SCHEMA '+identifier(schema));await c.query('SET search_path TO '+identifier(schema)+',pg_catalog,pg_temp');await c.query("CREATE TABLE guarded(a integer NOT NULL,b integer NOT NULL,CONSTRAINT positive_bounds CHECK(a BETWEEN 1 AND 10 AND b BETWEEN 2 AND 20));CREATE FUNCTION sample(x integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT x + 1'");}
  original=(await source.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='guarded'::regclass AND conname='positive_bounds'")).rows[0].definition;
  await target.query('ALTER TABLE guarded DROP CONSTRAINT positive_bounds');await target.query('ALTER TABLE guarded ADD CONSTRAINT positive_bounds '+original);canonical=await nativeRuntimeCatalog(source,schema,recoveryCheckDefinition);
 },60000);
 afterAll(async()=>{try{await source?.end();await target?.end();}finally{await cluster?.stop();}},45000);
 async function change(sql:string){await target.query('BEGIN');try{await target.query(sql);expect(await nativeRuntimeCatalog(target,schema,recoveryCheckDefinition)).not.toBe(canonical);}finally{await target.query('ROLLBACK');}expect(await nativeRuntimeCatalog(target,schema,recoveryCheckDefinition)).toBe(canonical);}
 it('实际数据库重新解析CHECK后原目录不同、受限规范化目录相同',async()=>{expect(await nativeRuntimeCatalog(source,schema)).not.toBe(await nativeRuntimeCatalog(target,schema));expect(await nativeRuntimeCatalog(target,schema,recoveryCheckDefinition)).toBe(canonical);});
 it('修改比较边界仍拒绝',async()=>{await change('ALTER TABLE guarded DROP CONSTRAINT positive_bounds;ALTER TABLE guarded ADD CONSTRAINT positive_bounds CHECK(a BETWEEN 2 AND 10 AND b BETWEEN 2 AND 20)');});
 it('AND换成OR仍拒绝',async()=>{await change('ALTER TABLE guarded DROP CONSTRAINT positive_bounds;ALTER TABLE guarded ADD CONSTRAINT positive_bounds CHECK(a BETWEEN 1 AND 10 OR b BETWEEN 2 AND 20)');});
 it('约束未验证标记仍拒绝',async()=>{await change('ALTER TABLE guarded DROP CONSTRAINT positive_bounds;ALTER TABLE guarded ADD CONSTRAINT positive_bounds '+original+' NOT VALID');});
 it('约束继承语义变化仍拒绝',async()=>{await change('ALTER TABLE guarded DROP CONSTRAINT positive_bounds;ALTER TABLE guarded ADD CONSTRAINT positive_bounds '+original+' NO INHERIT');});
 it('表级权限扩张仍拒绝',async()=>{await change('GRANT SELECT ON guarded TO '+identifier(reader));});
 it('列级权限扩张仍拒绝',async()=>{await change('GRANT SELECT(a) ON guarded TO '+identifier(reader));});
 it('函数执行权限变化仍拒绝',async()=>{await change('REVOKE EXECUTE ON FUNCTION sample(integer) FROM PUBLIC');});
 it('函数实现变化仍拒绝',async()=>{await change("CREATE OR REPLACE FUNCTION sample(x integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT x + 2'");});
});
