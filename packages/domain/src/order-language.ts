import type { PublicMenu } from '@digitalguide/contracts';
function quantity(text:string){
 if(/^[1-9]\d?$/.test(text))return Number(text);
 const digits:Record<string,number>={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
 if(digits[text])return digits[text];if(text==='十')return 10;
 const match=/^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/.exec(text);return match?(match[1]?digits[match[1]]:1)*10+(digits[match[2]]||0):null;
}
// Deliberately small local grammar: exact current menu names and explicit amounts.
// It produces a draft suggestion only; it never confirms or sends an order.
export function parseOrderSentence(text:string,menu:PublicMenu){
 if(!/^(?:请)?(?:帮我)?(?:我要|我想|给我|来|点|加)(?:点|加|来)?/.test(text))return null;
 const clarify={lines:[],reason:'请明确菜名、规格和份数，例如“来两份番茄面标准份”；退菜、整单取消及含条件的要求请到点单页核对。'};
 if(/不要|不点|别|取消|退|改成|换成|如果|还是|或者|不是|\?|？/.test(text))return clarify;
 const rest=text.replace(/^(?:请)?(?:帮我)?(?:我要|我想|给我|来|点|加)(?:点|加|来)?/,'').replace(/[。！!]$/,'').trim(),parts=rest.split(/[，,、]/).map(x=>x.trim());
 if(!rest||parts.length>10)return clarify;
 const lines:Array<{skuId:string;quantity:number;preparationNote:string}>=[];
 for(const part of parts){
  const found:Array<{skuId:string;quantity:number;preparationNote:string}>=[];
  for(const item of menu.items)for(const sku of item.skus){
   if(!sku.available)continue;
   const names=[item.name+sku.name,item.name+'（'+sku.name+'）',item.name+'('+sku.name+')',...(item.skus.length===1?[item.name]:[])];
   for(const name of names){let q:number|null=null;if(part.endsWith(name))q=quantity(part.slice(0,-name.length).trim().replace(/[份碗盘个]$/,''));else if(part.startsWith(name))q=quantity(part.slice(name.length).trim().replace(/[份碗盘个]$/,''));if(q&&!found.some(x=>x.skuId===sku.id))found.push({skuId:sku.id,quantity:q,preparationNote:''});}
  }
  if(found.length!==1)return clarify;lines.push(found[0]);
 }
 return {lines,reason:null};
}
