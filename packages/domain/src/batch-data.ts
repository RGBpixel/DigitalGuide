import { z } from 'zod';
import { AppError } from './index.js';
import {templateParameters,type TemplateParameterDefinition,type TemplateParameters} from '@digitalguide/contracts';
const rowSchema = z.strictObject({ name: z.string().trim().min(1).max(100).optional(),variables: z.record(z.string(),z.string().max(1000)).optional(),parameters:templateParameters.optional() }).refine(v=>v.variables!==undefined||v.parameters!==undefined);
export interface BatchDataRow { position: number;name: string;variables: Record<string,string>;parameters?:TemplateParameters;error: string|null }
export function parseBatchData(format: 'json'|'csv',content: string,controls?:TemplateParameterDefinition[]): BatchDataRow[] {
  if (new TextEncoder().encode(content).length > 1048576) throw new AppError('BATCH_DATA_TOO_LARGE','批量数据最多1 MB，请拆分文件。',413);
  let raw: unknown[];
  if (format === 'json') { try { const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/,''));if (!Array.isArray(parsed)) throw new Error('Not array');raw = parsed; } catch { throw new AppError('INVALID_BATCH_DATA','JSON需要是[{"name":"工程名","variables":{"变量名":"文字"}}]数组。',422); } }
  else {
    const records = parseCsv(content),headers = records.shift();if (!headers?.length || headers.some(h => h !== '__name' && !/^(?:p\.)?[a-zA-Z][a-zA-Z0-9_]{0,29}$/.test(h)) || new Set(headers).size !== headers.length) throw new AppError('INVALID_BATCH_CSV','CSV表头须为文字变量名或p.参数名，可选__name表示工程名称，不能重复。',422);
    raw = records.map(record => record.length !== headers.length ? null : { ...(headers.includes('__name') && record[headers.indexOf('__name')] ? { name: record[headers.indexOf('__name')] } : {}),variables: Object.fromEntries(headers.flatMap((h,i) => h === '__name'||h.startsWith('p.') ? [] : [[h,record[i]]])),...(headers.some(h=>h.startsWith('p.'))?{parameters:Object.fromEntries(headers.flatMap((h,i)=>{if(!h.startsWith('p.'))return[];const key=h.slice(2),value=record[i],c=controls?.find(c=>c.key===key);if(value===''&&c&&c.kind!=='text')return[];return[[key,c?.kind==='number'&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):c?.kind==='boolean'&&/^(true|false)$/i.test(value)?value.toLowerCase()==='true':c?.kind==='asset'&&value.toLowerCase()==='null'?null:value]];}))}:{}) });
  }
  if (!raw.length || raw.length > 100) throw new AppError('BATCH_ROW_LIMIT','每批需要1—100项数据，请拆分后提交。',422);
  return raw.map((row,index) => { const result = rowSchema.safeParse(row);return result.success ? { position: index+1,name: result.data.name || '第'+(index+1)+'项',variables: result.data.variables||{},...(result.data.parameters!==undefined?{parameters:result.data.parameters}:{}),error: null } : { position: index+1,name: '第'+(index+1)+'项',variables: {},error: '第'+(index+1)+'项需要有效工程名称、字符串变量或类型化参数；CSV列数及类型需与表头一致。' }; });
}
function parseCsv(content: string) {
  const rows: string[][] = [];let row: string[] = [],field = '',quoted = false,closed = false;
  const endField = () => { row.push(field);field = '';closed = false; },endRow = () => { const present = !!field.length || row.length > 0 || closed;endField();if (present) rows.push(row);row = [];if (rows.length > 101) throw new AppError('BATCH_ROW_LIMIT','每批最多100项数据，请拆分CSV。',422); };
  const text = content.replace(/^\uFEFF/,'');
  for (let i = 0;i < text.length;i++) {
    const c = text[i];if (quoted) { if (c === '"') { if (text[i+1] === '"') { field += '"';i++; } else { quoted = false;closed = true; } } else field += c;continue; }
    if (c === ',') endField();else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++;endRow(); }
    else if (c === '"' && !field && !closed) quoted = true;
    else if (closed || c === '"') throw new AppError('INVALID_BATCH_CSV','CSV引号位置无效，请检查双引号、逗号和换行。',422);
    else field += c;
  }
  if (quoted) throw new AppError('INVALID_BATCH_CSV','CSV双引号未闭合，请检查文件。',422);if (field || row.length || closed) endRow();return rows;
}
