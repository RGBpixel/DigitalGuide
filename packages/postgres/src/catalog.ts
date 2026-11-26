import type pg from 'pg';
import {digest} from './source.js';
type Client=pg.Client;
export async function postgresCatalogFingerprint(client:Client,schema:string,normalizeCheck?:(definition:string)=>unknown,stableFunctionIdentity=false){
  const queries=[
    "SELECT c.relname AS table_name,a.attname AS column_name,a.attnum,a.attnotnull,a.attidentity,format_type(a.atttypid,a.atttypmod) AS type,co.collname,pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation WHERE n.nspname=$1 AND c.relkind='r' ORDER BY c.relname,a.attnum",
    "SELECT c.relname,con.conname,con.contype,con.convalidated,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,con.conname",
    "SELECT c.relname,ic.relname AS index_name,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname=$1 ORDER BY c.relname,ic.relname",
    "SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
    "SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY p.proname",
    "SELECT c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname",
    "SELECT sequencename,data_type,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename",
    "SELECT c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles::text,pg_get_expr(p.polqual,p.polrelid) AS qual,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expr FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,p.polname",
    "SELECT nspacl::text FROM pg_namespace WHERE nspname=$1"
  ];const results=[];for(let i=0;i<queries.length;i++){const query=i===4&&stableFunctionIdentity?queries[i].replace('ORDER BY p.proname','ORDER BY p.proname,pg_get_function_identity_arguments(p.oid) COLLATE "C"'):queries[i],rows=(await client.query(query,[schema])).rows;results.push(i===1&&normalizeCheck?rows.map(row=>row.contype==='c'?{...row,definition:normalizeCheck(row.definition)}:row):rows);}
  const views=(await client.query("SELECT c.relname,c.relkind,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN('v','m') ORDER BY c.relname",[schema])).rows;
  // No extra empty block: historical schemas without views retain their exact hash.
  if(views.length)results.push({viewDefinitions:views});return digest(results);
}
