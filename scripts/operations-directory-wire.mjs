import fs from 'node:fs';
import {createHash} from 'node:crypto';
function replace(file,from,to){const contents=fs.readFileSync(file,'utf8');if(!contents.includes(from))throw new Error('Expected source fragment missing: '+file);fs.writeFileSync(file,contents.replace(from,()=>to));}
replace('packages/enterprise/src/directory-workflows.ts','enterprise_directory_connectors VALUES(?,?,?,?,?,?,?,?,?,?,?,?)','enterprise_directory_connectors VALUES(?,?,?,?,?,?,?,?,?,?,?)');
replace('packages/enterprise/src/directory-workflows.ts','enterprise_directory_users VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)','enterprise_directory_users VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
replace('packages/enterprise/src/scim-profile.ts','draft={...draft,...attributes(raw.value)};draft=canonicalNames(draft);','draft=canonicalNames({...attributes(draft),...attributes(raw.value)});');
replace('packages/enterprise/src/scim-profile.ts',"draft.name={...object(draft.name??{}),...object(raw.value)}","draft.name={...attributes(draft.name??{}),...attributes(raw.value)}");
replace('packages/enterprise/src/scim-profile.ts',"['schemas','id'].includes(k)||query.attributes?['schemas','id'].includes(k)||query.attributes!.includes(k.toLowerCase()):!query.excluded?.includes(k.toLowerCase())","['schemas','id'].includes(k)||(query.attributes?query.attributes.includes(k.toLowerCase()):!query.excluded?.includes(k.toLowerCase()))");
replace('apps/api/src/config.ts','enterpriseIdentityFile?:string;','enterpriseIdentityFile?:string;enterpriseDirectoryFile?:string;');
replace('apps/api/src/config.ts','...(process.env.ENTERPRISE_IDENTITY_CONFIG_FILE?',"...(process.env.ENTERPRISE_DIRECTORY_CONFIG_FILE?{enterpriseDirectoryFile:path.resolve(root,process.env.ENTERPRISE_DIRECTORY_CONFIG_FILE)}:{}),...(process.env.ENTERPRISE_IDENTITY_CONFIG_FILE?");
fs.appendFileSync('.env.example','\n# Private SCIM configuration; bearer token files must stay outside DATA_DIR.\nENTERPRISE_DIRECTORY_CONFIG_FILE=\n');
for(const file of ['apps/api/src/app.ts','apps/api/src/postgres-core-app.ts']){
 const imports="import {DirectoryRuntime} from '../../../packages/enterprise/src/directory-runtime.js';\n"+(file.endsWith('/app.ts')?"import {IdentityWorkflows} from '../../../packages/enterprise/src/identity-workflows.js';\nimport {DirectoryWorkflows} from '../../../packages/enterprise/src/directory-workflows.js';\nimport {SqliteIdentityStore} from './identity-store.js';\nimport {registerDirectoryAdminRoutes,registerScimRoutes} from './directory-routes.js';\n":"");
 fs.writeFileSync(file,imports+fs.readFileSync(file,'utf8'));
 replace(file,'const identityRuntime=new IdentityRuntime(config);','const identityRuntime=new IdentityRuntime(config),directoryRuntime=new DirectoryRuntime(config);');
}
replace('apps/api/src/app.ts',"if (publicPaths.has(pathname)","if (req.routeOptions.url?.startsWith('/api/v1/scim/v2/')) return;\n    if (publicPaths.has(pathname)");
replace('apps/api/src/app.ts','registerIdentityRoutes(app,repo,config,identityRuntime,send);',`registerIdentityRoutes(app,repo,config,identityRuntime,send);
  const directoryStore=new SqliteIdentityStore(repo,id=>{directoryRuntime.rotate(id);}),directoryWorkflow=new DirectoryWorkflows(new IdentityWorkflows(identityRuntime),directoryRuntime);
  registerScimRoutes(app,directoryWorkflow,directoryStore);
  registerDirectoryAdminRoutes(app,directoryWorkflow,directoryStore,(req,write,work)=>{const session=authenticatedSession(repo,req,config);if(write&&req.headers['x-csrf-token']!==session.csrfToken)throw new AppError('FORBIDDEN','安全凭证已失效，请刷新后重试。',403);return work(session.principal);},send);`);
replace('apps/api/src/postgres-core-app.ts','identityRuntime,tokenHash);','identityRuntime,tokenHash,directoryRuntime);');
replace('apps/api/src/postgres-identity-routes.ts',"import {memberDirectoryScope}","import {DirectoryWorkflows} from '../../../packages/enterprise/src/directory-workflows.js';\nimport type {DirectoryRuntime} from '../../../packages/enterprise/src/directory-runtime.js';\nimport {registerDirectoryAdminRoutes,registerScimRoutes} from './directory-routes.js';\nimport {memberDirectoryScope}");
replace('apps/api/src/postgres-identity-routes.ts','tokenHash:(req:FastifyRequest)=>string){','tokenHash:(req:FastifyRequest)=>string,directoryRuntime:DirectoryRuntime){');
replace('apps/api/src/postgres-identity-routes.ts','const members=new MemberWorkflows(workflow);',`const directoryStore=new NativeIdentityStore(repo,id=>{directoryRuntime.rotate(id);}),directoryWorkflow=new DirectoryWorkflows(workflow,directoryRuntime);registerScimRoutes(app,directoryWorkflow,directoryStore);registerDirectoryAdminRoutes(app,directoryWorkflow,directoryStore,(req,write,work)=>scoped(req,write,({principal})=>Promise.resolve(work(principal))),send);
 const members=new MemberWorkflows(workflow);`);
replace('packages/postgres/src/runtime-bootstrap.ts',"await client.query('GRANT SELECT,INSERT ON enterprise_member_events TO '+apiRole);",`await client.query('GRANT SELECT,INSERT ON enterprise_member_events TO '+apiRole);
  await client.query('GRANT SELECT,INSERT,UPDATE ON enterprise_directory_connectors,enterprise_directory_users,enterprise_directory_groups TO '+apiRole);
  await client.query('GRANT SELECT,INSERT,DELETE ON enterprise_directory_group_members TO '+apiRole);
  await client.query('GRANT SELECT,INSERT ON enterprise_directory_events TO '+apiRole);`);
replace('packages/postgres/src/runtime-database.ts',"'134-native-member-business-access.sql'];","'134-native-member-business-access.sql','135-native-enterprise-directory.sql'];");
replace('packages/postgres/src/runtime-database.ts','manifest.version!==131','manifest.version!==132');
const file='migrations/postgres/runtime.json',manifest=JSON.parse(fs.readFileSync(file,'utf8'));if(manifest.version!==131||manifest.migrations.at(-1).name!=='134-native-member-business-access.sql')throw new Error('Unexpected migration boundary');manifest.version=132;manifest.migrations.push({name:'135-native-enterprise-directory.sql',sha256:createHash('sha256').update(fs.readFileSync('migrations/postgres/135-native-enterprise-directory.sql')).digest('hex')});fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({result:'ENTERPRISE_DIRECTORY_WIRED_NOT_TESTED',runtime:132,nextNative:136,nextSqlite:58}));
