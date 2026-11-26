import { describe,expect,it } from 'vitest';
import { parseOrderSentence } from '../../packages/domain/src/order-language.js';
import type { PublicMenu } from '@digitalguide/contracts';
const menu={items:[{name:'番茄面',skus:[{id:'sku-a',name:'标准份',available:true}]},{name:'素食套餐',skus:[{id:'sku-b',name:'小份',available:true},{id:'sku-c',name:'大份',available:true}]}]} as PublicMenu;
describe('本地明确点单语句只形成可编辑建议',()=>{
 it('准确菜名、规格、阿拉伯或中文份数才映射服务器SKU',()=>{expect(parseOrderSentence('来两份番茄面',menu)?.lines).toEqual([{skuId:'sku-a',quantity:2,preparationNote:''}]);expect(parseOrderSentence('我要番茄面3份，素食套餐大份1份',menu)?.lines.map(l=>l.skuId)).toEqual(['sku-a','sku-c']);expect(parseOrderSentence('加二十三份番茄面',menu)?.lines[0].quantity).toBe(23);});
 it('未知菜、含糊规格、否定、取消、条件和非法份数要求澄清',()=>{for(const text of ['来两份素食套餐','来0份番茄面','来100份番茄面','来一份番茄面但是不要','我要取消番茄面','如果有番茄面就来两份','来一份不在菜单的菜','来番茄面'])expect(parseOrderSentence(text,menu)?.lines||[]).toHaveLength(0);});
 it('普通咨询不创建点单建议',()=>{expect(parseOrderSentence('订单进度怎么样',menu)).toBeNull();expect(parseOrderSentence('当前有什么菜',menu)).toBeNull();});
});
