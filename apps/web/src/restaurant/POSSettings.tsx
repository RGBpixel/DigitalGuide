import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { POSConfig,POSScenario } from '@digitalguide/contracts';
import { api } from '../api.js';
import {useDiningResource} from './useDiningResource.js';
import { Box,Note } from './DiningShared.js';
export function POSSettings({restaurantId}:{restaurantId:string}){
 const query=useDiningResource<POSConfig>({key:['restaurant-pos',restaurantId],url:'/restaurants/'+restaurantId+'/pos',interval:2000});
 return <Box title="后厨连接"><Note error={query.error}/>{query.data&&<POSForm initial={query.data} refresh={error=>query.reload(error)}/>}</Box>;
}
function POSForm({initial:c,refresh}:{initial:POSConfig;refresh(error?:unknown):void}){
 const [version,setVersion]=useState(c.version),[provider,setProvider]=useState(c.providerId||'mock-pos'),[scenario,setScenario]=useState<POSScenario>(c.scenario||'normal'),[enabled,setEnabled]=useState(c.enabled),[confirmedFor,setConfirmedFor]=useState<string|null>(null),scope=JSON.stringify([c.restaurantId,c.version,version,provider,enabled,scenario,c.canManage]),checked=confirmedFor===scope,setChecked=(value:boolean)=>setConfirmedFor(value?scope:null),stale=version!==c.version;
 const save=useMutation({mutationFn:()=>api<POSConfig>('/restaurants/'+c.restaurantId+'/pos',{version,providerId:provider,scenario,enabled,confirmed:true}),onSuccess:v=>{setVersion(v.version);setChecked(false);refresh();},onError:error=>{setChecked(false);refresh(error);}});
 function load(){setVersion(c.version);setProvider(c.providerId||'mock-pos');setScenario(c.scenario||'normal');setEnabled(c.enabled);setChecked(false);}
 return <div className="dining-form"><p className="form-help">{c.notice}</p>{c.canManage&&<><fieldset disabled={save.isPending} onChange={()=>setChecked(false)}><label>后厨服务<select value={provider} onChange={e=>setProvider(e.target.value as typeof provider)}><option value="mock-pos" disabled={!c.mockAllowed}>模拟POS · 仅验证本地流程</option><option value="external-pos">真实POS · 尚未接入</option></select></label>{provider==='mock-pos'&&<label>模拟后厨场景<select value={scenario} onChange={e=>setScenario(e.target.value as POSScenario)}><option value="normal">正常接收并接单</option><option value="rejected">明确拒绝</option><option value="response_lost">响应丢失 · 可查询原结果</option><option value="unresolved">暂无法核实远端结果</option></select></label>}<label className="dining-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用此后厨连接</label></fieldset>{stale&&<p className="dining-warning">连接已更新，请载入当前配置再核对。</p>}<label className="dining-check"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>已核对后厨服务、环境和模拟场景</label><div className="dining-actions"><button disabled={!checked||stale||save.isPending} onClick={()=>save.mutate()}>保存后厨连接</button><button onClick={load}>载入当前后厨配置</button></div></>}<Note error={save.error}/></div>;
}
