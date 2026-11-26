import {createHash} from 'node:crypto';
// Native visit wire schemas have fixed ASCII keys. Match PostgreSQL's C-order
// canonical JSON for these records without changing existing hash protocols.
export function nativeVisitCanonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(nativeVisitCanonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+nativeVisitCanonical(v)).join(',')+'}';
 return JSON.stringify(value)??'null';
}
export const nativeVisitHash=(value:unknown)=>createHash('sha256').update(nativeVisitCanonical(value)).digest('hex');
