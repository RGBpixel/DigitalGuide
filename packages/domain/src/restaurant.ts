import type { z } from 'zod';
import type { openingWindow,diningPreferenceFields,PublicMenu } from '@digitalguide/contracts';
import { AppError } from './index.js';
const formatters=new Map<string,Intl.DateTimeFormat>();
export function restaurantOpen(windows:z.infer<typeof openingWindow>[],timezone:string,start:string,end:string){
 const a=Date.parse(start),b=Date.parse(end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>240*60000)throw new AppError('INVALID_DINING_INTERVAL','请选择大于0且不超过4小时的时段。',409);
 let formatter=formatters.get(timezone);if(!formatter){try{formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}catch{throw new AppError('INVALID_TIMEZONE','门店时区无效，请联系管理员。',409);}formatters.set(timezone,formatter);}
 const allowed=(at:number)=>{const p=Object.fromEntries(formatter!.formatToParts(new Date(at)).map(v=>[v.type,v.value])),day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday),minute=Number(p.hour)*60+Number(p.minute);return windows.some(w=>w.days.includes(day)&&minute>=w.startMinute&&minute<w.endMinute);};
 for(let at=a;at<b;at+=60000)if(!allowed(at))return false;return allowed(b-1);
}
export function diningIntervalOverlap(start:string,end:string,otherStart:string,otherEnd:string){return Date.parse(start)<Date.parse(otherEnd)&&Date.parse(end)>Date.parse(otherStart);}
const normalized=(s:string)=>s.normalize('NFKC').trim().toLocaleLowerCase('zh-CN'),matches=(registered:string[],wanted:string[])=>wanted.some(w=>registered.some(v=>normalized(v).includes(normalized(w))||normalized(w).includes(normalized(v))));
export function recommendDining(menu:PublicMenu,p:z.infer<typeof diningPreferenceFields>){
 const candidates:{skuId:string;itemId:string;name:string;skuName:string;priceMinor:number;currency:'CNY';isNew:boolean;reasons:string[];cautions:string[];score:number}[]=[],excluded:{itemId:string;name:string;reasons:string[]}[]=[];
 for(const item of menu.items){const reasons:string[]=[],available=item.skus.filter(s=>s.available),ingredients=[...item.ingredientTags,...item.allergenTags,...item.mayContainTags];
  if(!item.listed||!available.length)reasons.push('当前未上架或规格已售罄');
  if(p.avoids.length&&matches(ingredients,p.avoids))reasons.push('与本次明确忌口信息冲突');
  if(p.allergyMode==='specified'&&(!item.allergenInfoComplete||matches(ingredients,p.allergens)))reasons.push(item.allergenInfoComplete?'含本次需避开或可能接触的成分':'配料/共用厨房信息尚未核对');
  if(p.maxSpice!==null&&item.spiceLevel>p.maxSpice)reasons.push('超过本次可接受辣度');
  const affordable=available.filter(s=>p.budgetPerDishMinor===null||s.priceMinor<=p.budgetPerDishMinor);if(available.length&&!affordable.length)reasons.push('超过本次单道菜预算');
  if(reasons.length){excluded.push({itemId:item.id,name:item.name,reasons});continue;}
  for(const sku of affordable){const liked=p.likes.length&&matches([...item.flavorTags,...item.ingredientTags,item.name],p.likes),why=[...(liked?['符合本次确认的口味']:[]),...(item.isNew?['当前新菜']:[]),...(p.maxSpice!==null?['辣度在本次范围内']:[]),...(p.budgetPerDishMinor!==null?['单道菜价格在本次预算内']:[])];candidates.push({skuId:sku.id,itemId:item.id,name:item.name,skuName:sku.name,priceMinor:sku.priceMinor,currency:'CNY',isNew:item.isNew,reasons:why.length?why:['当前菜单可供选择'],cautions:[...(p.allergyMode==='not_provided'?['本次未提供过敏信息']:[]),'筛选依据菜单登记信息，需避开成分时请让店员再次核对'],score:(liked?100:0)+(item.isNew?20:0)});}
 }
 candidates.sort((a,b)=>b.score-a.score||a.priceMinor-b.priceMinor||a.skuId.localeCompare(b.skuId));return {items:candidates.slice(0,6).map(c=>({skuId:c.skuId,itemId:c.itemId,name:c.name,skuName:c.skuName,priceMinor:c.priceMinor,currency:c.currency,isNew:c.isNew,reasons:c.reasons,cautions:c.cautions})),excluded,notice:'仅依据本次已确认偏好和当前本地菜单/库存给出候选，不会自动下单；单道菜预算不代表整单总额。'};
}
