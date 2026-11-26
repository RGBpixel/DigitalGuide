import fs from 'node:fs';
import path from 'node:path';
export function assertSqliteDataDirectory(dir:string){
 try{fs.lstatSync(path.join(dir,'.dg-native-postgres.json'));throw new Error('此目录属于原生PostgreSQL验证实例；请使用其显式配置，不能退回SQLite。');}catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;}
}
