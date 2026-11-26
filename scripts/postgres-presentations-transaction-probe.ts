import {randomUUID} from 'node:crypto';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativePresentations} from '../packages/postgres/src/runtime-presentations.js';
const root=process.argv[3],mode=process.argv[4],target=process.argv[5],db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(process.argv[2]),'api',root),repo=new NativeCoreRepository(db),s=new NativePresentations(repo,root),key=randomUUID();
if(!['plan','apply','question'].includes(mode))throw new Error('Unknown presentation probe');
try{await db.transaction(async()=>{
 const p=await repo.principal('30000000-0000-4000-8000-000000000001');await db.query("SELECT set_config('digitalguide.actor_id',$1,true)",[p.userId]);const oldEvents=(await db.query<{id:string}>("SELECT id FROM outbox_events WHERE type='presentation.changed'",[])).rows.map(r=>r.id);
 const id=await repo.idempotentResource(p,{action:'actual-presentation-'+mode+'-transaction-probe',key,body:{mode,target},code:200},async()=>{
  let id:string,workspace:string;
  if(mode==='plan'){await s.studio.scope(p,target,true);const project=await s.studio.project(p,target);id=await s.create(p,{projectId:target,projectVersion:project.version,name:'未提交的原生逐页方案',confirmed:true});workspace=project.workspace_id;}
  else if(mode==='apply'){const plan=await s.plan(p,target,true);id=await s.apply(p,plan,{version:plan.version,name:'未提交的独立逐页工程',confirmed:true,newProjectConfirmed:true,rebuildTimelineConfirmed:true});workspace=plan.workspace_id;}
  else{const session=await s.session(p,target,true,true);await s.liveSource(p,session);const current=await s.viewSession(p,session);id=await s.ask(p,session,{version:session.version,observedPageId:current.currentPageId,body:'强杀前未提交的虚构问题',confirmed:true});workspace=session.workspace_id;}
  await repo.audit(p,workspace,'presentation.transaction_probe_'+mode,id,key);await repo.event(p.tenantId,workspace,id,'presentation.changed');return id;
 });
 const auditIds=(await db.query<{id:string}>('SELECT id FROM audit_events WHERE request_id=$1',[key])).rows.map(r=>r.id),eventIds=(await db.query<{id:string}>("SELECT id FROM outbox_events WHERE type='presentation.changed' AND id<>ALL($1::text[])",[oldEvents])).rows.map(r=>r.id),question=mode==='question'?(await db.query<{active_question_id:string;position_ms:string;version:string}>('SELECT active_question_id,position_ms,version FROM studio_presentation_sessions WHERE id=$1',[id])).rows[0]:null;
 const business=mode==='plan'?[['studio_presentation_plans','id'],['studio_presentation_plan_versions','plan_id']]:mode==='apply'?[['studio_projects','id'],['studio_project_versions','project_id'],['studio_presentation_applications','project_id']]:[['studio_presentation_questions','session_id']];const counts:Record<string,number>={};for(const[table,column]of business)counts[table]=(await db.query<{n:number}>('SELECT count(*)::int AS n FROM '+table+' WHERE '+column+'=$1',[id])).rows[0].n;counts.audit_events=auditIds.length;counts.outbox_events=eventIds.length;counts.idempotency=(await db.query<{n:number}>('SELECT count(*)::int AS n FROM idempotency WHERE key=$1',[key])).rows[0].n;if(Object.values(counts).some(n=>n<1))throw new Error('Actual presentation writes were not all staged');
 console.log(JSON.stringify({phase:'native_presentation_staged',mode,resourceId:id,target,key,auditIds,eventIds,questionId:question?.active_question_id??null,positionMs:question?Number(question.position_ms):null,sessionVersion:question?Number(question.version):null,counts}));
 await new Promise<void>(()=>{/* The parent actually SIGKILLs this open transaction before COMMIT. */});
});}finally{await db.close();}
