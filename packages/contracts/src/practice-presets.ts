import type {PracticeDefinition,PracticeQuestion} from './practice.js';
export const practicePresetLabels={reception:'企业接待练习',sales:'销售沟通练习',interview:'面试表达练习',research:'调研访谈',custom:'自定义练习'};
export function practicePreset(preset:PracticeDefinition['preset'],profileId:string):PracticeDefinition{
 const research=preset==='research';
 const criterion=(label:string,cues:string[],basis:string)=>({id:'c1',label,cues,weight:1,basis,metFeedback:'回答中出现了配置的字样，请继续核对语境和表达。',missingFeedback:'回答中未找到配置的字样，可对照标准再练习；这不代表含义或能力判断。'});
 const q=(id:string,prompt:string,criteria:PracticeQuestion['criteria'],next:string|null):PracticeQuestion=>({id,prompt,hint:research?'按自己的体验回答，可以说明不愿回答的部分。':'只进行文字练习，不执行任何真实业务。',reference:research?'本访谈用于本地产品体验调研，不收集正式业务档案。':'此处均为原创虚构情境。',criteria,nextOnMet:next,nextOnMiss:next});
 let questions:PracticeQuestion[];
 if(research)questions=[q('q1','你体验本地演示页面时，哪一部分最方便？',[],'q2'),q('q2','有哪些地方需要改进？请描述一个具体例子。',[],null)];
 else{
  const first=preset==='sales'?q('q1','我是来了解这本测试展册的，请介绍价格。',[criterion('价格说明',['30元','三十元'],'虚构展册售价30元/本；仅匹配所列字样，不核验报价语义。')],'q2'):preset==='interview'?q('q1','请举一个你准备表达的具体例子。',[criterion('具体举例字样',['例如','比如','曾经'],'仅模拟识别举例用语，不核验经历真实性，不用于聘用或绩效决定。')],'q2'):q('q1','我来拜访同事，请问你需要先了解什么？',[criterion('询问来访信息',['拜访','受访','找哪','姓名'],'本练习要求先核对来访对象；匹配字样不执行登记或通知。')],'q2');
  first.nextOnMiss='followup';const follow=q('followup','请对照本题标准补充一下；本次仍是模拟对话。',structuredClone(first.criteria),'q2');
  const second=preset==='interview'?q('q2','你下一步准备怎样继续练习？',[criterion('练习计划字样',['学习','练习'],'只记录本人自述的计划，不推断人格或实际能力。')],null):q('q2','请说明下一步需要我确认的事项。',[criterion('明确确认',['确认','核实'],'真实操作必须另行确认；本练习没有下单、支付、通知或门禁权限。')],null);
  if(preset==='sales')first.reference='原创虚构测试展册：30元/本，是否购买由本人决定。本次不创建订单。';questions=[first,follow,second];
 }
 return{schemaVersion:1,preset,mode:research?'research':'practice',profileId,provider:'simulated-scripted',goal:research?'按问题收集本地体验原话，不进行人格或能力评分。':'在虚构情境中练习表达，查看原话与配置标准的模拟匹配。',roleName:research?'调研访谈员':preset==='interview'?'模拟面试官':'模拟来访者',instructions:'仅按固定问题流程进行文字模拟；不访问正式人员、记忆、知识或业务工具。',retentionDays:7,startQuestionId:'q1',questions,...(preset==='custom'?{goal:'请填写本次练习目标和具体标准。'}:{})};
}
