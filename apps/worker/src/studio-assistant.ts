import type {Repository} from '@digitalguide/database';
import type {Config} from '../../api/src/config.js';
import {StudioAssistantService} from '../../api/src/studio-assistant-service.js';
import type {AssistantGenerationRow,AssistantSessionRow} from '../../api/src/studio-assistant-state.js';
export async function tickStudioAssistant(repo:Repository,config:Config,signal=new AbortController().signal){
 if(signal.aborted)return 0;const service=new StudioAssistantService(repo,config),rows=repo.all<AssistantGenerationRow>("SELECT g.* FROM studio_assistant_generations g JOIN studio_assistant_sessions s ON s.id=g.session_id WHERE s.environment=? AND s.app_env=? AND g.status IN ('queued','speech','video') ORDER BY g.created_at,g.id LIMIT 20",config.providerMode,config.appEnv);let advanced=0;
 for(const row of rows){if(signal.aborted)break;try{let sourceHash:string|undefined;if(row.status==='queued'){const session=repo.get<AssistantSessionRow>('SELECT * FROM studio_assistant_sessions WHERE id=?',row.session_id)!;const p=service.actor(session,row.actor_id);service.current(p,session);sourceHash=await service.checkedSources(p,session);}if(signal.aborted)break;repo.transaction(()=>{service.advance(row.id,sourceHash);});advanced++;}catch(error){if(signal.aborted)break;repo.transaction(()=>{const current=repo.get<AssistantGenerationRow>('SELECT * FROM studio_assistant_generations WHERE id=?',row.id);if(current&&['queued','speech','video'].includes(current.status))service.failGeneration(current,error);});}}
 return advanced;
}
