import type {Repository} from '@digitalguide/database';
const resource='qwen3-4b-cpu';
export function claimNativeModel(repo:Repository,kind:string,id:string,token:string){
 const now=new Date().toISOString();repo.run('DELETE FROM native_model_leases WHERE resource=? AND lease_until<=?',resource,now);
 if(repo.get('SELECT resource FROM native_model_leases WHERE resource=?',resource))return false;
 repo.run('INSERT INTO native_model_leases VALUES (?,?,?,?,?)',resource,kind,id,token,new Date(Date.now()+30000).toISOString());return true;
}
export function renewNativeModel(repo:Repository,token:string){return repo.run('UPDATE native_model_leases SET lease_until=? WHERE resource=? AND token=? AND lease_until>?',new Date(Date.now()+30000).toISOString(),resource,token,new Date().toISOString()).changes===1;}
export function releaseNativeModel(repo:Repository,token:string){repo.run('DELETE FROM native_model_leases WHERE resource=? AND token=?',resource,token);}
