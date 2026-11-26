import type {AdDefinition,AdPolicy,AdReport} from '@digitalguide/contracts';
import {AppError} from './index.js';
export const adMinorDigits={CNY:2,USD:2,EUR:2,JPY:0} as const;
export function parseAdMoney(value:string,currency:keyof typeof adMinorDigits){const digits=adMinorDigits[currency],pattern=digits?/^\d{1,12}(?:\.\d{1,2})?$/:/^\d{1,12}$/;if(!pattern.test(value.trim()))throw new AppError('AD_MONEY_FORMAT',digits?'金额最多两位小数，不能使用负数或科学计数法。':'日元金额需为整数。',400);const [whole,fraction='']=value.trim().split('.'),minor=Number(whole)*10**digits+Number(fraction.padEnd(digits,'0'));if(!Number.isSafeInteger(minor)||minor>1000000000000)throw new AppError('AD_MONEY_LIMIT','金额超过本地演练范围。',400);return minor;}
export function adDay(at:string|number,timezone:string){const date=new Date(at);if(!Number.isFinite(date.getTime()))throw new AppError('AD_TIME_INVALID','广告事件时间无效。',409);return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
export function validateAdDefinition(d:AdDefinition,policy:AdPolicy){
 if(Date.parse(d.endsAt)<=Date.parse(d.startsAt)||Date.parse(d.endsAt)-Date.parse(d.startsAt)>30*86400000)throw new AppError('AD_SCHEDULE_INVALID','广告排期需为连续三十天以内，结束时间需晚于开始时间。',409);
 if(d.dailyBudgetMinor>d.totalBudgetMinor||d.dailyBudgetMinor>policy.dailyLimitMinor||d.totalBudgetMinor>policy.totalLimitMinor)throw new AppError('AD_BUDGET_LIMIT','计划的日限额/总限额超过账户策略，或日预算超过总预算。',409);
 for(const items of [d.creatives,d.groups])if(new Set(items.map(i=>i.id)).size!==items.length)throw new AppError('AD_DUPLICATE_ID','广告素材或广告组编号重复。',409);
 if(d.groups.reduce((n,g)=>n+g.dailyBudgetMinor,0)>d.dailyBudgetMinor||d.groups.reduce((n,g)=>n+g.totalBudgetMinor,0)>d.totalBudgetMinor)throw new AppError('AD_GROUP_BUDGET','广告组预算合计不能超过计划预算。',409);
 for(const g of d.groups){if(g.dailyBudgetMinor>g.totalBudgetMinor||new Set(g.creatives.map(c=>c.creativeId)).size!==g.creatives.length||g.creatives.some(c=>!d.creatives.some(source=>source.id===c.creativeId)))throw new AppError('AD_GROUP_INVALID','广告组预算或引用素材无效，请核对。',409);}
}
export function attributedConversions(report:AdReport,windowHours:string){if(report.kind!=='conversion')return 0;if(!report.clickTime||!report.conversionTime)return 0;const delta=Date.parse(report.conversionTime)-Date.parse(report.clickTime);return delta>=0&&delta<=Number(windowHours)*3600000?report.conversions:0;}
export function adHeadroom(...values:number[]){if(values.some(v=>!Number.isSafeInteger(v)))throw new AppError('AD_AMOUNT_INVALID','广告预算或账本金额不能安全计算。',409);return Math.max(0,Math.min(...values));}
export function validateAdReport(r:AdReport){if(r.clicks>r.impressions||r.kind!=='conversion'&&r.conversions>r.clicks||r.kind==='charge'&&(r.amountMinor<=0||r.originalEventId)||r.kind==='credit'&&(r.amountMinor>=0||!r.originalEventId)||r.kind==='conversion'&&r.amountMinor!==0)throw new AppError('AD_REPORT_INVALID','广告回执的金额、计数或修正引用无效。',409);}
