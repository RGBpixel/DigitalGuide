import { useState } from 'react';
import {useQuery} from '@tanstack/react-query';
import {api} from '../api.js';
import { useSearchParams } from 'react-router-dom';
import type { StudioProject } from '@digitalguide/contracts';
import { useStudioList,ListState } from './shared.js';
import { CharacterLibrary } from './CharacterLibrary.js';
import { CharacterProduction } from './CharacterProduction.js';
import './character.css';
export function CharactersPage({workspaceId,writable}:{workspaceId:string;writable:boolean}){
 const capabilities=useQuery({queryKey:['character-capabilities',workspaceId],queryFn:()=>api<{localProductionTasks?:boolean;notice:string}>('/studio/characters/capabilities?workspaceId='+workspaceId),retry:false}),productionAvailable=capabilities.data?.localProductionTasks!==false;
 const [params,setParams]=useSearchParams(),tab=params.get('tab')==='production'?'production':'library',projectId=params.get('project')||'',projects=useStudioList<StudioProject>('studio/projects',workspaceId),[dirty,setDirty]=useState(false);
 return <><div className="studio-page-heading"><h1>形象、动作与素材检查</h1><p className="form-help">统一管理照片、视频、二维与三维来源，实际静态/原创动作和明确模拟准备分别展示。</p>{!productionAvailable&&<p className="character-warning" role="status">{capabilities.data?.notice}</p>}</div><div className="studio-tabs"><button className={tab==='library'?'active':''} onClick={()=>{const next=new URLSearchParams(params);next.set('tab','library');setParams(next);}}>形象与质检库</button><button disabled={!productionAvailable} className={tab==='production'?'active':''} onClick={()=>{const next=new URLSearchParams(params);next.set('tab','production');setParams(next);}}>工程形象与动作</button></div><div hidden={tab!=='library'}><CharacterLibrary workspaceId={workspaceId} writable={writable} productionAvailable={productionAvailable}/></div><div hidden={tab!=='production'||!productionAvailable}><div className="character-toolbar"><label>选择已保存工程<select value={projectId} disabled={dirty} onChange={e=>{const next=new URLSearchParams(params);next.set('project',e.target.value);setParams(next);}}><option value="">请选择制作工程</option>{projects.data?.pages.flatMap(p=>p.items).map(p=><option key={p.id} value={p.id}>{p.name} · v{p.version}</option>)}</select></label><ListState query={projects}/>{dirty&&<p className="form-help">动作草稿尚未保存；保存或载入已有计划后可切换工程。</p>}</div>{projectId?<CharacterProduction key={projectId} workspaceId={workspaceId} writable={writable} projectId={projectId} initialCharacterId={params.get('character')||''} onDirty={setDirty}/>:<p className="form-help">先从列表选择已有工程，或从创作工作台新建工程后进入。</p>}</div></>;
}
