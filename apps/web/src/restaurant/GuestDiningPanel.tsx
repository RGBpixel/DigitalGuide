import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import type {DiningParty,GuestDining,ReceptionSession} from '@digitalguide/contracts';
import {api} from '../api.js';
import {useDiningResource} from './useDiningResource.js';
import {Box,DiningBoundary,DiningEntryForm,MenuList,Note,partyState} from './DiningShared.js';
import {DiningPartyPanel} from './DiningPartyPanel.js';
import './restaurant.css';

type Intent={url:string;body:Record<string,unknown>;csrfToken:string};
const sendIntent=(intent:Intent)=>api(intent.url,intent.body,'POST',intent.csrfToken);

export function GuestDiningPanel({session,csrfToken}:{session:ReceptionSession;csrfToken:string}){
 const base='/guest/sessions/'+session.id,client=useQueryClient();
 const ended=['ended','expired'].includes(session.status);
 const query=useDiningResource<GuestDining>({key:['guest-dining',session.id,session.focusVersion],url:base+'/dining',enabled:!ended});
 function refresh(){
  void client.invalidateQueries({queryKey:['guest-dining',session.id]});
  void client.invalidateQueries({queryKey:['guest-session',session.id]});
 }
 if(ended)return <Box title="本次餐厅接待已结束"><p>已确认的预约或桌位仍由门店保存；请联系店员开启新终端，再用本人保管的就餐凭证恢复。</p></Box>;
 const view=query.data;
 return <section className="guest-dining">
  <div className="guest-dining-heading"><span className="eyebrow">YOUR DINING VISIT</span><h2>本次就餐{view?' · '+view.restaurant.name:''}</h2><p>{view?.restaurant.capabilities?.preferences===false?'核对本次同行人数和座位，安排只属于当前顾客。':'核对人数、座位和口味，安排只属于本次顾客。'}</p></div>
  <Note error={query.error}/>
  {view&&view.focusVersion===session.focusVersion?<DiningVisit key={[session.id,view.focusVersion,view.selectionVersion??'legacy',view.selectedPartyId,view.automatic,session.status].join(':')} view={view} session={session} csrfToken={csrfToken} refresh={refresh}/>:!query.error&&<p role="status">正在同步当前顾客的就餐安排…</p>}
 </section>;
}

function DiningVisit({view,session,csrfToken,refresh}:{view:GuestDining;session:ReceptionSession;csrfToken:string;refresh():void}){
 const base='/guest/sessions/'+session.id,fields={focusVersion:session.focusVersion,...(view.selectionVersion!==undefined?{selectionVersion:view.selectionVersion}:{})};
 const [code,setCode]=useState(''),[claimChecked,setClaimChecked]=useState(false);
 const automatic=view.automatic&&session.status==='active';
 const select=useMutation({mutationFn:sendIntent,onSuccess:refresh});
 const claim=useMutation({mutationFn:sendIntent,onSuccess:()=>{setCode('');setClaimChecked(false);refresh();}});
 const selected=view.parties.find(p=>p.id===view.selectedPartyId);
 const party=selected??(view.selectionVersion===undefined?(view.parties.find(p=>!['completed','cancelled','no_show'].includes(p.status))??view.parties[0]):undefined);
 function choose(row:DiningParty){
  select.mutate({url:base+'/dining/parties/'+row.id+'/select',body:{version:row.version,...fields,confirmed:true},csrfToken});
 }
 return <>
  <Note error={select.error||claim.error}/>
  <div className="guest-dining-columns"><div>
   <Box title="预约或现场排队">{automatic?<DiningEntryForm restaurantId={view.restaurant.id} guestBase={base} csrfToken={csrfToken} focusVersion={session.focusVersion} selectionVersion={view.selectionVersion} refresh={refresh}/>:<p>当前由工作人员接待，自动提交已暂停。</p>}</Box>
   <Box title="我的就餐记录">
    <div className="dining-party-list">{view.parties.map(row=><button className={row.id===party?.id?'selected':''} key={row.id} disabled={select.isPending||claim.isPending||!automatic||['cancelled','no_show'].includes(row.status)||row.status==='completed'&&view.restaurant.capabilities?.aftercare!==true} onClick={()=>choose(row)}><div><strong>{row.name} · {row.size}人</strong><span>{partyState[row.status]}{row.queueNumber?' · 排队号 '+row.queueNumber:''}</span></div><span>{view.selectedPartyId===row.id?'当前问答对象':'选为当前问答对象'}</span></button>)}{!view.parties.length&&<p>本终端尚未建立就餐记录。</p>}</div>
    <details className="dining-private"><summary>恢复本人已有预约或就餐</summary><p className="form-help">使用本人保管的最新私有就餐凭证。恢复只转移本组安排，原终端会失去此组操作权，原预留截止时间不会延长。</p>
     <form className="dining-form" onSubmit={e=>{e.preventDefault();if(claimChecked&&automatic)claim.mutate({url:base+'/dining/claim',body:{code,...fields,confirmed:true},csrfToken});}}>
      <label>本人就餐凭证<input type="password" value={code} maxLength={100} autoComplete="off" spellCheck={false} disabled={claim.isPending||!automatic} onChange={e=>{setCode(e.target.value);setClaimChecked(false);}}/></label>
      <label className="dining-check"><input type="checkbox" checked={claimChecked&&automatic} disabled={!automatic||claim.isPending} onChange={e=>setClaimChecked(e.target.checked)}/>确认在本终端继续本人的就餐记录</label>
      <button disabled={!claimChecked||!code.trim()||claim.isPending||select.isPending||!automatic}>恢复本组安排</button>
     </form>
    </details>
   </Box>
  </div><div>
   {party?<DiningPartyPanel key={party.id+':'+session.focusVersion+':'+(view.selectionVersion??'legacy')} party={party} menu={view.menu} restaurantId={view.restaurant.id} capabilities={view.restaurant.capabilities} guestBase={base} csrfToken={csrfToken} focusVersion={session.focusVersion} selectionVersion={view.selectionVersion} automatic={automatic} refresh={refresh}/>:<Box title={view.parties.length?'选择当前问答对象':'先确认本次同行人数'}><p>{view.parties.length?'请从本人就餐记录中选择要继续办理的一组，再核对当前安排。':'可以现在排队，也可预约未来时段。已有预约时，从私有就餐凭证恢复，避免重复登记。'}</p></Box>}
  </div></div>
  <Box title="当前可供菜单"><MenuList menu={view.menu}/></Box>
  <DiningBoundary capabilities={view.restaurant.capabilities}/>
 </>;
}
