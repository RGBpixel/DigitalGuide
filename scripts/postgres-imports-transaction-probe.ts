import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeImports} from '../packages/postgres/src/runtime-imports.js';
import {studioImportInput} from '../packages/contracts/src/index.js';
const root=process.argv[4]??process.cwd(),db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(process.argv[2]),'api',root),repo=new NativeCoreRepository(db),imports=new NativeImports(repo),bytes=fs.readFileSync(process.argv[3]);
try{await db.transaction(async()=>{
 const p=await repo.principal('30000000-0000-4000-8000-000000000001'),input=studioImportInput.parse({workspaceId:'20000000-0000-4000-8000-000000000001',name:'事务未提交的实际文档',fileName:'project.pptx',contentBase64:bytes.toString('base64'),rightsNote:'程序生成虚构图文，确认本空间制作用途',rightsConfirmed:true});
 const id=await repo.idempotentResource(p,{action:'actual-document-transaction-probe',key:randomUUID(),body:input,code:200},()=>imports.create(p,input,'native-document-transaction'));
 const row=await imports.row(p,id);console.log(JSON.stringify({phase:'native_document_input_staged',importId:id,storageKey:row.storage_key}));
 await new Promise<void>(()=>{/* Parent SIGKILL rolls back input, immutable receipt, audit, event and idempotency. */});
});}finally{await db.close();}
