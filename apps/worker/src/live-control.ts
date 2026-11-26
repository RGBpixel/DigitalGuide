import {outputAttachment} from '../../api/src/live-output-state.js';
import {LiveOutputs} from '../../api/src/live-output-service.js';
import type {Repository} from '@digitalguide/database';
import {AppError} from '@digitalguide/domain';
import {selectStreamingProvider} from '@digitalguide/providers';
import {LiveService,type LiveSessionRow,type LiveTargetRow,type LiveEventRow} from '../../api/src/live-service.js';
import type {Config} from '../../api/src/config.js';
export async function tickLiveSessions(repo:Repository,config:Config){
 const service=new LiveService(repo,config),rows=repo.all<LiveSessionRow>('SELECT * FROM live_sessions WHERE environment=? AND app_env=? AND status IN (\'scheduled\',\'preview\',\'live\') ORDER BY rowid LIMIT 30',config.providerMode,config.appEnv);
 for(const initial of rows){
  try{
   if(initial.status==='scheduled'&&initial.scheduled_at&&Date.parse(initial.scheduled_at)<=Date.now()){
    const p=service.actor(initial),checked=await service.checkedSession(p,initial);repo.transaction(()=>{const r=service.session(p,initial.id);if(r.status==='scheduled')service.start(p,r,r.version,checked);});
   }
   repo.transaction(()=>{
    const p=service.actor(initial),r=service.session(p,initial.id);if(!['live','preview'].includes(r.status))return;const snapshot=service.current(p,r),state=service.advance(r),output=outputAttachment(repo,r.id);if(output)new LiveOutputs(service).current(p,output);
    if(state.answerId){const question=repo.get<LiveEventRow>('SELECT * FROM live_audience_events WHERE id=?',state.answerId);if(question)service.answerSources(p,r,question);}
    if(state.stopped)service.finish(r,state);else service.saveClock(r,state);
    if(!outputAttachment(repo,r.id)){repo.run('UPDATE live_commands SET status=\'superseded\' WHERE session_id=? AND status=\'pending\' AND epoch<>?',r.id,state.epoch);
    repo.run('UPDATE live_commands SET simulator_applied_at=?,status=\'applied\' WHERE session_id=? AND status=\'pending\' AND epoch=?',new Date().toISOString(),r.id,state.epoch);}
    if(r.kind==='preview'||state.stopped)return;const adapter=selectStreamingProvider(config.providerMode,config.appEnv);
    for(const target of repo.all<LiveTargetRow>('SELECT * FROM live_destinations WHERE session_id=?',r.id)){
     if(target.status==='connecting'){
      const d=snapshot.definition.destinations.find(d=>d.id===target.definition_id)!,result=adapter.connect({targetId:target.id,operationId:target.operation_id!,attempt:target.attempts,behavior:d.behavior});if(!result.simulated||result.remotePlaybackVerified||result.operationId!==target.operation_id)throw new AppError('LIVE_RECEIPT_INVALID','模拟分发回执不符合当前操作。',409);
      repo.run('UPDATE live_destinations SET status=?,remote_id=?,heartbeat_at=?,error_message=?,version=version+1,updated_at=? WHERE id=? AND operation_id=? AND status=\'connecting\'',result.status,result.remoteId,result.status==='connected'?new Date().toISOString():null,result.errorMessage,new Date().toISOString(),target.id,target.operation_id);
     }else if(target.status==='connected'&&(!target.heartbeat_at||Date.now()-Date.parse(target.heartbeat_at)>=2000))repo.run('UPDATE live_destinations SET heartbeat_at=?,updated_at=? WHERE id=?',new Date().toISOString(),new Date().toISOString(),target.id);
    }
   });
  }catch(error){
   repo.transaction(()=>{const r=repo.get<LiveSessionRow>('SELECT * FROM live_sessions WHERE id=?',initial.id);if(!r||!['scheduled','preview','live'].includes(r.status))return;try{const s=service.advance(r);service.finish(r,s,'failed',error instanceof AppError?error.message:'本地播出控制失败，请核对节目或重新预检。');}catch{repo.run('UPDATE live_sessions SET status=\'failed\',error_message=?,ended_at=?,version=version+1 WHERE id=?','播出状态无法安全恢复，请核对原记录后新建场次。',new Date().toISOString(),r.id);repo.run('UPDATE live_destinations SET status=\'stopped\',version=version+1 WHERE session_id=?',r.id);}});
  }
 }
 return rows.length;
}
