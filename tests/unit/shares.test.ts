import {it,expect} from 'vitest';
import {shareOrigin,validateShare,shareInteraction} from '../../packages/domain/src/shares.js';
import {shareDefinitionFixture} from '../../packages/test-fixtures/src/shares.js';
it('互动跳转只接受精确HTTPS来源、本地回环开发来源与视频内时间；拒绝通配符、登录信息与脚本',()=>{
 for(const value of ['https://example.com/','https://*.example.com','https://a@b.test','https://example.com?x=1','javascript:alert(1)','https://example.com\r\nX-Test: a','http://example.com'])expect(()=>shareOrigin(value,true)).toThrow();
 expect(shareOrigin('https://example.com:8443')).toBe('https://example.com:8443');expect(shareOrigin('http://127.0.0.1:5174',true)).toBe('http://127.0.0.1:5174');expect(()=>shareOrigin('http://127.0.0.1:5174',false)).toThrow();
 const valid=shareDefinitionFixture();expect(validateShare(valid,6000)).toBe(valid);expect(shareInteraction(valid,'interest','detail',2500)).toEqual({kind:'seek',timeMs:4500});
 const d=shareDefinitionFixture();d.widgets[2].action={kind:'link',url:'javascript:alert(1)'};expect(()=>validateShare(d,6000)).toThrow();d.widgets[2].action={kind:'link',url:'https://unapproved.example/'};expect(()=>validateShare(d,6000)).toThrow();d.widgets[2].action={kind:'seek',timeMs:6000};expect(()=>validateShare(d,6000)).toThrow();
});
it('组件范围、章节顺序、唯一编号、选项与时间归属在服务端验证',()=>{
 const changes=[(d:ReturnType<typeof shareDefinitionFixture>)=>{d.chapters[1].timeMs=0;},(d:ReturnType<typeof shareDefinitionFixture>)=>{d.widgets[0].id=d.chapters[0].id;},(d:ReturnType<typeof shareDefinitionFixture>)=>{d.widgets[0].endMs=7000;},(d:ReturnType<typeof shareDefinitionFixture>)=>{d.widgets[0].rect.x=.9;},(d:ReturnType<typeof shareDefinitionFixture>)=>{if(d.widgets[1].action.kind==='choice')d.widgets[1].action.options[1].id='detail';}];
 for(const change of changes){const d=shareDefinitionFixture();change(d);expect(()=>validateShare(d,6000)).toThrow();}
 const d=shareDefinitionFixture();expect(()=>shareInteraction(d,'interest','detail',4000)).toThrow();expect(()=>shareInteraction(d,'interest','unknown',2500)).toThrow();expect(()=>shareInteraction(d,'focus-link','injected',1000)).toThrow();
});
