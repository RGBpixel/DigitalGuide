import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Repository} from '@digitalguide/database';
import {AppError} from '@digitalguide/domain';
import {ContentGovernance} from '../../api/src/content-governance.js';
import {parsedPolicy,type GovernanceDeliveryRow} from '../../api/src/governance-gate.js';
import type {Config} from '../../api/src/config.js';
import {fileDigest,ownedFile} from '../../../packages/media/src/files.js';
import {runGovernanceRender} from '../../../packages/media/src/run-governance-render.js';
const now=()=>new Date().toISOString(),until=()=>new Date(Date.now()+90000).toISOString();
export async function runGovernanceDelivery(repo:Repository,config:Config,stopSignal:AbortSignal=new AbortController().signal){
 if(stopSignal.aborted)return false;const s=new ContentGovernance(repo,config),token=randomUUID(),row=repo.transaction(()=>{
  repo.run('UPDATE content_governance_deliveries SET status=\'failed\',error_message=\'制作恢复次数已用完，请新建记录。\',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE environment=? AND app_env=? AND status=\'rendering\' AND lease_until<=? AND attempts>=3',now(),config.providerMode,config.appEnv,now());
  const r=repo.get<GovernanceDeliveryRow>('SELECT * FROM content_governance_deliveries WHERE environment=? AND app_env=? AND (status=\'queued\' OR (status=\'rendering\' AND lease_until<=? AND attempts<3)) ORDER BY rowid LIMIT 1',config.providerMode,config.appEnv,now());if(!r)return null;repo.run('UPDATE content_governance_deliveries SET status=\'rendering\',lease_token=?,lease_until=?,attempts=attempts+1,progress=5,error_message=NULL,version=version+1,updated_at=? WHERE id=?',token,until(),now(),r.id);return r;
 });if(!row)return false;
 const abort=new AbortController(),signal=AbortSignal.any([abort.signal,stopSignal]),workRoot=path.resolve(config.dataDir,'governance-work'),directory=ownedFile(workRoot,row.id+'-'+token),written:string[]=[];let committed=false;
 const guard=()=>{const r=s.row(s.workerPrincipal(row),row.id);if(r.lease_token!==token||r.status!=='rendering')throw new AppError('GOVERNANCE_LEASE_LOST','任务已取消或由其他进程接管。',409);return{row:r,...s.current(s.workerPrincipal(row),r)};};
 const heartbeat=setInterval(()=>{try{repo.transaction(()=>{guard();repo.run('UPDATE content_governance_deliveries SET lease_until=? WHERE id=? AND lease_token=?',until(),row.id,token);});}catch{abort.abort();}},2000);
 try{
  const current=repo.transaction(guard),definition=parsedPolicy(s.policy(s.workerPrincipal(row),row.policy_id));fs.mkdirSync(directory,{recursive:true});
  const inputs:Record<string,string>={};for(const kind of ['video','cover']){const source=current.base.files.find(f=>f.kind===kind)!,copy=path.join(directory,kind==='video'?'source.mp4':'source.png');fs.copyFileSync(source.file,copy,fs.constants.COPYFILE_EXCL);const bytes=await fileDigest(copy,signal);if(bytes.sha256!==source.sha256||bytes.size!==source.size)throw new AppError('GOVERNANCE_SOURCE_BYTES','原视频或封面字节已变化，请重新导出并审核。',409);inputs[kind]=copy;}
  const rendered=await runGovernanceRender({root:config.root,directory,video:inputs.video,cover:inputs.cover,label:current.plan.label,position:definition.labelPosition,labelCover:definition.labelCover,publicId:row.public_id,planHash:row.plan_hash,width:current.plan.width!,height:current.plan.height!,durationMs:current.plan.durationMs!},signal);
  signal.throwIfAborted();repo.transaction(guard);const artifacts:{id:string;kind:'video'|'cover';key:string;mediaType:string;size:number;sha256:string}[]=[];
  for(const kind of ['video','cover'] as const){const file=rendered[kind],actual=await fileDigest(file,signal),key=randomUUID()+(kind==='video'?'.mp4':'.png'),destination=ownedFile(path.join(config.dataDir,'objects'),key);fs.copyFileSync(file,destination,fs.constants.COPYFILE_EXCL);written.push(destination);artifacts.push({id:randomUUID(),kind,key,mediaType:kind==='video'?'video/mp4':'image/png',...actual});}
  repo.transaction(()=>{signal.throwIfAborted();guard();repo.run('DELETE FROM content_governance_artifacts WHERE delivery_id=?',row.id);for(const a of artifacts)repo.run('INSERT INTO content_governance_artifacts VALUES (?,?,?,?,?,?,?,?)',a.id,row.id,a.kind,a.kind==='video'?'video.mp4':'cover.png',a.mediaType,a.key,a.size,a.sha256);repo.run('UPDATE content_governance_deliveries SET status=\'ready\',progress=100,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=?',now(),row.id,token);});committed=true;
 }catch(e){repo.transaction(()=>{repo.run('UPDATE content_governance_deliveries SET status=?,error_message=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND status=\'rendering\' AND lease_token=?',stopSignal.aborted?'queued':'failed',stopSignal.aborted?'本地进程停止，重启后继续未提交任务。':e instanceof AppError?e.message:signal.aborted?'任务已取消或权限变化，未提交文件。':e instanceof Error?e.message:'标识制作失败，请检查媒体和规则。',now(),row.id,token);});}
 finally{clearInterval(heartbeat);abort.abort();if(!committed)for(const f of written)fs.rmSync(f,{force:true});if(directory.startsWith(workRoot+path.sep))fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:150});}
 return true;
}
