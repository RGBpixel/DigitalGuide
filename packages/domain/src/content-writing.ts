import type { ContentSection,ContentBrief } from '@digitalguide/contracts';
import { AppError } from './index.js';
export function splitContentSections(texts:string[],limit:number):ContentSection[] {
  const chunks:string[]=[];let current='';
  function append(text:string){if(current&&current.length+text.length+1>limit){chunks.push(current);current='';}current+=(current?'\n':'')+text;}
  for(const text of texts)for(const paragraph of text.replace(/\r\n?/g,'\n').split(/\n+/).map(v=>v.trim()).filter(Boolean)){
    let remaining=paragraph;
    while(remaining.length>limit){
      if(current){chunks.push(current);current='';}
      let cut=limit;
      // Avoid cutting a UTF-16 surrogate pair. The limit is an editing/storage limit, not a semantic summary.
      if(/[\uD800-\uDBFF]/.test(remaining[cut-1]))cut--;
      const punctuation=Math.max(remaining.lastIndexOf('。',cut-1),remaining.lastIndexOf('！',cut-1),remaining.lastIndexOf('？',cut-1));
      if(punctuation>=Math.floor(limit*.5))cut=punctuation+1;
      chunks.push(remaining.slice(0,cut));remaining=remaining.slice(cut);
    }
    if(remaining)append(remaining);
  }
  if(current)chunks.push(current);
  if(!chunks.length||chunks.length>40)throw new AppError('CONTENT_SECTION_LIMIT','整理后须为1—40段；请选摘来源或增大每段字符数，不会静默丢弃正文。',422);
  return chunks.map((text,index)=>({id:crypto.randomUUID(),title:'第'+(index+1)+'段',text,durationMs:Math.min(600000,Math.max(1000,Math.ceil(Array.from(text.replace(/\s/g,'')).length/4.5)*1000))}));
}
export function validateContentSections(sections:ContentSection[]) {
  if(new Set(sections.map(s=>s.id)).size!==sections.length)throw new AppError('CONTENT_DUPLICATE_SECTION','草稿段落编号重复，请重新载入。',422);
  if(sections.reduce((n,s)=>n+s.text.length,0)>60000||sections.reduce((n,s)=>n+s.durationMs,0)>10800000)throw new AppError('CONTENT_DRAFT_LIMIT','单份草稿最多60000字符及三小时，请拆分草稿。',422);
}
export interface ContentWritingInput {texts:string[];brief:ContentBrief|null;topic:string;chunkCharacters:number}
export interface ContentWritingProvider {id:'local-rules'|'mock-content'|'external-content';simulated:boolean;generate(input:ContentWritingInput):Promise<ContentSection[]>}
export function contentWritingProvider(id:ContentWritingProvider['id'],allowMock:boolean):ContentWritingProvider {
  if(id==='external-content')throw new AppError('CONTENT_PROVIDER_NOT_CONNECTED','真实内容模型尚未接入，请配置实际服务；不会自动退回规则或模拟。',409);
  if(id==='mock-content'&&!allowMock)throw new AppError('CONTENT_MOCK_NOT_ALLOWED','当前真实/生产环境不允许模拟内容模型。',409);
  return {id,simulated:id==='mock-content',async generate(input){
    let texts=input.texts;
    if(!texts.length){
      if(!input.brief||!input.topic)throw new AppError('CONTENT_INPUT_REQUIRED','请选择来源，或选择已保存定位和选题。',422);
      texts=['选题：'+input.topic+'\n目标受众：'+input.brief.audience+'\n内容目标：'+input.brief.objective+'\n请在此补充已核实的事实、例子和结尾。'];
    }
    if(id==='mock-content')texts=['模拟开场建议：'+(input.topic||'本次讲解')+'。\n请核对原始材料，并补充适合'+(input.brief?.audience||'目标受众')+'的表述。',...texts];
    const result=splitContentSections(texts,input.chunkCharacters);validateContentSections(result);return result;
  }};
}
export function reviseContentText(text:string,operation:'normalize'|'shorten'|'replace'|'mock_rewrite',replacement:string|undefined,instruction:string) {
  if(operation==='replace'){if(replacement===undefined)throw new AppError('CONTENT_REPLACEMENT_REQUIRED','请提供每一段需要替换的文字。',422);return replacement;}
  if(operation==='normalize')return text.split(/\r?\n/).map(line=>line.replace(/[ \t]+/g,' ').trim()).filter(Boolean).join('\n');
  if(operation==='shorten'){
    const sentences=text.match(/[^。！？.!?\n]+[。！？.!?]?/g)||[];
    return sentences.slice(0,Math.max(1,Math.ceil(sentences.length/2))).join('').trim();
  }
  // Explicit deterministic mock; the instruction is displayed for review, never executed as code/tools.
  const prefix='关于'+(instruction.replace(/\s+/g,' ').slice(0,80)||'本次表达')+'，建议先核对以下原稿：\n';
  if(prefix.length+text.length>4000)throw new AppError('CONTENT_REWRITE_TOO_LONG','模拟建议与原稿合计超过4000字符，请缩短所选段落。',422);
  return prefix+text;
}
export function contentInstruction(value:string) {
  const input=value.trim();
  if(/^(请)?(规范空白|整理空白|清理空白)[。！!]?$/u.test(input))return {operation:'normalize' as const};
  if(/^(请)?(精简|缩短|保留前半句)(当前段落|所选段落|这些段落)?[。！!]?$/u.test(input))return {operation:'shorten' as const};
  const replacement=/^(?:请)?替换为[：:]([\s\S]*)$/u.exec(input);
  if(replacement)return {operation:'replace' as const,text:replacement[1]};
  throw new AppError('CONTENT_INSTRUCTION_UNSUPPORTED','当前规则指令支持“规范空白”“精简所选段落”和单段“替换为：新文字”。其他语义修改请选择明确模拟或接入真实模型，不会猜测执行。',422);
}
