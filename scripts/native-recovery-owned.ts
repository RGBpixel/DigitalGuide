import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createPostgresClient,loadConnectionConfig,type PostgresConnectionConfig} from '../packages/postgres/src/config.js';
import {within} from '../packages/recovery/src/files.js';
import {proofBounded,proofPause} from './postgres-content-proof-runtime.js';

export function assertRecoveryClosure(root:string,auditFile:string){
 const read=(f:string)=>JSON.parse(fs.readFileSync(f,'utf8')),audit=read(auditFile),input=read(audit.inputFile);
 assert.equal(audit.result,'PASS_STRICT_NATIVE_RECOVERY_PROCESS_CLOSURE');assert.equal(audit.privateProcesses,0);assert.equal(audit.privateListeners,0);assert.ok(Date.now()-Date.parse(audit.checkedAt)<120000,'A fresh independent closure audit is required');
 assert.equal(createHash('sha256').update(fs.readFileSync(audit.inputFile)).digest('hex'),audit.inputSHA256);assert.ok(input.roots.some((r:string)=>path.resolve(r)===path.resolve(root)));assert.ok(within(root,path.resolve('storage/postgres-native-tests')));assert.match(path.basename(root),/^cluster-[a-zA-Z0-9]+$/);assert.equal(fs.existsSync(path.join(root,'data/postmaster.pid')),false,'Retain and inspect an unexpected stale marker');
}
export interface OwnedRecoveryServer {root:string;connection:PostgresConnectionConfig;child:ChildProcess;stop():Promise<void>;restart():Promise<OwnedRecoveryServer>}
export async function resumeRecoveryCluster(root:string,auditFile:string):Promise<OwnedRecoveryServer>{
 assertRecoveryClosure(root,auditFile);return launchOwnedRecoveryCluster(root);
}
async function launchOwnedRecoveryCluster(root:string):Promise<OwnedRecoveryServer>{
 assert.equal(fs.existsSync(path.join(root,'data/postmaster.pid')),false);const bin=path.resolve('storage/tools/postgresql/18.7-2/pgsql/bin'),id=randomUUID(),input=path.join(root,'recovery-resume-job-'+id+'.json'),marker=path.join(root,'recovery-resume-native-'+id+'.json');fs.writeFileSync(input,JSON.stringify({executable:path.join(bin,'postgres.exe'),arguments:['-D',path.join(root,'data')],directory:root,marker,cancelFile:path.join(root,'recovery-resume-cancel-'+id)}),{flag:'wx'});
 const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/native-process-job.ps1'),'-ParentProcessId',String(process.pid),'-InputPath',input],{windowsHide:true,stdio:'ignore'}),closed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}),connection=loadConnectionConfig(path.join(root,'connection.json'));
 async function stop(){if(child.exitCode===null){const ctl=spawn(path.join(bin,'pg_ctl.exe'),['-D',path.join(root,'data'),'stop','-m','fast','-w','-t','30'],{windowsHide:true,stdio:'ignore'});assert.equal(await proofBounded(new Promise<number|null>((resolve,reject)=>{ctl.once('error',reject);ctl.once('close',resolve);}),40000,'Retained PostgreSQL stop timeout'),0);}await proofBounded(closed,15000,'Retained supervisor did not close');}
 async function restart():Promise<OwnedRecoveryServer>{await stop();return launchOwnedRecoveryCluster(root);}
 try{const until=Date.now()+45000;for(;;){assert.equal(child.exitCode,null,'Owned supervisor exited');const c=createPostgresClient(connection);try{await c.connect();await c.end();break;}catch{await c.end();if(Date.now()>until)throw new Error('Retained PostgreSQL not ready');await proofPause(100);}}assert.equal(JSON.parse(fs.readFileSync(marker,'utf8')).jobObject,true);return{root,connection,child,stop,restart};}catch(error){await stop();throw error;}
}
export async function observeRecoveryClusters(output:string,roots:number[],port:number){
 const input=output.replace(/\.json$/,'-roots.json');fs.writeFileSync(input,JSON.stringify(roots),{flag:'wx'});const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/postgres-media-process-audit.ps1'),'-Mode','observe','-InputPath',path.resolve(input),'-OutputPath',path.resolve(output),'-Port',String(port)],{windowsHide:true,stdio:'ignore'});assert.equal(await proofBounded(new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}),60000,'Recovery process observation timeout'),0);
}
