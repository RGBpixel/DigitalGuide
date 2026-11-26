import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureIds as F } from '../../packages/test-fixtures/src/seed.js';
import type { StudioDocument, StudioProject, StudioExport, ExportPlan } from '../../packages/contracts/src/index.js';
import type { DeveloperStudioAction, DeveloperStudioView, DeveloperStudioMutationResult } from '../../packages/contracts/src/developer-studio.js';
import type { DeveloperMutationResult } from '../../packages/contracts/src/developer-access.js';
import type { StudioAppFixture, StudioAppHeaders } from './developer-studio-fixtures.js';

const actions:DeveloperStudioAction[]=['projects.write','exports.submit','exports.cancel','exports.download'];
const settings={preset:'hd' as const,fps:24 as const,transparent:false,omitBackground:false,burnSubtitles:false};
function document():StudioDocument{return{schemaVersion:1,canvas:{width:640,height:360,fps:24,transparent:false},brand:{primaryColor:'#183b56',accentColor:'#146c94',textColor:'#ffffff',fontFamily:'sans',logoAssetId:null},speakers:[],segments:[{id:randomUUID(),title:'合成片段',speakerId:null,text:'合成制作接口测试',durationMs:1000,elements:[],source:null,backgroundColor:'#183b56',avatar:{x:0,y:0,width:1,height:1},notes:''}],timeline:null};}
export function developerStudioContract(factory:()=>Promise<StudioAppFixture>,dialect:'sqlite'|'postgres'){
 describe.sequential(dialect+' 应用制作、导出与撤权',()=>{
  let x:StudioAppFixture,admin:StudioAppHeaders,viewer:StudioAppHeaders,appId:string,token:string,oldToken:string,credentialId:string,caseName:string;
  const states:Record<string,Record<string,unknown>>={};
  function retain(extra:Record<string,unknown>={}){if(!x)return;states[caseName]={...states[caseName],appId,token,oldToken,credentialId,admin,viewer,...extra};fs.writeFileSync(path.join(x.root,'studio-case-state.private.json'),JSON.stringify(states,null,2)+'\n',{mode:0o600});}
  async function human(url:string,payload:object,headers=admin,key:string=randomUUID()){return x.app.inject({method:'POST',url:'/api/v1'+url,headers:{...headers,'idempotency-key':key},payload});}
  async function good<T>(url:string,payload:object,headers=admin):Promise<T>{const r=await human(url,payload,headers);expect(r.statusCode,'Human API '+url+' '+r.json().error?.code).toBe(200);return r.json().data as T;}
  async function view(headers=admin):Promise<DeveloperStudioView>{const r=await x.app.inject({url:'/api/v1/enterprise/developer-studio?workspaceId='+F.workspaceA,headers});expect(r.statusCode).toBe(200);return r.json().data;}
  async function app(){return(await view()).apps.find(a=>a.id===appId)!;}
  async function grantBody(override:Record<string,unknown>={}){const v=await view(),a=v.apps.find(a=>a.id===appId)!;return{workspaceId:F.workspaceA,appId,expectedAppVersion:a.version,expectedVersion:a.grant?.version??0,responsibleUserId:F.editorA,responsibleConfigurationToken:v.members.find(m=>m.id===F.editorA)!.configurationToken,actions,enabled:true,termDays:30,confirmed:true,...override};}
  async function configure(override:Record<string,unknown>={},headers=admin,key:string=randomUUID()){return human('/enterprise/developer-studio/configure',await grantBody(override),headers,key);}
  async function issue(){const a=await app(),r=await good<DeveloperMutationResult>('/enterprise/developers/issue',{workspaceId:F.workspaceA,appId,expectedVersion:a.version,termDays:30,confirmed:true});return r.issuedCredential!;}
  async function machine(url='/context',payload?:object,key:string=randomUUID(),bearer=token,extra:Record<string,string>={}){return x.app.inject({method:payload?'POST':'GET',url:'/api/open/v1/studio'+url,headers:{...extra,authorization:'Bearer '+bearer,...(payload?{'idempotency-key':key}:{})},...(payload?{payload}:{})});}
  async function create(name='合成应用工程',key:string=randomUUID(),doc=document()){const input={name,purpose:'video',document:doc,confirmed:true};retain({createInput:input,createKey:key});const r=await machine('/projects',input,key);expect(r.statusCode,'Machine create '+r.json().error?.code).toBe(200);const data=r.json().data as DeveloperStudioMutationResult;retain({projectId:data.project!.id,project:data.project,createOperationId:data.operationId});return data.project!;}
  async function enqueue(project:StudioProject){const input={version:project.version,kind:'video',settings,startMs:0,durationMs:1000},plan=await machine('/projects/'+project.id+'/export-plan',input);expect(plan.statusCode,'Export plan '+plan.json().error?.code).toBe(200);const p=plan.json().data as ExportPlan;expect(p.canExport).toBe(true);const body={...input,planHash:p.hash,confirmed:true,rightsConfirmed:true},key=randomUUID();retain({exportInput:body,exportKey:key});const r=await machine('/projects/'+project.id+'/exports',body,key);expect(r.statusCode,'Export create '+r.json().error?.code).toBe(200);const data=r.json().data as DeveloperStudioMutationResult;retain({exportId:data.export!.id,exportOperationId:data.operationId});return data.export!;}
  async function control(enabled:boolean,readScopes=['projects.read','exports.read']){const a=await app();return good('/enterprise/developers/control',{workspaceId:F.workspaceA,appId,expectedVersion:a.version,name:a.name,scopes:readScopes,enabled,confirmed:true});}
  async function count(table:string,where='',args:string[]=[]){return Number((await x.query('SELECT count(*) n FROM '+table+(where?' WHERE '+where:''),...args))[0].n);}
  beforeAll(async()=>{x=await factory();admin=await x.login(F.adminA);viewer=await x.login(F.viewerA);},180000);
  beforeEach(async context=>{
   caseName=context.task.name;appId='';token='';oldToken='';credentialId='';const name='合成制作应用-'+randomUUID().slice(0,8);
   const r=await good<DeveloperMutationResult>('/enterprise/developers/create',{workspaceId:F.workspaceA,name,scopes:['projects.read','exports.read'],confirmed:true});appId=r.view.apps.find(a=>a.name===name)!.id;retain();
   const old=await issue();oldToken=old.oneTimeToken!;retain();const configured=await configure();expect(configured.statusCode,'Initial grant '+configured.json().error?.code).toBe(200);const issued=await issue();token=issued.oneTimeToken!;credentialId=issued.id;retain();
  },30000);
  afterEach(async context=>{vi.restoreAllMocks();const result=context.task.result?.state;retain({result});if(appId&&result!=='fail')await control(false);},30000);
  afterAll(async()=>{await x?.close();},90000);

  it('委托要求当前管理员、CSRF、明确确认及当前可制作责任人',async()=>{
   expect((await configure({},viewer)).statusCode).toBe(403);
   expect((await configure({}, {...admin,'x-csrf-token':'invalid'})).statusCode).toBe(403);
   expect((await configure({confirmed:false})).statusCode).toBe(400);
   expect((await configure({responsibleUserId:F.viewerA})).statusCode).toBe(403);
   expect((await configure({responsibleUserId:F.adminB})).statusCode).toBe(403);
   expect((await configure({responsibleConfigurationToken:'0'.repeat(64)})).statusCode).toBe(409);
   const r=await x.app.inject({url:'/api/v1/enterprise/developer-studio?workspaceId='+F.workspaceB,headers:admin});expect(r.statusCode).toBeGreaterThanOrEqual(400);
  });
  it('首次及后续授权撤销旧凭证，机器身份不建立员工会话',async()=>{
   const before=await count('auth_sessions');expect((await machine('/context',undefined,randomUUID(),oldToken)).statusCode).toBe(401);
   const response=await machine();expect(response.statusCode).toBe(200);expect(response.json().data).toMatchObject({identity:'organization_application',appId,workspaceId:F.workspaceA,grantVersion:1});
   expect(response.headers['set-cookie']).toBeUndefined();expect((await machine('/context',undefined,randomUUID(),'invalid',admin)).statusCode).toBe(401);expect(await count('auth_sessions')).toBe(before);
   expect((await configure()).statusCode).toBe(200);expect((await machine()).statusCode).toBe(401);token=(await issue()).oneTimeToken!;retain();expect((await machine()).statusCode).toBe(200);
  });
  it('部分空间管理员可核对但不能授予组织应用制作权限',async()=>{
   const id=randomUUID();await good('/enterprise/members/create',{workspaceId:F.workspaceA,userId:id,name:'合成部分管理员',role:'admin',workspaceIds:[F.workspaceA],confirmed:true});const partial=await x.login(id),v=await view(partial);expect(v.canManageOrganization).toBe(false);expect((await configure({},partial)).statusCode).toBe(403);
  });
  it('工程正文及编辑版本保留，拒绝空间和执行人注入以及旧修订',async()=>{
   const p=await create();expect(p.workspaceId).toBe(F.workspaceA);expect(p.frames).toEqual([]);const read=await machine('/projects/'+p.id);expect(read.statusCode).toBe(200);expect(read.json().data.document).toEqual(p.document);
   for(const extra of [{workspaceId:F.workspacePrivate},{actorId:F.adminA},{environment:'live'}])expect((await machine('/projects',{name:'拒绝注入',purpose:'video',confirmed:true,...extra})).statusCode).toBe(400);
   const doc=structuredClone(p.document);doc.segments[0].text='已编辑合成台词';const input={version:p.version,name:'修订工程',document:doc,confirmed:true},key=randomUUID();retain({saveInput:input,saveKey:key});const saved=await machine('/projects/'+p.id+'/save',input,key);expect(saved.statusCode).toBe(200);expect(saved.json().data.project.version).toBe(2);expect(saved.json().data.project.document.segments[0].text).toBe('已编辑合成台词');
   expect((await machine('/projects/'+p.id+'/save',input)).statusCode).toBe(409);
  });
  it('并发创建及跨凭证重试只保留同一工程和操作，不缓存正文或密钥',async()=>{
   const input={name:'并发合成工程',purpose:'video',confirmed:true,document:document()},key=randomUUID();retain({createInput:input,createKey:key});const replies=await Promise.all(Array.from({length:6},()=>machine('/projects',input,key)));expect(replies.map(r=>r.statusCode)).toEqual(Array(6).fill(200));
   const data=replies[0].json().data as DeveloperStudioMutationResult;retain({projectId:data.project!.id,createOperationId:data.operationId});expect(new Set(replies.map(r=>r.json().data.operationId)).size).toBe(1);expect(new Set(replies.map(r=>r.json().data.project.id)).size).toBe(1);
   const next=await issue();token=next.oneTimeToken!;credentialId=next.id;retain();const replay=await machine('/projects',input,key);expect(replay.statusCode).toBe(200);expect(replay.json().data.operationId).toBe(data.operationId);expect((await machine('/projects',{...input,name:'内容变化'},key)).statusCode).toBe(409);
   const operations=await x.query('SELECT * FROM developer_studio_operations WHERE app_id=?',appId);expect(operations).toHaveLength(1);const text=JSON.stringify(operations);expect(text.includes(token)).toBe(false);expect(text.includes('并发合成工程')).toBe(false);expect(operations[0].responsible_user_id).toBe(F.editorA);
  });
  it('租户、空间与素材边界由服务端检查',async()=>{
   const privateProject=await good<StudioProject>('/studio/projects',{workspaceId:F.workspacePrivate,name:'合成其他空间',purpose:'video'}),other=await x.login(F.adminB),foreign=await good<StudioProject>('/studio/projects',{workspaceId:F.workspaceB,name:'合成其他组织',purpose:'video'},other);
   retain({privateProjectId:privateProject.id,foreignProjectId:foreign.id});expect([403,404]).toContain((await machine('/projects/'+privateProject.id)).statusCode);expect((await machine('/projects/'+foreign.id)).statusCode).toBe(404);
   const doc=document();doc.brand.logoAssetId=F.privateAsset;expect((await machine('/projects',{name:'越界素材',purpose:'video',document:doc,confirmed:true})).statusCode).toBeGreaterThanOrEqual(400);
   expect((await machine('/context?workspaceId='+F.workspacePrivate)).statusCode).toBe(400);
  });
  it('工程写入、导出提交、取消和下载动作分别授权',async()=>{
   expect((await configure({actions:['exports.download']})).statusCode).toBe(200);token=(await issue()).oneTimeToken!;retain();expect((await machine('/projects',{name:'禁止写入',purpose:'video',confirmed:true})).statusCode).toBe(403);
   expect((await machine('/exports/'+randomUUID()+'/cancel',{version:1,confirmed:true})).statusCode).toBe(403);
   expect((await configure({actions:['projects.write']})).statusCode).toBe(200);token=(await issue()).oneTimeToken!;retain();const p=await create();expect((await machine('/projects/'+p.id+'/export-plan',{version:p.version,kind:'video',settings,startMs:0,durationMs:1000})).statusCode).toBe(403);expect((await machine('/exports/'+randomUUID())).statusCode).toBe(403);
  });
  it('导出提交绑定原计划和应用来源，幂等重试不重复排队',async()=>{
   const p=await create(),job=await enqueue(p),state=states[caseName],replay=await machine('/projects/'+p.id+'/exports',state.exportInput as object,String(state.exportKey));expect(replay.statusCode).toBe(200);expect(replay.json().data.export.id).toBe(job.id);
   const origins=await x.query('SELECT * FROM developer_studio_job_origins WHERE export_id=?',job.id);expect(origins).toHaveLength(1);expect(origins[0]).toMatchObject({app_id:appId,responsible_user_id:F.editorA,credential_id:credentialId});expect(await count('studio_exports','project_id=?',[p.id])).toBe(1);
   expect((await machine('/projects/'+p.id+'/exports',{...(state.exportInput as object),planHash:'0'.repeat(64)})).statusCode).toBe(409);
   const cancelled=await machine('/exports/'+job.id+'/cancel',{version:p.version,confirmed:true});expect(cancelled.statusCode).toBe(200);expect(cancelled.json().data.export.status).toBe('cancelled');
   const after=await machine('/projects/'+p.id+'/exports',state.exportInput as object,String(state.exportKey));expect(after.statusCode).toBe(200);expect(after.json().data.export.status).toBe('cancelled');expect(await count('studio_exports','project_id=?',[p.id])).toBe(1);
  });
  it('应用停用撤销排队任务，重新启用不会恢复旧委托或旧任务',async()=>{
   const p=await create(),job=await enqueue(p);await control(false);expect((await machine()).statusCode).toBe(401);expect((await x.query('SELECT status FROM studio_exports WHERE id=?',job.id))[0].status).toBe('cancelled');
   await control(true);token=(await issue()).oneTimeToken!;retain();expect((await machine()).statusCode).toBe(403);expect(Number((await x.query('SELECT enabled FROM developer_studio_grants WHERE app_id=?',appId))[0].enabled)).toBe(0);expect(await x.render()).toBe(false);
  });
  it('责任人角色往返不复活旧授权，旧确认令牌拒绝，新确认后才可继续',async()=>{
   const body=await grantBody(),dir=await x.app.inject({url:'/api/v1/enterprise/members?workspaceId='+F.workspaceA,headers:admin});expect(dir.statusCode).toBe(200);let version=(dir.json().data.members as {id:string;version:number}[]).find(m=>m.id===F.editorA)!.version;
   await good('/enterprise/members/access',{workspaceId:F.workspaceA,userId:F.editorA,version,role:'viewer',workspaceIds:[F.workspaceA],confirmed:true});version++;
   expect((await machine()).statusCode).toBe(403);
   await good('/enterprise/members/access',{workspaceId:F.workspaceA,userId:F.editorA,version,role:'editor',workspaceIds:[F.workspaceA],confirmed:true});
   expect((await machine()).statusCode).toBe(403);expect((await human('/enterprise/developer-studio/configure',body)).statusCode).toBe(409);
   expect((await configure()).statusCode).toBe(200);token=(await issue()).oneTimeToken!;retain();expect((await machine()).statusCode).toBe(200);
  });
  it('业务失败回滚工程与操作回执，独立机器限频仍计入',async()=>{
   const before=await count('studio_projects'),ops=await count('developer_studio_operations'),rateBefore=await count('developer_rate_windows','credential_id=?',[credentialId]);retain({rollbackProjects:before,rollbackOperations:ops});
   if(dialect==='sqlite')await x.query("CREATE TEMP TRIGGER studio_fault BEFORE INSERT ON developer_studio_operations WHEN NEW.app_id='"+appId+"' BEGIN SELECT RAISE(ABORT,'Synthetic studio receipt failure'); END");
   else await x.query("CREATE FUNCTION studio_fault_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic studio receipt failure'; END $$");
   if(dialect==='postgres')await x.query("CREATE TRIGGER studio_fault BEFORE INSERT ON developer_studio_operations FOR EACH ROW WHEN(NEW.app_id='"+appId+"') EXECUTE FUNCTION studio_fault_fn()");
   const key=randomUUID(),input={name:'合成回滚工程',purpose:'video',confirmed:true};retain({createInput:input,createKey:key});
   try{const r=await machine('/projects',input,key);expect(r.statusCode).toBeGreaterThanOrEqual(500);expect(await count('studio_projects')).toBe(before);expect(await count('developer_studio_operations')).toBe(ops);expect(await count('developer_rate_windows','credential_id=?',[credentialId])).toBeGreaterThanOrEqual(rateBefore);}
   finally{if(dialect==='sqlite')await x.query('DROP TRIGGER studio_fault');else{await x.query('DROP TRIGGER studio_fault ON developer_studio_operations');await x.query('DROP FUNCTION studio_fault_fn()');}}
   const recovered=await machine('/projects',input,key);expect(recovered.statusCode).toBe(200);retain({projectId:recovered.json().data.project.id});expect(await count('studio_projects')).toBe(before+1);
  });
  it('失败请求共享持久限频，服务重启不清除当前窗口',async()=>{
   await x.query('UPDATE developer_rate_windows SET request_count=59 WHERE credential_id=?',credentialId);
   const window=(await x.query('SELECT * FROM developer_rate_windows WHERE credential_id=?',credentialId))[0];
   if(!window)await machine();
   await x.query('UPDATE developer_rate_windows SET request_count=59 WHERE credential_id=?',credentialId);
   expect((await machine('/projects/'+randomUUID())).statusCode).toBe(404);await x.restart();const r=await machine();expect(r.statusCode).toBe(429);expect(r.headers['retry-after']).toBe('60');
  });
  it('操作与导出来源不可更新删除，记录不冒用应用管理员',async()=>{
   const p=await create(),job=await enqueue(p),operation=(await x.query('SELECT * FROM developer_studio_operations WHERE resource_id=?',job.id))[0];expect(operation.responsible_user_id).toBe(F.editorA);
   await expect(x.query('UPDATE developer_studio_operations SET request_id=? WHERE id=?','changed',String(operation.id))).rejects.toThrow();await expect(x.query('DELETE FROM developer_studio_job_origins WHERE export_id=?',job.id)).rejects.toThrow();
   if(x.roleQuery){await expect(x.roleQuery('api','SELECT dg_native_developer_studio_job($1,$2)',[job.id,F.editorA])).rejects.toThrow();const allowed=await x.roleQuery('worker','SELECT dg_native_developer_studio_job($1,$2) allowed',[job.id,F.editorA]) as {allowed:boolean}[];expect(allowed[0].allowed).toBe(true);}
  });
  it('责任人撤权后排队任务在渲染前失败，恢复角色不复活任务',async()=>{
   const p=await create(),job=await enqueue(p),r=await x.app.inject({url:'/api/v1/enterprise/members?workspaceId='+F.workspaceA,headers:admin});expect(r.statusCode).toBe(200);const member=(r.json().data.members as {id:string;version:number}[]).find(m=>m.id===F.editorA)!;
   await good('/enterprise/members/access',{workspaceId:F.workspaceA,userId:F.editorA,version:member.version,role:'viewer',workspaceIds:[F.workspaceA],confirmed:true});
   let status:unknown;
   try{expect(await x.render()).toBe(true);status=(await x.query('SELECT status FROM studio_exports WHERE id=?',job.id))[0].status;expect(status).toBe('failed');expect(await count('studio_export_artifacts','export_id=?',[job.id])).toBe(0);}
   finally{await good('/enterprise/members/access',{workspaceId:F.workspaceA,userId:F.editorA,version:member.version+1,role:'editor',workspaceIds:[F.workspaceA],confirmed:true});}
   expect((await machine()).statusCode).toBe(403);expect(await x.render()).toBe(false);expect((await x.query('SELECT status FROM studio_exports WHERE id=?',job.id))[0].status).toBe(status);
  });
  it('合成过期委托即使签发新凭证仍拒绝，原排队任务取消',async()=>{
   const p=await create(),job=await enqueue(p);await x.query('UPDATE developer_studio_grants SET expires_at=?,version=version+1,updated_at=? WHERE app_id=?','2020-01-01T00:00:00.000Z',new Date().toISOString(),appId);expect((await machine()).statusCode).toBe(401);token=(await issue()).oneTimeToken!;retain();expect((await machine()).statusCode).toBe(403);expect((await x.query('SELECT status FROM studio_exports WHERE id=?',job.id))[0].status).toBe('cancelled');expect(await x.render()).toBe(false);
  });
  it('读取范围收窄自动停用旧委托并取消任务，恢复范围需重新确认',async()=>{
   const p=await create(),job=await enqueue(p);await control(true,['projects.read']);expect((await machine()).statusCode).toBe(401);expect((await x.query('SELECT status FROM studio_exports WHERE id=?',job.id))[0].status).toBe('cancelled');expect((await app()).grant!.enabled).toBe(false);
   await control(true);token=(await issue()).oneTimeToken!;retain();expect((await machine()).statusCode).toBe(403);expect(await x.render()).toBe(false);
  });
  it('本机真实生成一秒视频，机器下载完整字节、Range及HEAD且旧来源失效',async()=>{
   const p=await create(),job=await enqueue(p);await x.render();const response=await machine('/exports/'+job.id);expect(response.statusCode).toBe(200);const completed=response.json().data as StudioExport;retain({completed});expect(completed.status,completed.errorMessage??'Actual local FFmpeg export').toBe('succeeded');
   const artifact=completed.artifacts.find(a=>a.mediaType==='video/mp4')!;expect(artifact).toBeDefined();expect(artifact.url).toBe('/api/open/v1/studio/exports/'+job.id+'/files/'+artifact.id);retain({artifact});
   const url=artifact.url!,headers={authorization:'Bearer '+token},download=await x.app.inject({url,headers});expect(download.statusCode).toBe(200);expect(createHash('sha256').update(download.rawPayload).digest('hex')).toBe(artifact.sha256);expect(download.headers['cache-control']).toBe('private, no-store');
   const range=await x.app.inject({url,headers:{...headers,range:'bytes=5-24'}});expect(range.statusCode).toBe(206);expect(range.rawPayload).toEqual(download.rawPayload.subarray(5,25));
   const before=await count('developer_studio_operations',"app_id=? AND kind='file.download_started'",[appId]),head=await x.app.inject({method:'HEAD',url,headers});expect(head.statusCode).toBe(200);expect(head.rawPayload.length).toBe(0);expect(Number(head.headers['content-length'])).toBe(artifact.size);expect(await count('developer_studio_operations',"app_id=? AND kind='file.download_started'",[appId])).toBe(before);
   expect((await x.app.inject({url,headers:{...headers,range:'bytes=999999999999-'}})).statusCode).toBe(416);expect((await x.app.inject({url,headers:{...headers,range:'bytes=0-2','if-range':'"other"'}})).statusCode).toBe(200);expect((await x.app.inject({url,headers:admin})).statusCode).toBe(401);
   const file=(await x.query('SELECT storage_key FROM studio_export_artifacts WHERE id=?',artifact.id))[0],target=path.join(x.config.dataDir,'objects',String(file.storage_key)),original=fs.readFileSync(target),corrupt=Buffer.from(original);corrupt[corrupt.length-1]^=1;fs.writeFileSync(target,corrupt);
   try{expect((await x.app.inject({url,headers})).statusCode).toBe(409);}finally{fs.writeFileSync(target,original);}
   await x.restart();expect((await x.app.inject({url,headers})).statusCode).toBe(200);
   const doc=structuredClone(p.document);doc.segments[0].text='修改后旧输出无效';expect((await machine('/projects/'+p.id+'/save',{version:p.version,name:p.name,document:doc,confirmed:true})).statusCode).toBe(200);expect((await x.app.inject({url,headers})).statusCode).toBe(409);
  },90000);
  it('文件校验不占用业务事务，校验期间撤回会在传输前重新拒绝',async()=>{
   const p=await create(),job=await enqueue(p);await x.render();const r=await machine('/exports/'+job.id),completed=r.json().data as StudioExport;expect(completed.status,completed.errorMessage??'Actual local FFmpeg export').toBe('succeeded');const artifact=completed.artifacts.find(a=>a.mediaType==='video/mp4')!;retain({completed,artifact});const row=(await x.query('SELECT storage_key FROM studio_export_artifacts WHERE id=?',artifact.id))[0],target=path.resolve(x.config.dataDir,'objects',String(row.storage_key));
   let release!:()=>void,reached!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),arrived=new Promise<void>(resolve=>{reached=resolve;}),open=fs.promises.open.bind(fs.promises);let held=false;
   vi.spyOn(fs.promises,'open').mockImplementation(async(...args:Parameters<typeof fs.promises.open>)=>{const handle=await open(...args);if(!held&&path.resolve(String(args[0]))===target){held=true;reached();await gate;}return handle;});
   const pending=x.app.inject({url:artifact.url!,headers:{authorization:'Bearer '+token}});const download=Promise.resolve(pending);let timer:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([arrived,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Synthetic download gate was not reached')),8000);})]);const disabled=await configure({enabled:false});expect(disabled.statusCode).toBe(200);}finally{clearTimeout(timer);release();}
   expect((await download).statusCode).toBe(401);expect(await count('developer_studio_operations',"app_id=? AND kind='file.download_started'",[appId])).toBe(0);
  },90000);
 });
}
