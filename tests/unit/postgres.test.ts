import {describe,it,expect} from 'vitest';
import {parseConnectionConfig,identifier,targetSchema,PostgresMigrationError} from '../../packages/postgres/src/config.js';
import {normalizedRow,digest,loadBaseline,type TableDefinition} from '../../packages/postgres/src/source.js';
const config={purpose:'offline-staging-only',host:'127.0.0.1',port:5432,database:'dg_staging',user:'dg_loader',passwordFile:'private/password',tls:{mode:'loopback-test-only'}};
describe('PostgreSQL离线迁移输入与无损类型',()=>{
  it.each(['db.example.com','localhost','127.0.0.2','/tmp/postgres'])('未验证TLS不能连接非显式测试回环 %s',host=>{expect(()=>parseConnectionConfig({...config,host})).toThrow();});
  it.each(['password','connectionString','ssl','options'])('连接配置拒绝未知或旁路字段 %s',field=>{expect(()=>parseConnectionConfig({...config,[field]:'do-not-expose'})).toThrow(PostgresMigrationError);});
  it('需要显式数据库/端口/账号；远程证书模式通过结构检查',()=>{for(const name of ['database','port','user','host']){const x={...config} as Record<string,unknown>;delete x[name];expect(()=>parseConnectionConfig(x)).toThrow();}expect(parseConnectionConfig({...config,host:'db.example.com',tls:{mode:'verify-full',caFile:'private/ca'}}).tls.mode).toBe('verify-full');});
  it.each(['public','dg_import_existing','dg_import_'+('a'.repeat(32))+';DROP SCHEMA public','dg_import_'+('a'.repeat(33))])('拒绝覆写或SQL标识符注入 %s',schema=>{expect(()=>targetSchema(schema)).toThrow();});
  it('独立基线覆盖301表/3641列/399外键/106触发器，静态SQL摘要可复核',()=>{const {baseline}=loadBaseline(process.cwd());expect(baseline.counts).toMatchObject({tables:301,columns:3641,foreignKeys:399,triggers:106,explicitIndexes:149,checkConstraints:69});expect(baseline.sqliteMigrations).toHaveLength(52);expect(()=>identifier('bad"identifier')).toThrow();});
  const table:TableDefinition={name:'t',columns:[{name:'text',type:'TEXT',nullable:false},{name:'integer',type:'INTEGER',nullable:false},{name:'real',type:'REAL',nullable:true}],primaryKey:['text'],identity:null};
  it('64位整数和原始中文/JSON字符串不经过Number或JSON改写',()=>{const row={text:' {"名称":"合成虚构🌟"} ',integer:9223372036854775807n,real:1.25};expect(normalizedRow(table,row)).toEqual([row.text,'9223372036854775807',1.25]);expect(normalizedRow(table,{...row,integer:'9223372036854775807'},true)).toEqual(normalizedRow(table,row));});
  it.each([Buffer.from('before\0after'),Buffer.from([0xff,0xfe])])('原始SQLite文本字节中的NUL/无效UTF8在驱动截断或替换前拒绝 %#',bytes=>{expect(()=>normalizedRow(table,{text:bytes,__dg_type_0:'text',integer:1n,real:1})).toThrow();});
  it('TEXT列中的BLOB拒绝；有效UTF8原始字节可逐字保留',()=>{expect(()=>normalizedRow(table,{text:Buffer.from('valid'),__dg_type_0:'blob',integer:1n,real:1})).toThrow();expect(normalizedRow(table,{text:Buffer.from('中文🌟'),__dg_type_0:'text',integer:1n,real:1})[0]).toBe('中文🌟');});
  it('UTF8 BOM作为文本内容保留，不因解码器默认行为被删除',()=>{expect(normalizedRow(table,{text:Buffer.from('\uFEFF中文'),__dg_type_0:'text',integer:1n,real:1})[0]).toBe('\uFEFF中文');});
  it.each([{text:'bad\0text',integer:1n,real:1},{text:'ok',integer:1.5,real:1},{text:'ok',integer:9223372036854775808n,real:1},{text:null,integer:1n,real:1},{text:'ok',integer:1n,real:Infinity}])('不支持的数据拒绝迁移，不能截断或替换 %#',row=>{expect(()=>normalizedRow(table,row)).toThrow();});
  it('回执摘要不受JSONB对象键顺序影响，仍保留数组顺序',()=>{expect(digest([{a:1,b:2}])).toBe(digest([{b:2,a:1}]));expect(digest([1,2])).not.toBe(digest([2,1]));});
});
