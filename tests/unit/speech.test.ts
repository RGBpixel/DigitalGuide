import { describe,expect,it } from 'vitest';
import { compileSpeech } from '@digitalguide/domain';
import { speechTextInput,expressionPresets,voiceLocale } from '@digitalguide/contracts';
describe('T22受控语音标记与词典',()=>{
 it('语言代码可覆盖常用选项之外的规范语言，不接受大小写歧义或属性注入；旧原词锚点不能指向新字',()=>{for(const locale of ['it-IT','ar-SA','pt-BR','en-GB'])expect(voiceLocale.safeParse(locale).success).toBe(true);for(const locale of ['en-us','zh_CN','en-US" bad="yes'])expect(voiceLocale.safeParse(locale).success).toBe(false);expect(()=>compileSpeech(speechTextInput.parse({text:'new',locale:'en-US',annotations:[{start:0,end:3,expectedText:'old',alias:'previous'}]}))).toThrow('原词');expect(speechTextInput.safeParse({text:'   ',locale:'en-US'}).success).toBe(false);});
 it('保留原文字幕，词典最长匹配及显式标注优先，按Unicode码点定位而不切断emoji',()=>{
  const result=compileSpeech(speechTextInput.parse({text:'😀重庆银行，欢迎。',locale:'zh-CN',annotations:[{start:1,end:3,alias:'重庆',emphasis:true,pauseBeforeMs:300}],dictionary:[{locale:'zh-CN',term:'重庆银行',alias:'长词别名'},{locale:'zh-CN',term:'银行',alias:'银航'}]}));
  expect(result.runs.map(r=>[r.start,r.end,r.text,r.spokenText])).toEqual([[0,1,'😀','😀'],[1,3,'重庆','重庆'],[3,5,'银行','银航'],[5,9,'，欢迎。','，欢迎。']]);expect(result.text).toBe('😀重庆银行，欢迎。');expect(result.ssml).toContain('<break time="300ms"/>');expect(result.ssml).toContain('<sub alias="银航">银行</sub>');expect(result.sapiXml).toContain('<silence msec="300"/><emph>重庆</emph>');
 });
 it('用户文字和别名只作文本转义，不能注入外部音频或标记，档位映射显式',()=>{
  const result=compileSpeech(speechTextInput.parse({text:'<audio src="https://invalid"/>&',locale:'en-US',controls:expressionPresets.lively,annotations:[{start:0,end:1,alias:'"<&\''}]}));expect(result.ssml).not.toContain('<audio');expect(result.sapiXml).not.toContain('<audio');expect(result.ssml).toContain('&quot;&lt;&amp;&apos;');expect(result.ssml).toContain('xml:lang="en-US"');expect(result.sapiXml).toContain('<rate absspeed="3"><pitch absmiddle="2"><volume level="85">');expect(result).toMatchObject({clonedVoice:false,referenceStyleTransferred:false});
 });
 it('超范围、重叠标注、重复词典和重复目标语言明确拒绝',()=>{
  for(const annotations of [[{start:0,end:6}],[{start:0,end:2},{start:1,end:3}]])expect(()=>compileSpeech(speechTextInput.parse({text:'abc',locale:'en-US',annotations}))).toThrow('语音标注');expect(()=>compileSpeech(speechTextInput.parse({text:'abc',locale:'en-US',dictionary:[{locale:'en-US',term:'a',alias:'one'},{locale:'en-US',term:'a',alias:'two'}]}))).toThrow('词条重复');expect(()=>compileSpeech(speechTextInput.parse({text:'abc',locale:'en-US',dictionary:[{locale:'en-US',term:'a',alias:'one',translations:[{locale:'en-US',text:'a'}]}]}))).toThrow('目标语言');
 });
 it('保留组合字符的原始码点与空白，不递归替换读音，拒绝无效XML字符',()=>{
  const result=compileSpeech(speechTextInput.parse({text:'e\u0301 SQL\n',locale:'en-US',dictionary:[{locale:'en-US',term:'SQL',alias:'sequel'},{locale:'en-US',term:'sequel',alias:'wrong'}]}));expect(result.runs.map(r=>[r.start,r.end,r.text])).toEqual([[0,3,'e\u0301 '],[3,6,'SQL'],[6,7,'\n']]);expect(result.sapiXml).toContain('sequel');expect(result.sapiXml).not.toContain('wrong');expect(result.text).toBe('e\u0301 SQL\n');for(const text of ['a\0b','a\ud800b','a\ufffeb'])expect(speechTextInput.safeParse({text,locale:'en-US'}).success).toBe(false);
 });
});
