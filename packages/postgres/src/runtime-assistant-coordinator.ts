import {AppError} from '../../domain/src/index.js';
import {systemSpeechVoices} from '../../providers/src/index.js';
import {NativeStudioAssistant} from './runtime-assistant.js';
import {assistantGenerationRow,type NativeAssistantGeneration} from './runtime-assistant-state.js';
import type {NativeCoreRepository} from './runtime-repository.js';

// The API control plane advances reviewed work copies. Compute still belongs to
// the independent speech/media/model workers, with their original output guards.
export class NativeAssistantCoordinator {
 readonly service:NativeStudioAssistant;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd()){this.service=new NativeStudioAssistant(core,root);}
 async runOne(){
  const queued=await this.core.db.transaction(async()=>(await this.core.db.query<NativeAssistantGeneration>("SELECT g.* FROM studio_assistant_generations g JOIN studio_assistant_sessions s ON s.id=g.session_id WHERE s.environment='mock' AND s.app_env=$1 AND g.status IN('queued','speech','video') ORDER BY g.updated_at,g.id LIMIT 20",[this.core.db.config.appEnv])).rows.map(assistantGenerationRow));if(!queued.length)return false;
  let voices:Awaited<ReturnType<typeof systemSpeechVoices>>=[];if(queued.some(r=>r.status==='queued'&&JSON.parse(r.plan).settings.speech))try{voices=await systemSpeechVoices(this.root);}catch(e){if(!(e instanceof AppError))throw e;}
  for(const pending of queued){
   try{
    const advanced=await this.core.db.transaction(async()=>{if(!(await this.core.db.query<{ok:boolean}>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok',['native-assistant-generation:'+pending.id])).rows[0].ok)return false;
     const initial=(await this.core.db.query<{session_id:string}>('SELECT session_id FROM studio_assistant_generations WHERE id=$1',[pending.id])).rows[0],scope=(await this.core.db.query<{actor_id:string}>('SELECT actor_id FROM studio_assistant_sessions WHERE id=$1',[initial.session_id])).rows[0],actor=await this.core.principal(pending.actor_id);await this.core.db.query("SELECT set_config('digitalguide.actor_id',$1,true)",[actor.userId]);await this.core.db.query('SELECT user_id FROM dg_native_locked_membership($1)',[scope.actor_id]);const row=await this.service.generation(actor,pending.id,true);return this.service.advance(actor,row,voices);
    });if(advanced)return true;
   }catch(e){
    await this.core.db.transaction(async()=>{await this.core.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['native-assistant-generation:'+pending.id]);const row=(await this.core.db.query<NativeAssistantGeneration>("SELECT * FROM studio_assistant_generations WHERE id=$1 AND status IN('queued','speech','video') FOR UPDATE",[pending.id])).rows[0];if(!row)return;await this.core.db.query('SELECT dg_native_assistant_cancel_children($1)',[row.id]);await this.core.db.query("UPDATE studio_assistant_generations SET status='failed',version=version+1,error_code=$1,error_message=$2,updated_at=dg_utc_now() WHERE id=$3",[e instanceof AppError?e.code:'ASSISTANT_GENERATION_FAILED',e instanceof AppError?e.message:'局部生成协调中断，请检查原任务及服务日志。',row.id]);});return true;
   }
  }return false;
 }
}
