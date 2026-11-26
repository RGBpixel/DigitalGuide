import {isDeepStrictEqual} from 'node:util';
import {RecoveryError} from '../../recovery/src/guard.js';
import type {NativeRecoverySnapshot} from './recovery-manifest.js';

type Node=string|{group:Node[]}|{boolean:'AND'|'OR';terms:Node[]};
// pg_dump can flatten a left-hand AND introduced by BETWEEN when its deparsed
// CHECK is parsed again. Preserve every atom, argument group and term order;
// normalize only associative groups of the same parenthesized boolean operator.
export function recoveryCheckDefinition(definition:string):Node{
 let position=0;
 function fail():never{throw new RecoveryError('PG_RECOVERY_CATALOG_UNSUPPORTED','数据库CHECK约束无法安全规范化，备份恢复已拒绝。');}
 function group(nested:boolean,depth=0):Node{
  if(depth>128)fail();
  const items:Node[]=[];let atom='';const flush=()=>{if(atom){items.push(atom);atom='';}};
  while(position<definition.length){const c=definition[position];
   if(c==='('){flush();position++;items.push(group(true,depth+1));continue;}
   if(c===')'){if(!nested)fail();flush();position++;return normalized(items);}
   if(/\s/u.test(c)){flush();position++;continue;}
   if(c==="'"||c==='"'){
    const quote=c,escaped=quote==="'"&&/^[eE]$/.test(atom);atom+=c;position++;let ended=false;
    while(position<definition.length){const value=definition[position++];atom+=value;if(escaped&&value==='\\'){if(position===definition.length)fail();atom+=definition[position++];continue;}if(value===quote){if(definition[position]===quote){atom+=definition[position++];continue;}ended=true;break;}}
    if(!ended)fail();continue;
   }
   if(c==='$'){const tag=definition.slice(position).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];if(tag){const end=definition.indexOf(tag,position+tag.length);if(end<0)fail();atom+=definition.slice(position,end+tag.length);position=end+tag.length;continue;}}
   // PostgreSQL's deparser does not emit comments. Do not interpret unexpected
   // comment text as boolean syntax or silently discard it.
   if(definition.startsWith('--',position)||definition.startsWith('/*',position))fail();
   atom+=c;position++;
  }
  if(nested)fail();flush();return normalized(items);
 }
 function normalized(items:Node[]):Node{
  if(items.length===1&&typeof items[0]!=='string'&&'boolean'in items[0])return items[0];
  const op=items[1];if(items.length>=3&&items.length%2===1&&(op==='AND'||op==='OR')&&items.every((v,i)=>i%2===1?v===op:typeof v!=='string')){
   const terms:Node[]=[];for(let i=0;i<items.length;i+=2){const value=items[i];if(typeof value!=='string'&&'boolean'in value&&value.boolean===op)terms.push(...value.terms);else terms.push(value);}return{boolean:op,terms};
  }
  return{group:items};
 }
 if(definition.length>1024*1024||!/^CHECK\s*\(/.test(definition))fail();return group(false);
}

export function nativeRecoverySnapshotsEqual(actual:NativeRecoverySnapshot,expected:NativeRecoverySnapshot){
 const a={...actual},e={...expected};
 if(expected.recoveryCatalogAlgorithm){
  if(!expected.recoveryCatalogSHA256||actual.recoveryCatalogAlgorithm!==expected.recoveryCatalogAlgorithm||actual.recoveryCatalogSHA256!==expected.recoveryCatalogSHA256)return false;
  // This digest covers the same complete catalog/ACL projection. Only CHECK
  // parentheses around AND/OR are canonicalized; source raw hash is retained.
  delete(a as Partial<NativeRecoverySnapshot>).catalogSHA256;delete(e as Partial<NativeRecoverySnapshot>).catalogSHA256;
 }else{
  // Earlier prototype archives remain strictly bound to their exact catalog.
  delete a.recoveryCatalogAlgorithm;delete a.recoveryCatalogSHA256;
 }
 return isDeepStrictEqual(a,e);
}
