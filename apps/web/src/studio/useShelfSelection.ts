import {useEffect,useRef} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useSearchParams} from 'react-router-dom';
import {z} from 'zod';
import {shelfSelectionSchema} from '@digitalguide/contracts';
import {api,ApiError} from '../api.js';
export function useShelfSelection<T extends {id:string;workspaceId:string;version:number}>(workspaceId:string,kind:'character'|'voice',schema:z.ZodType<T>,load:(value:T)=>void){
 const[search]=useSearchParams(),id=search.get(kind==='character'?'character':'style'),selection=search.get('selection'),client=useQueryClient(),applied=useRef(''),apply=useRef(load);apply.current=load;
 const query=useQuery({queryKey:['shelf-source-navigation',workspaceId,kind,id,selection],enabled:!!id,queryFn:async({signal})=>{if(!z.uuid().safeParse(id).success||selection&&!z.uuid().safeParse(selection).success)throw new Error('资源链接无效，请回资源货架重新打开。');const receipt=selection?shelfSelectionSchema.parse(await api<unknown>('/resource-shelf/selections/'+selection,undefined,'GET',undefined,signal)):null;if(receipt&&(receipt.workspaceId!==workspaceId||receipt.kind!==kind||receipt.sourceId!==id))throw new Error('资源与当前工作空间不一致，请重新选择空间后打开。');const value=schema.parse(await api<unknown>((kind==='character'?'/studio/characters/':'/studio/voice/styles/')+id,undefined,'GET',undefined,signal));if(value.workspaceId!==workspaceId||receipt&&value.version!==receipt.sourceVersion)throw new Error('资源版本或工作空间已变化，请回货架重新核对。');return value;},retry:false,refetchOnMount:'always'});
 useEffect(()=>{if(query.data&&!query.isError){const key=workspaceId+':'+selection+':'+query.data.id+':'+query.data.version;if(applied.current!==key){applied.current=key;apply.current(query.data);}}},[query.data,query.isError,workspaceId,selection]);
 useEffect(()=>{if(query.error instanceof ApiError&&[401,403].includes(query.error.status))void client.invalidateQueries({queryKey:['me']});},[query.error,client]);
 return{...query,requested:!!id};
}
