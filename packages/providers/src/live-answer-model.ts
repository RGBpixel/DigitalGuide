import {AppError,canonical} from '@digitalguide/domain';
import {liveAnswerEngine,type LiveAnswerEngine} from '@digitalguide/contracts';
import {localEditorModel} from './local-editor-model.js';
import {semanticModel} from '../../media/src/semantic-model.js';
export async function liveAnswerModel(root:string,force=false){const profile=await localEditorModel(root,force),model=Object.fromEntries(Object.entries(profile.engine).filter(([k])=>k!=='policy')),retrieval=Object.fromEntries(Object.entries(semanticModel(root,force).engine).filter(([k])=>k!=='candidatePolicy'));return{...profile,answerEngine:liveAnswerEngine.parse({model,retrieval,policy:'live-public-grounded-v1',queryPolicy:'literal-query-span-v1',maximumQueryOutputTokens:512,maximumSources:8,sourceCharacters:600})};}
export async function requireLiveAnswerModel(root:string,expected:LiveAnswerEngine,force=false){const profile=await liveAnswerModel(root,force);if(canonical(profile.answerEngine)!==canonical(expected))throw new AppError('LIVE_ANSWER_ENGINE_CHANGED','本机直播答疑模型、运行时或策略已变化，请核对后重新配置。',409);return profile;}
