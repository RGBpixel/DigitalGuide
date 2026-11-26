import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {nativeRuntimeFixture} from '../tests/integration/postgres-runtime-helpers.js';
import {nativePuppetHelpers} from '../tests/integration/postgres-live-puppet-helpers.js';
const x=await nativeRuntimeFixture();let result:unknown;
try{const a=nativePuppetHelpers(x,()=>p),p=await a.a.h.person(),r=await a.character();try{await x.owner(c=>c.query("INSERT INTO studio_characters SELECT(jsonb_populate_record(NULL::studio_characters,to_jsonb(c)||jsonb_build_object('id',$1::text,'parent_id',c.id))).* FROM studio_characters c WHERE c.id=$2",[randomUUID(),r.character.id]));result={unexpectedSuccess:true};}catch(e){const error=e as {code?:string;message?:string;where?:string};result={code:error.code,message:error.message,where:error.where};}}finally{await x.close();}
fs.writeFileSync('docs/evidence/T20/postgres-live-puppet/variant-original-error.json',JSON.stringify({result:'OBSERVED_ORIGINAL_FAILURE',error:result,syntheticDataOnly:true,privateClusterClosed:true,original044NotEdited:true},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
