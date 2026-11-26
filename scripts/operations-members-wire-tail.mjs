import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
function edit(file,fn){const old=fs.readFileSync(file,'utf8'),next=fn(old);assert.notEqual(old,next,file);fs.writeFileSync(file,next);}
function replace(s,a,b){assert.ok(s.includes(a),a.slice(0,130));return s.replace(a,()=>b);}
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

