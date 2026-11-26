import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {recoveryCheckDefinition as normalize,nativeRecoverySnapshotsEqual} from '../../packages/postgres/src/recovery-catalog.js';
import {nativeRecoverySnapshotSchema,type NativeRecoverySnapshot} from '../../packages/postgres/src/recovery-manifest.js';

const pairs=JSON.parse(fs.readFileSync('packages/test-fixtures/recovery-check-roundtrip.json','utf8')) as {table:string;name:string;source:string;target:string}[],sha='a'.repeat(64);
function snapshot():NativeRecoverySnapshot{return{schema:'dg_validation_'+randomUUID().replaceAll('-',''),runtimeId:randomUUID(),appEnv:'development',ownerRole:'owner',apiRole:'api',workerRole:'worker',sourceConnectionSHA256:sha,catalogSHA256:sha,recoveryCatalogAlgorithm:'check-bool-v1',recoveryCatalogSHA256:sha,tables:[{name:'users',rows:1,sha256:sha}],sequences:[],rows:1,migrations:[]};}
describe('原生恢复CHECK目录的严格布尔分组规范化',()=>{
 it.each(pairs)('实际跨集群差异$table/$name规范化后相同',p=>{expect(p.source).not.toBe(p.target);expect(normalize(p.source)).toEqual(normalize(p.target));});
 it('保留AND/OR的区别、相对次序、NOT、边界及算术分组',()=>{
  const source='CHECK (((a > 1) AND (b < 10)))';
  for(const text of ['CHECK (((a > 1) OR (b < 10)))','CHECK (((b < 10) AND (a > 1)))','CHECK ((NOT ((a > 1) AND (b < 10))))','CHECK (((a > 2) AND (b < 10)))'])expect(normalize(text)).not.toEqual(normalize(source));
  expect(normalize('CHECK ((((a + b) * c) > 1))')).not.toEqual(normalize('CHECK (((a + (b * c)) > 1))'));
 });
 it('函数参数列表和记录分组不与布尔表达式混淆',()=>{
  expect(normalize('CHECK (fn(((a > 1) AND (b > 2)), c))')).not.toEqual(normalize('CHECK (fn((a > 1), (b > 2), c))'));
  expect(normalize('CHECK (fn(((a,b))))')).not.toEqual(normalize('CHECK (fn((a,b)))'));
 });
 it('只合并同一操作符的结合分组，混合AND/OR结构保留',()=>{
  expect(normalize('CHECK ((((a > 0) AND (b > 0)) AND (c > 0)))')).toEqual(normalize('CHECK (((a > 0) AND (b > 0) AND (c > 0)))'));
  expect(normalize('CHECK ((((a > 0) OR (b > 0)) AND (c > 0)))')).not.toEqual(normalize('CHECK (((a > 0) OR ((b > 0) AND (c > 0))))'));
 });
 it.each(["CHECK ((name = 'AND OR (x)'::text))",'CHECK (("AND" > 1))',String.raw`CHECK ((name = E'a\'AND()'::text))`,'CHECK ((name = $literal$AND (x)$literal$::text))'])('字符串、转义、引用标识符和美元引用原样保留',text=>{expect(normalize(text)).toEqual(normalize(text));expect(normalize(text)).not.toEqual(normalize(text.replace('AND','OR')));});
 it.each(['CHECK ((x > 1)','CHECK ((x > 1)))',"CHECK ((name = 'unfinished))",'CHECK ((x > 1) /* unexpected */)','FOREIGN KEY (x) REFERENCES y(id)'])('无法安全解释的文本拒绝',text=>{expect(()=>normalize(text)).toThrow();});
 it('过深括号拒绝而不是耗尽调用栈',()=>{expect(()=>normalize('CHECK ('+'('.repeat(140)+'a'+')'.repeat(141))).toThrowError(expect.objectContaining({code:'PG_RECOVERY_CATALOG_UNSUPPORTED'}));});
 it('新的完整目录摘要允许已确认的原始表示差异',()=>{const expected=snapshot(),actual=structuredClone(expected);actual.catalogSHA256='b'.repeat(64);expect(nativeRecoverySnapshotsEqual(actual,expected)).toBe(true);});
 it('缺少或不同的目录算法/摘要不能跳过原始目录校验',()=>{const expected=snapshot(),actual=structuredClone(expected);delete actual.recoveryCatalogSHA256;expect(nativeRecoverySnapshotsEqual(actual,expected)).toBe(false);expect(nativeRecoverySnapshotSchema.safeParse(actual).success).toBe(false);delete expected.recoveryCatalogSHA256;expect(nativeRecoverySnapshotsEqual(actual,expected)).toBe(false);});
 it('旧归档只有精确目录相等才接受，不自动迁移其验证依据',()=>{const expected=snapshot(),actual=structuredClone(expected);delete expected.recoveryCatalogAlgorithm;delete expected.recoveryCatalogSHA256;expect(nativeRecoverySnapshotsEqual(actual,expected)).toBe(true);actual.catalogSHA256='b'.repeat(64);expect(nativeRecoverySnapshotsEqual(actual,expected)).toBe(false);});
 it.each(['data','permission','migration','identity','sequence'])('即使布尔目录相同，$s变化仍拒绝',kind=>{const expected=snapshot(),actual=structuredClone(expected);if(kind==='data')actual.tables[0].sha256='b'.repeat(64);if(kind==='permission')actual.recoveryCatalogSHA256='b'.repeat(64);if(kind==='migration')actual.migrations.push({name:'001-example.sql',sha256:sha});if(kind==='identity')actual.runtimeId=randomUUID();if(kind==='sequence')actual.sequences.push({name:'example',lastValue:'1',isCalled:true});expect(nativeRecoverySnapshotsEqual(actual,expected)).toBe(false);});
});
