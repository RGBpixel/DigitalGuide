import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,ApiError} from '../api.js';

/** A denied dining read must never continue to display its previous private data. */
export function useDiningResource<T>({key,url,enabled=true,interval=1000}:{key:readonly unknown[];url:string;enabled?:boolean;interval?:number}){
 const client=useQueryClient(),[denied,setDenied]=useState<{at:number;error:Error}|null>(null);
 const query=useQuery({queryKey:key,queryFn:({signal})=>api<T>(url,undefined,'GET',undefined,signal),enabled,refetchInterval:interval,retry:false,gcTime:0});
 const blocked=denied&&query.dataUpdatedAt<=denied.at,data=enabled&&!query.isError&&!blocked?query.data:undefined,error=query.error||(blocked?denied.error:null);
 function reload(failure?:unknown){
  if(failure instanceof ApiError&&[401,403,404].includes(failure.status)){
   setDenied({at:Date.now(),error:failure});
   void client.cancelQueries({queryKey:key,exact:true}).then(()=>query.refetch());
  }else void query.refetch();
 }
 return{...query,data,error,isSuccess:query.isSuccess&&data!==undefined,isError:!!error,reload};
}
