import type {Principal} from '@digitalguide/domain';
import type {Repository} from '@digitalguide/database';
import {assertProgrammeSource} from '../../../packages/domain/src/live-guest-programme.js';
import type {LiveOutputFrameDescription} from '../../../packages/domain/src/live-output.js';
import type {OutputPart,OutputGeneration,LiveOutputRow} from './live-output-state.js';
export function assertProgrammePart(repo:Repository,p:Principal,output:LiveOutputRow,part:OutputPart){
 if(part.kind==='init')return;const generation=repo.get<OutputGeneration>('SELECT * FROM live_output_generations WHERE id=?',part.generation_id);if(!generation)throw new Error('Output generation missing');const first=generation.start_frame+Math.floor(part.media_start_ms*24/1000),last=first+Math.ceil(part.duration_ms*24/1000)-1;
 for(const span of repo.all<{frame:string}>('SELECT frame FROM live_output_spans WHERE generation_id=? AND first_frame<=? AND last_frame>=?',generation.id,last,first)){const frame=JSON.parse(span.frame) as LiveOutputFrameDescription;for(const guest of frame.guests||[])assertProgrammeSource(repo,p,guest,output.workspace_id,output.environment,output.app_env);}
}
