import {z} from 'zod';
import {safeRelative,pathKey,type RecoveryLimits} from './files.js';
import {RecoveryError} from './guard.js';
const sha=z.string().regex(/^[a-f0-9]{64}$/),integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const recoveryManifestSchema=z.object({version:z.literal(1),format:z.literal('sqlite-full-data-dir-v1'),backupId:z.uuid(),createdAt:z.iso.datetime(),dataRoot:z.string().min(1).max(2048),files:z.array(z.object({path:z.string(),bytes:integer,sha256:sha}).strict()),directories:z.array(z.string()),database:z.object({schemaSHA256:sha,tables:z.array(z.object({name:z.string().regex(/^[a-zA-Z0-9_]+$/),rows:integer,sha256:sha}).strict()),rows:integer,migrations:z.array(z.object({name:z.string().regex(/^\d{3}-[a-z0-9-]+\.sql$/),sha256:sha}).strict())}).strict(),activation:z.literal('isolated-validation-only')}).strict();
export type RecoveryManifest=z.infer<typeof recoveryManifestSchema>;
export function validateManifest(input:unknown,cap:RecoveryLimits):RecoveryManifest{
  const parsed=recoveryManifestSchema.safeParse(input);if(!parsed.success)throw new RecoveryError('RECOVERY_MANIFEST_INVALID','备份清单格式不符或缺少固定摘要。');const m=parsed.data;
  if(m.files.length+m.directories.length>cap.maxFiles||m.files.reduce((n,f)=>n+f.bytes,0)>cap.maxBytes||m.database.rows>cap.maxRows||m.database.tables.length>2048)throw new RecoveryError('RECOVERY_LIMIT_EXCEEDED','备份内容超过当前恢复限制。');
  const names=new Map<string,'file'|'directory'>();
  for(const[d,type]of [...m.directories.map(p=>[p,'directory'] as const),...m.files.map(f=>[f.path,'file'] as const)]){safeRelative(d);const key=pathKey(d);if(names.has(key))throw new RecoveryError('RECOVERY_PATH_INVALID','备份路径重复、大小写或规范化冲突。');names.set(key,type);}
  for(const name of names.keys()){const parts=name.split('/');for(let i=1;i<parts.length;i++)if(names.get(parts.slice(0,i).join('/'))!=='directory')throw new RecoveryError('RECOVERY_PATH_INVALID','备份缺少父目录或将文件作为父目录。');}
  if(!['digitalguide.sqlite','.session-secret','.provenance-secret'].every(p=>m.files.some(f=>f.path===p))||m.files.some(f=>['digitalguide.sqlite-wal','digitalguide.sqlite-shm','.dg-recovery-policy.json'].includes(f.path)))throw new RecoveryError('RECOVERY_MANIFEST_INVALID','备份缺少数据库/私有密钥，或包含不可直接恢复的运行文件。');
  if(new Set(m.database.tables.map(t=>t.name)).size!==m.database.tables.length||m.database.tables.reduce((n,t)=>n+t.rows,0)!==m.database.rows||!m.database.tables.some(t=>t.name==='schema_migrations'))throw new RecoveryError('RECOVERY_MANIFEST_INVALID','数据库表清单或行数不一致。');
  return m;
}
