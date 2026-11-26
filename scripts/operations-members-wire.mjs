import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
function edit(file,fn){const old=fs.readFileSync(file,'utf8'),next=fn(old);assert.notEqual(old,next,file);fs.writeFileSync(file,next);}
function replace(s,a,b){assert.ok(s.includes(a),a.slice(0,130));return s.replace(a,()=>b);}
edit('apps/api/src/identity-store.ts',s=>replace(s,"else if(operation.kind==='now')", "else if(operation.kind==='provisionUser'){this.repo.run('INSERT INTO users VALUES(?,?)',operation.userId,operation.name);this.repo.run('INSERT INTO memberships VALUES(?,?,?,?)',operation.userId,operation.tenantId,'viewer','[]');}else if(operation.kind==='now')"));
edit('packages/postgres/src/runtime-identity-store.ts',s=>replace(s,"else if(operation.kind==='now')", "else if(operation.kind==='provisionUser')await this.core.db.query('SELECT dg_native_identity_create_user($1,$2,$3,$4)',[operation.actorId,operation.userId,operation.tenantId,operation.name]);else if(operation.kind==='now')"));
// Every application directory must read the same scoped role and workspace projection.
const sqlFiles={
 'packages/enterprise/src/identity-workflows.ts':'effectiveMemberships(this.runtime.host.providerMode,this.runtime.host.appEnv)',
 'apps/api/src/advertising-access.ts':'this.repo.membershipsSql()',
 'apps/api/src/enterprise-plan-service.ts':'this.repo.membershipsSql()',
 'apps/api/src/courses.ts':'this.repo.membershipsSql()',
 'apps/api/src/office-routes.ts':'repo.membershipsSql()',
 'apps/api/src/studio-review-service.ts':'this.repo.membershipsSql()',
 'apps/api/src/restaurant-routes.ts':'repo.membershipsSql()',
 'apps/api/src/app.ts':'repo.membershipsSql()',
 'packages/postgres/src/runtime-enterprise-plans.ts':"effectiveMemberships('mock',this.db.config.appEnv)",
 'packages/postgres/src/runtime-team-reviews.ts':"effectiveMemberships('mock',this.db.config.appEnv)",
 'apps/api/src/postgres-office-routes.ts':"effectiveMemberships('mock',repo.db.config.appEnv)",
 'apps/api/src/postgres-core-app.ts':"effectiveMemberships('mock',native.appEnv)"
};
for(const[file,expression]of Object.entries(sqlFiles))edit(file,s=>{
 let count=0;s=s.replace(/(['"])(SELECT [^\r\n]*?)\1/g,(all,quote,sql)=>{if(!/(?:FROM|JOIN) memberships m/.test(sql))return all;count++;return '`'+sql.replaceAll('FROM memberships m','FROM ${'+expression+'} m').replaceAll('JOIN memberships m','JOIN ${'+expression+'} m')+'`';});assert.ok(count,file);
 if(expression.includes('effectiveMemberships')&&!s.includes("import {effectiveMemberships}"))s="import {effectiveMemberships} from '"+(file.startsWith('packages/postgres/')?'../../enterprise/src/membership-sql.js':'../../../packages/enterprise/src/membership-sql.js')+"';\n"+s;
 return s;
});
edit('apps/api/src/identity-routes.ts',s=>"import {registerMemberRoutes} from './member-routes.js';\n"+replace(s,"const store=new SqliteIdentityStore(repo)","registerMemberRoutes(app,repo,config,runtime,send);const store=new SqliteIdentityStore(repo)"));
edit('apps/api/src/postgres-identity-routes.ts',s=>{
 s="import {memberDirectoryScope} from '../../../packages/contracts/src/member-directory.js';\nimport {MemberWorkflows} from '../../../packages/enterprise/src/member-workflows.js';\nimport {memberMutation} from './member-routes.js';\n"+s;
 return replace(s," app.get('/api/v1/enterprise/identity'", " const members=new MemberWorkflows(workflow);\n app.get('/api/v1/enterprise/members',async(req,reply)=>send(req,reply,await scoped(req,false,async({principal})=>store.run(members.view(principal,memberDirectoryScope.parse(req.query))))));\n for(const action of ['create','access'] as const)app.post('/api/v1/enterprise/members/'+action,async(req,reply)=>{const input=memberMutation(action,req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);return send(req,reply,await scoped(req,true,async({principal})=>store.run(members.mutation(principal,input,key))));});\n app.get('/api/v1/enterprise/identity'");
});
edit('packages/postgres/src/runtime-bootstrap.ts',s=>replace(s,"  await client.query('GRANT SELECT,INSERT,UPDATE ON enterprise_identity_providers", "  await client.query('GRANT SELECT,INSERT,UPDATE ON enterprise_member_directory TO '+apiRole);\n  await client.query('GRANT SELECT,INSERT ON enterprise_member_events TO '+apiRole);\n  await client.query('GRANT EXECUTE ON FUNCTION dg_native_identity_create_user(text,text,text,text) TO '+apiRole);\n  await client.query('GRANT SELECT ON enterprise_member_directory TO '+identifier(input.worker.user));\n  await client.query('GRANT SELECT,INSERT,UPDATE ON enterprise_identity_providers"));
edit('packages/contracts/src/index.ts',s=>"export * from './member-directory.js';\n"+s);
edit('packages/postgres/src/runtime-database.ts',s=>replace(replace(s,"'132-native-enterprise-identity.sql']","'132-native-enterprise-identity.sql','133-native-enterprise-member-directory.sql']"),'manifest.version!==129','manifest.version!==130'));
edit('tests/unit/postgres-runtime.test.ts',s=>replace(s,"'132-native-enterprise-identity.sql']","'132-native-enterprise-identity.sql','133-native-enterprise-member-directory.sql']"));
const file='migrations/postgres/runtime.json',manifest=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(manifest.version,129);manifest.version=130;manifest.migrations.push({name:'133-native-enterprise-member-directory.sql',sha256:createHash('sha256').update(fs.readFileSync('migrations/postgres/133-native-enterprise-member-directory.sql')).digest('hex')});fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log('Member directory routes, authorization projections and append-only migration registration wired.');
