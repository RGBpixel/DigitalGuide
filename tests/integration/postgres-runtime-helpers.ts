import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {nativeCluster} from './postgres-native-cluster.js';
import {createNativeValidationRuntime} from '../../packages/postgres/src/runtime-bootstrap.js';
import {NativePostgresDatabase} from '../../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../../packages/postgres/src/runtime-repository.js';
import {createApp} from '../../apps/api/src/app.js';
import type {Config} from '../../apps/api/src/config.js';

export async function nativeRuntimeFixture(options:{onInitialized?:(result:Awaited<ReturnType<typeof createNativeValidationRuntime>>,cluster:Awaited<ReturnType<typeof nativeCluster>>)=>Promise<void>|void}={}){
 const cluster=await nativeCluster();let openedApp:Awaited<ReturnType<typeof createApp>>|undefined,openedWorker:NativePostgresDatabase|undefined;try{const apiPassword=randomBytes(32).toString('hex'),workerPassword=randomBytes(32).toString('hex'),apiPasswordFile=path.join(cluster.root,'api-password'),workerPasswordFile=path.join(cluster.root,'worker-password');fs.writeFileSync(apiPasswordFile,apiPassword);fs.writeFileSync(workerPasswordFile,workerPassword);const admin=await cluster.admin();try{for(const[role,pw]of [['dg_native_api',apiPassword],['dg_native_worker',workerPassword]])await admin.query("CREATE ROLE "+role+" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+pw+"'");}finally{await admin.end();}
 const application={...cluster.connection,user:'dg_native_api',passwordFile:apiPasswordFile},worker={...cluster.connection,user:'dg_native_worker',passwordFile:workerPasswordFile};fs.writeFileSync(path.join(cluster.root,'application-connection.json'),JSON.stringify(application));fs.writeFileSync(path.join(cluster.root,'worker-connection.json'),JSON.stringify(worker));
 const result=await createNativeValidationRuntime({loader:cluster.connection,application,worker,schema:'dg_validation_'+randomUUID().replaceAll('-',''),dataDir:path.join(cluster.root,'native-data'),appEnv:'development',seedSyntheticIdentities:true});
 await options.onInitialized?.(result,cluster);
 const config:Config={root:process.cwd(),dataDir:result.api.dataDir,appEnv:'development',providerMode:'mock',apiPort:4309,webOrigin:'http://127.0.0.1:5179',sessionSecret:fs.readFileSync(path.join(result.api.dataDir,'.session-secret'),'utf8').trim(),nativePostgres:result.api};
 const app=await createApp(config);openedApp=app;const workerDb=await NativePostgresDatabase.open(result.worker,'worker');openedWorker=workerDb;const repo=new NativeCoreRepository(workerDb);
 async function login(accountId='30000000-0000-4000-8000-000000000001',target=app){const response=await target.inject({method:'POST',url:'/api/v1/auth/login',payload:{accountId}});if(response.statusCode!==200)throw new Error('Native fixture login failed: '+response.payload);const cookie=response.cookies.find(c=>c.name.startsWith('dg_native_session_'))!,rawCookie=cookie.name+'='+encodeURIComponent(cookie.value),me=await target.inject({url:'/api/v1/me',headers:{cookie:rawCookie}});if(me.statusCode!==200)throw new Error('Native fixture me failed: '+me.payload);return{cookie:rawCookie,'x-csrf-token':me.json().data.csrfToken as string};}
 const owner=async<T>(work:(client:Awaited<ReturnType<typeof cluster.client>>)=>Promise<T>)=>{const client=await cluster.client();try{await client.query('SET search_path TO "'+result.schema+'",pg_catalog,pg_temp');return await work(client);}finally{await client.end();}};
 return{cluster,result,config,app,repo,workerDb,login,owner,close:async()=>{await app.close();await workerDb.close();await cluster.stop();fs.writeFileSync(path.join(cluster.root,'native-runtime-closure.json'),JSON.stringify({result:'PASS',observedPids:cluster.observedPids,port:cluster.port}));}};
 }catch(error){await openedApp?.close();await openedWorker?.close();await cluster.stop();throw error;}
}
