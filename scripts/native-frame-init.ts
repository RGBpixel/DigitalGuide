import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {nativeCluster} from '../tests/integration/postgres-native-cluster.js';
import {createNativeValidationRuntime} from '../packages/postgres/src/runtime-bootstrap.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
const root='docs/evidence/T20/postgres-frame-reviews',file='migrations/postgres/035-native-frame-reviews.sql',label=process.argv[2]??'first',cluster=await nativeCluster();let error:unknown,committed=false,apiVerified=false,closed=false;
try{
 const passwords=[randomBytes(32).toString('hex'),randomBytes(32).toString('hex')],files=['api-password','worker-password'].map(n=>path.join(cluster.root,n));for(let i=0;i<2;i++)fs.writeFileSync(files[i],passwords[i],{flag:'wx'});
 const admin=await cluster.admin();try{for(const[i,role]of ['dg_native_api','dg_native_worker'].entries())await admin.query("CREATE ROLE "+role+" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+passwords[i]+"'");}finally{await admin.end();}
 const result=await createNativeValidationRuntime({loader:cluster.connection,application:{...cluster.connection,user:'dg_native_api',passwordFile:files[0]},worker:{...cluster.connection,user:'dg_native_worker',passwordFile:files[1]},schema:'dg_validation_'+randomUUID().replaceAll('-',''),dataDir:path.join(cluster.root,'native-data'),appEnv:'development',seedSyntheticIdentities:true});committed=true;
 fs.writeFileSync(root+'/first-applied-035.json',JSON.stringify({result:'MIGRATIONS_COMMITTED_API_CHECK_PENDING',checkedAt:new Date().toISOString(),file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),runtimeVersion:32,nextPostgresMigration:'036',privateRoot:cluster.root,schema:result.schema,appliedSqlFrozen:true,mainTouched:false},null,2)+'\n',{flag:'wx'});
 for(const[role,config]of [['api',result.api],['worker',result.worker]]as const){const db=await NativePostgresDatabase.open(config,role);await db.close();}apiVerified=true;
}catch(e){error=e;}
finally{try{await cluster.stop();closed=true;}catch(e){error??=e;}}
fs.writeFileSync(root+'/init-'+label+'.json',JSON.stringify({result:error?'FAIL':'PASS',error:error instanceof Error?error.stack:null,migrationsCommitted:committed,apiAndWorkerCatalogVerified:apiVerified,privateFixtureClosed:closed,mainTouched:false},null,2)+'\n',{flag:'wx'});if(error)throw error;console.log(JSON.stringify({result:'PASS',migrationsCommitted:committed,apiAndWorkerCatalogVerified:apiVerified,privateFixtureClosed:closed}));
