import type {PracticeDefinition,PracticeQuestion} from '@digitalguide/contracts';
import {AppError} from '@digitalguide/domain';
import {assessPractice} from '../../domain/src/practice.js';
export function requirePracticeProvider(definition:PracticeDefinition,environment:string,appEnv:string){
 if(definition.provider!=='simulated-scripted')throw new AppError('PRACTICE_PROVIDER_UNAVAILABLE','真实训练模型尚未配置，请选择明确模拟方案或先接入服务；未生成模拟成功。',409);
 if(environment==='live'||appEnv==='production')throw new AppError('PRACTICE_SIMULATION_DISABLED','正式环境不能使用本地模拟练习，请先配置并验收真实训练服务。',409);
}
export function simulatedPracticeTurn(d:PracticeDefinition,q:PracticeQuestion,body:string,environment:string,appEnv:string){requirePracticeProvider(d,environment,appEnv);return assessPractice(d,q,body);}
