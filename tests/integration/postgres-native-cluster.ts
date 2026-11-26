import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createPostgresClient,type PostgresConnectionConfig} from '../../packages/postgres/src/config.js';

// Real native PostgreSQL fixture, not pg-mem/PGlite. Private directory, loopback, no service installation.
export const nativePostgresAvailable=process.platform==='win32'&&fs.existsSync('storage/tools/postgresql/18.7-2/verified.json');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function run(exe:string,args:string[],timeout=60000){
  const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>child.kill(),timeout);
  try{await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Native fixture command failed: '+path.basename(exe)+'; '+output.slice(-2000))));});}finally{clearTimeout(timer);}
}
export async function nativeCluster(){
  if(!nativePostgresAvailable)throw new Error('Run node scripts/postgres-native-setup.mjs before native validation.');
  const parent=path.resolve('storage/postgres-native-tests');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'cluster-')),bin=path.resolve('storage/tools/postgresql/18.7-2/pgsql/bin'),data=path.join(root,'data'),password=randomBytes(32).toString('hex'),passwordFile=path.join(root,'db-password'),cert=path.join(root,'server.crt'),key=path.join(root,'server.key');fs.writeFileSync(passwordFile,password+'\n',{flag:'wx',mode:0o600});
  await run(path.join(bin,'initdb.exe'),['-D',data,'--username=dg_bootstrap','--pwfile='+passwordFile,'--auth-host=scram-sha-256','--auth-local=trust','--encoding=UTF8','--no-locale']);
  await run('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-sha256','-days','1','-nodes','-keyout',key,'-out',cert,'-subj','/CN=private-postgres-validation','-addext','subjectAltName=IP:127.0.0.1']);
  const server=net.createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(r=>server.close(()=>r()));
  fs.appendFileSync(path.join(data,'postgresql.conf'),"\nlisten_addresses='127.0.0.1,::1'\nport="+port+"\nssl=on\nssl_cert_file='"+cert.replaceAll('\\','/')+"'\nssl_key_file='"+key.replaceAll('\\','/')+"'\nlog_statement='none'\nlog_min_error_statement=panic\nlogging_collector=on\nlog_directory='private-logs'\nmax_connections=30\n");
  fs.writeFileSync(path.join(data,'pg_hba.conf'),'hostssl all all 127.0.0.1/32 scram-sha-256\nhostssl all all ::1/128 scram-sha-256\n');
  let wrapper:ChildProcess|undefined;const observedPids:number[]=[],connection:PostgresConnectionConfig={purpose:'offline-staging-only',host:'127.0.0.1',port,database:'dg_staging',user:'dg_loader',passwordFile,tls:{mode:'verify-full',caFile:cert}};
  async function admin(database='postgres'){const client=new pg.Client({host:'127.0.0.1',port,database,user:'dg_bootstrap',password,ssl:{rejectUnauthorized:true,ca:fs.readFileSync(cert,'utf8')},connectionTimeoutMillis:1000});await client.connect();return client;}
  async function start(){
    const id=randomUUID(),marker=path.join(root,'native-'+id+'.json'),cancelFile=path.join(root,'cancel-'+id),input=path.join(root,'job-'+id+'.json');fs.writeFileSync(input,JSON.stringify({executable:path.join(bin,'postgres.exe'),arguments:['-D',data],directory:root,marker,cancelFile}));
    wrapper=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/native-process-job.ps1'),'-ParentProcessId',String(process.pid),'-InputPath',input],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';wrapper.stderr!.on('data',b=>output+=b);
    const deadline=Date.now()+45000;for(;;){if(wrapper.exitCode!==null)throw new Error('Native PostgreSQL exited: '+output.slice(-1000));try{const c=await admin();await c.end();break;}catch{if(Date.now()>deadline)throw new Error('Native PostgreSQL not ready. '+output.slice(-1000));await sleep(100);}}
    if(fs.existsSync(marker))observedPids.push(JSON.parse(fs.readFileSync(marker,'utf8')).pid);observedPids.push(wrapper.pid!);
  }
  async function stop(){if(!wrapper)return;const current=wrapper;try{await run(path.join(bin,'pg_ctl.exe'),['-D',data,'stop','-m','fast','-w','-t','30'],40000);}finally{if(current.exitCode===null)await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>{current.kill();reject(new Error('Native PostgreSQL wrapper failed to close.'));},10000);current.once('exit',()=>{clearTimeout(timeout);resolve();});});wrapper=undefined;}}
  try{await start();const c=await admin();try{await c.query("CREATE ROLE dg_loader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+password+"'");await c.query('CREATE DATABASE dg_staging OWNER dg_loader TEMPLATE template0 ENCODING \'UTF8\'');}finally{await c.end();}}catch(e){await stop();throw e;}
  fs.writeFileSync(path.join(root,'connection.json'),JSON.stringify(connection));
  return{root,data,port,connection,observedPids,start,stop,admin,client:async()=>{const c=createPostgresClient(connection);await c.connect();return c;},connectionFile:path.join(root,'connection.json')};
}
