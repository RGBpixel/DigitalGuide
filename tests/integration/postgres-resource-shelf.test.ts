import {describe,it,beforeAll,afterAll,expect} from 'vitest';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {canonical} from '@digitalguide/domain';
import {blankStudioDocument} from '@digitalguide/contracts';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {nativePostgresAvailable} from './postgres-native-cluster.js';
import {nativeShelfFixture} from './resource-shelf-fixtures.js';
import {resourceShelfContract} from './resource-shelf-contract.js';
describe.skipIf(!nativePostgresAvailable)('原生PG18货架运营、来源与一次模板生成',()=>resourceShelfContract(nativeShelfFixture,'postgres'));
describe.skipIf(!nativePostgresAvailable)('原生选用记录当前读取补验',()=>{
 let x:Awaited<ReturnType<typeof nativeShelfFixture>>;
 beforeAll(async()=>{x=await nativeShelfFixture();},120000);
 afterAll(async()=>x?.close(),60000);
 it('等待空间锁后的选用读取复查已提交关联，不返回等待前的旧状态',async()=>{
  const headers=await x.login(f.adminA),post=async(url:string,payload:object)=>{const r=await x.app.inject({method:'POST',url:'/api/v1/'+url,headers:{...headers,'idempotency-key':randomUUID()},payload});expect(r.statusCode,r.payload).toBeLessThan(300);return r.json().data;},template=await post('studio/templates',{workspaceId:f.workspaceA,name:'原生等待后读取模板',purpose:'video',document:blankStudioDocument(),variables:[],controls:[],description:'合成并发关联夹具',licenseNote:'仅用于本项目合成测试',rightsConfirmed:true}),entry=await post('resource-shelf',{workspaceId:f.workspaceA,kind:'template',sourceId:template.id,sourceVersion:template.version,title:'等待后当前选用',description:'',tags:[],licenseNote:'仅用于本项目合成测试',expiresAt:new Date(Date.now()+3_600_000).toISOString(),rightsConfirmed:true}),published=await post('resource-shelf/'+entry.id+'/control',{version:entry.version,action:'publish',confirmed:true}),selected=await post('resource-shelf/'+entry.id+'/select',{version:published.version,confirmed:true}),project=await post('studio/projects',{workspaceId:f.workspaceA,name:'并发关联前已创建的独立工程',purpose:'video',document:blankStudioDocument()});
  const owner=x.owner;if(!owner)throw Error('Native owner fixture is missing');const readCurrent=()=>x.app.inject({url:'/api/v1/resource-shelf/selections/'+selected.id,headers});let pending:Promise<Awaited<ReturnType<typeof readCurrent>>>|undefined,observedWait=false;
  await owner(async client=>{await client.query('BEGIN');try{await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[canonical(['native-asset-workspace',f.tenantA,f.workspaceA])]);pending=Promise.resolve(readCurrent());for(let i=0;i<120;i++){const rows=await x.query("SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.mode='ShareLock' AND NOT l.granted AND a.usename='dg_native_api'");if(rows.length){observedWait=true;break;}await new Promise(resolve=>setTimeout(resolve,25));}expect(observedWait).toBe(true);await client.query('UPDATE enterprise_shelf_selections SET project_id=$1 WHERE id=$2',[project.id,selected.id]);await client.query('COMMIT');}finally{await client.query('ROLLBACK');}});
  const r=await pending!;expect(r.statusCode,r.payload).toBe(200);expect(r.json().data.projectId).toBe(project.id);expect(r.json().data.nextPath).toBe('/studio/projects/'+project.id);fs.writeFileSync('docs/evidence/T35/resource-shelf/fresh-selection-read.json',JSON.stringify({result:'PASS',observedActualAdvisoryWait:true,syntheticConcurrentAssociation:true,actualNewBusinessByConcurrentWriter:false,returnedCurrentProject:true,snapshot:await x.snapshot()}),{flag:'wx'});
 });
});
