import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import type {DiningMemoryImport,DiningParty,DiningPreference,DiningRecommendation,PublicMenu} from '@digitalguide/contracts';
import {api} from '../api.js';
import {Box,Note,money,minor,tags} from './DiningShared.js';

type Props={party:DiningParty;guestBase?:string;csrfToken?:string;focusVersion?:number;selectionVersion?:number;automatic?:boolean;refresh():void};
type Fields=DiningPreference['preferences'];
const empty=():Fields=>({likes:[],avoids:[],allergens:[],allergyMode:'not_provided',maxSpice:null,budgetPerDishMinor:null,note:''});
const formFor=(f:Fields)=>({likes:f.likes.join('、'),avoids:f.avoids.join('、'),allergens:f.allergens.join('、'),allergyMode:f.allergyMode,spice:f.maxSpice===null?'':String(f.maxSpice),budget:f.budgetPerDishMinor===null?'':(f.budgetPerDishMinor/100).toFixed(2),note:f.note});
type Intent={url:string;body:Record<string,unknown>;target:string;version:number;kind:'save'|'confirm'|'import'};

export function PreferenceForm({party:p,guestBase,csrfToken,focusVersion=0,selectionVersion,automatic=true,refresh}:Props){
 const client=useQueryClient(),initial=p.preference?.preferences??empty(),base=(guestBase?guestBase+'/dining':'/restaurant')+'/parties/'+p.id;
 const [form,setForm]=useState(()=>formFor(initial)),[version,setVersion]=useState(p.version),[dirty,setDirty]=useState(false),[confirmedFor,setConfirmedFor]=useState<string|null>(null);
 const [fromMemory,setFromMemory]=useState(p.preference?.source==='memory_suggestion'),[source,setSource]=useState<DiningMemoryImport|null>(null),[chosen,setChosen]=useState<string[]>([]),[applied,setApplied]=useState<string[]>([]),[allowed,setAllowed]=useState(false),[notice,setNotice]=useState(''),[expiredSource,setExpiredSource]=useState('');
 const target=[base,p.id,focusVersion,selectionVersion,automatic].join(':'),live=useRef({target,version:p.version,preferenceId:p.preference?.id});live.current={target,version:p.version,preferenceId:p.preference?.id};
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const guestFields=guestBase?{focusVersion,...(selectionVersion!==undefined?{selectionVersion}:{})}:{},stale=version!==p.version;
 const sourceQuery=useQuery({queryKey:['dining-memory-source',guestBase,source?.id,focusVersion,selectionVersion],queryFn:()=>api<DiningMemoryImport>(guestBase+'/dining/memory-imports/'+source!.id),enabled:!!source&&!!guestBase&&selectionVersion!==undefined&&automatic,initialData:source??undefined,refetchInterval:1000,retry:false});
 const sourceInvalid=!!source&&(!!sourceQuery.error||expiredSource===source.id),availableSource=sourceInvalid?null:sourceQuery.data??source;
 const withdrawn=p.preference?.source==='memory_suggestion'&&p.preference.sourceFactIds.length===0;
 const maskedPreference=useRef<string|null>(null);
 function clearDerived(reason:string){setForm(formFor(empty()));setVersion(p.version);setDirty(true);setConfirmedFor(null);setFromMemory(false);setSource(null);setChosen([]);setApplied([]);setAllowed(false);setNotice(reason);}
 useEffect(()=>{
  if(sourceInvalid){if(fromMemory)clearDerived('本人授权或建议来源已变化，引用旧建议的输入已清空，请重新核对。');else{setSource(null);setChosen([]);setApplied([]);setAllowed(false);setNotice('本人建议已失效，请重新授权读取。');}}
 },[sourceInvalid]);
 useEffect(()=>{
  if(withdrawn&&p.preference&&maskedPreference.current!==p.preference.id){maskedPreference.current=p.preference.id;clearDerived('本人记忆来源已撤回或到期，旧建议输入已清空，请重新核对。');}
 },[withdrawn,p.preference?.id]);
 useEffect(()=>{if(!source)return;const id=source.id,timer=setTimeout(()=>setExpiredSource(id),Math.max(0,Date.parse(source.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[source?.id,source?.expiresAt]);
 const action=useMutation({mutationFn:async(intent:Intent)=>({intent,value:await api<DiningParty|DiningMemoryImport>(intent.url,intent.body,'POST',csrfToken)}),onSuccess:({intent,value})=>{
  if(!mounted.current)return;refresh();if(intent.target!==live.current.target)return;
  if('facts'in value){if(live.current.version!==intent.version)return;if(fromMemory)clearDerived('已读取新建议，引用旧建议的输入已清空，请重新选择。');setSource(value);setAllowed(true);setExpiredSource('');setChosen([]);setApplied([]);setConfirmedFor(null);return;}
  if(live.current.version!==intent.version&&!(live.current.version===value.version&&live.current.preferenceId===value.preference?.id))return;
  setVersion(value.version);setDirty(false);setConfirmedFor(null);setFromMemory(value.preference?.source==='memory_suggestion');void client.invalidateQueries({queryKey:['dining-recommendation']});
 }});
 function change<K extends keyof typeof form>(key:K,value:(typeof form)[K]){setForm(current=>({...current,[key]:value}));setDirty(true);setConfirmedFor(null);}
 function load(){setForm(formFor(p.preference?.preferences??empty()));setVersion(p.version);setDirty(false);setConfirmedFor(null);setFromMemory(p.preference?.source==='memory_suggestion');setSource(null);setChosen([]);setApplied([]);setAllowed(false);setNotice('');}
 const basis=[target,p.version,p.preference?.id,p.preference?.revision,JSON.stringify(form)].join(':'),checked=confirmedFor===basis,busy=action.isPending,needSource=fromMemory&&(!availableSource||!applied.length);
 function send(kind:Intent['kind'],suffix:string,body:Record<string,unknown>){action.mutate({kind,url:base+suffix,body:{...body,...guestFields,confirmed:true},target,version:p.version});}
 function save(){const fields:Fields={likes:tags(form.likes),avoids:tags(form.avoids),allergens:form.allergyMode==='specified'?tags(form.allergens):[],allergyMode:form.allergyMode,maxSpice:form.spice===''?null:Number(form.spice),budgetPerDishMinor:form.budget===''?null:minor(form.budget),note:form.note};send('save','/preferences',{version,preferences:fields,importId:fromMemory?availableSource!.id:null,sourceFactIds:fromMemory?applied:[]});}
 function apply(){if(!availableSource||!chosen.length)return;const selected=availableSource.facts.filter(f=>chosen.includes(f.id)),nickname=selected.find(f=>f.key==='nickname');setForm(current=>({...current,likes:selected.filter(f=>f.key==='like').map(f=>f.value).join('、')||current.likes,avoids:selected.filter(f=>f.key==='avoid').map(f=>f.value).join('、')||current.avoids,note:nickname?'建议称呼：'+nickname.value:current.note}));setApplied(chosen);setFromMemory(true);setDirty(true);setConfirmedFor(null);setNotice('建议已填入草稿，请先保存，再逐项核对并确认本次口味。');}
 return <Box title="本次口味与需核对成分"><p className="form-help">仅用于本次就餐。历史偏好需要本人授权、选择和本次确认；过敏信息请本人明确提供，并与店员核对。</p>
  <fieldset disabled={!automatic||busy||sourceInvalid} className="dining-form" onChange={()=>setConfirmedFor(null)}>
   <div className="dining-form-row"><label>本次喜欢的口味<input value={form.likes} onChange={e=>change('likes',e.target.value)} placeholder="如：清淡、番茄"/></label><label>本次忌口<input value={form.avoids} onChange={e=>change('avoids',e.target.value)} placeholder="多个成分用顿号分隔"/></label></div>
   <label>本次过敏信息<select value={form.allergyMode} onChange={e=>change('allergyMode',e.target.value as Fields['allergyMode'])}><option value="not_provided">暂未提供，请店员询问</option><option value="none_declared">本人声明本次无已知食物过敏</option><option value="specified">本次明确避开以下成分</option></select></label>
   {form.allergyMode==='specified'&&<label>明确需避开的成分<input value={form.allergens} onChange={e=>change('allergens',e.target.value)} placeholder="如：花生、牛奶"/></label>}
   <div className="dining-form-row"><label>可接受辣度<select value={form.spice} onChange={e=>change('spice',e.target.value)}><option value="">未限定</option>{['不辣','微辣','中辣','重辣'].map((text,index)=><option key={index} value={index}>{text}</option>)}</select></label><label>单道菜预算（元）<input inputMode="decimal" value={form.budget} onChange={e=>change('budget',e.target.value)} placeholder="不代表整单总额"/></label></div>
   <label>本次口味说明<textarea value={form.note} maxLength={300} onChange={e=>change('note',e.target.value)}/></label>
  </fieldset>
  {guestBase&&<details className="dining-memory"><summary>从本人已恢复的记忆中选择建议</summary><p className="form-help">在下方“我的接待偏好”登记或恢复本店本人资料，并开启个性化。重新读取会清空引用旧建议的当前输入。</p>
   <label className="dining-check"><input type="checkbox" checked={allowed} disabled={!automatic||busy} onChange={e=>{setAllowed(e.target.checked);setConfirmedFor(null);}}/>本次允许读取本人已恢复的口味记忆</label>
   <button disabled={!allowed||stale||!automatic||busy} onClick={()=>send('import','/memory-import',{version})}>读取本次记忆建议</button>
   {availableSource&&<div>{availableSource.facts.map(f=><label className="dining-check" key={f.id}><input type="checkbox" checked={chosen.includes(f.id)} disabled={!automatic||busy} onChange={e=>{setChosen(current=>e.target.checked?[...current,f.id]:current.filter(id=>id!==f.id));setConfirmedFor(null);}}/>{f.key==='nickname'?'称呼':f.key==='like'?'喜欢':'忌口'}：{f.value}</label>)}{!availableSource.facts.length&&<p>当前没有可供选择的已确认口味记忆。</p>}<button disabled={!chosen.length||!automatic||busy||stale} onClick={apply}>将所选建议填入草稿</button><p className="form-help">{availableSource.notice}</p></div>}
  </details>}
  {fromMemory&&<div className="info-note"><p>{needSource?'这份内容引用了历史建议；修改前请重新读取选择，或清空后手工填写。':'当前输入引用所选历史建议；来源失效时会清空整份派生输入。'}</p><button disabled={!automatic||busy} onClick={()=>clearDerived('已清空历史建议，请重新手工填写本次口味。')}>清空历史建议，改为手工填写</button></div>}
  {notice&&<p role="status">{notice}</p>}{stale&&<div className="info-note">人数、安排或偏好已有新版本，请载入后重新核对。<button disabled={busy} onClick={load}>载入当前偏好与安排</button></div>}
  <div className="dining-actions"><button disabled={stale||busy||!automatic||sourceInvalid||needSource} onClick={save}>保存本次偏好草稿</button><span className="muted">{p.preference?.usable?'当前保存内容已确认':p.preference?.reason||'尚未确认本次口味'}</span></div>
  <label className="dining-check"><input type="checkbox" checked={checked} disabled={dirty||stale||busy||!automatic||sourceInvalid||withdrawn||p.preference?.status!=='draft'} onChange={e=>setConfirmedFor(e.target.checked?basis:null)}/>已核对保存的本次口味及需避开成分</label>
  <button className="button primary" disabled={!checked||dirty||stale||busy||!automatic||sourceInvalid||withdrawn||p.preference?.status!=='draft'} onClick={()=>send('confirm','/preferences/confirm',{version,preferenceId:p.preference!.id,revision:p.preference!.revision})}>确认本次偏好</button>{dirty&&<p className="form-help">请先保存当前输入，再核对并确认。</p>}<Note error={action.error}/>
 </Box>;
}

export function Recommendation({party:p,menu,base,csrfToken,focusVersion,selectionVersion,automatic}:{party:DiningParty;menu:PublicMenu;base:string;csrfToken?:string;focusVersion?:number;selectionVersion?:number;automatic:boolean}){
 const [id,setId]=useState(''),scope=[base,p.id,p.version,menu.version,focusVersion,selectionVersion,automatic].join(':'),live=useRef(scope);live.current=scope;
 const create=useMutation({mutationFn:async()=>({scope,value:await api<DiningRecommendation>(base+'/parties/'+p.id+'/recommendations',{version:p.version,menuVersion:menu.version,...(focusVersion!==undefined?{focusVersion}:{}),...(selectionVersion!==undefined?{selectionVersion}:{})},'POST',csrfToken)}),onSuccess:result=>{if(result.scope===live.current)setId(result.value.id);}});
 const query=useQuery({queryKey:['dining-recommendation',base,p.id,focusVersion,selectionVersion,id],queryFn:()=>api<DiningRecommendation>(base+'/recommendations/'+id),enabled:!!id&&automatic,refetchInterval:2000,retry:false});
 return <Box title="当前菜单推荐"><p className="form-help">使用已确认的本次偏好及菜单版本 {menu.version}，仅列候选。菜品变化后需重新核对。</p><button disabled={!p.preference?.usable||!automatic||create.isPending||['completed','cancelled','no_show'].includes(p.status)} onClick={()=>create.mutate()}>按当前菜单重新推荐</button>{query.data&&<div className="dining-recommendations"><span className={'badge '+(query.data.status==='current'?'green':'amber')}>{query.data.status==='current'?'当前候选':'候选已失效'}</span>{query.data.staleReason&&<p role="status">{query.data.staleReason} 请重新推荐。</p>}{query.data.items.map(item=><article key={item.skuId}><div><strong>{item.name} · {item.skuName}</strong><b>{money(item.priceMinor)}</b></div><p>{item.reasons.join(' · ')}</p><small>{item.cautions.join('；')}</small></article>)}{!query.data.items.length&&<p>没有符合本次条件的可供菜品，请让店员帮助核对。</p>}{query.data.excluded.length>0&&<details><summary>查看排除原因（{query.data.excluded.length}）</summary>{query.data.excluded.map(item=><p key={item.itemId}>{item.name}：{item.reasons.join('、')}</p>)}</details>}<p className="form-help">{query.data.notice}</p></div>}<Note error={create.error||query.error}/></Box>;
}
