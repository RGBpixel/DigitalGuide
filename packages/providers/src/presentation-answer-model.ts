import {AppError,canonical} from '@digitalguide/domain';
import {presentationAnswerEngine,type PresentationAnswerEngine} from '@digitalguide/contracts';
import {localEditorModel} from './local-editor-model.js';
import {semanticModel} from '../../media/src/semantic-model.js';
export async function presentationModel(root:string,force=false,policy:PresentationAnswerEngine['policy']='ppt-question-parts-v2'){const profile=await localEditorModel(root,force),identity=Object.fromEntries(Object.entries(profile.engine).filter(([key])=>key!=='policy')),retrieval=Object.fromEntries(Object.entries(semanticModel(root,force).engine).filter(([key])=>key!=='candidatePolicy'));return{...profile,answerEngine:presentationAnswerEngine.parse({model:identity,retrieval,policy,maximumSources:8,sourceCharacters:600})};}
export async function requirePresentationModel(root:string,expected:PresentationAnswerEngine,force=false){const profile=await presentationModel(root,force,expected.policy);if(canonical(profile.answerEngine)!==canonical(expected))throw new AppError('PRESENTATION_ANSWER_ENGINE_CHANGED','本机答疑模型、运行时或策略已变化，请审阅后重新配置场次。',409);return profile;}
