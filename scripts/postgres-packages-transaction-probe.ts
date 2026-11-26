import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativePackageTransfers} from '../packages/postgres/src/runtime-package-transfers.js';
import {transferCreateInput} from '../packages/contracts/src/index.js';
const root=process.argv[4]??process.cwd(),db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(process.argv[2]),'api',root),repo=new NativeCoreRepository(db),transfers=new NativePackageTransfers(repo),bytes=fs.readFileSync(process.argv[3]),sha256=createHash('sha256').update(bytes).digest('hex');
try{await db.transaction(async()=>{const p=await repo.principal('30000000-0000-4000-8000-000000000001'),input=transferCreateInput.parse({workspaceId:'20000000-0000-4000-8000-000000000002',kind:'package',name:'事务未提交的实际工程包',fileName:'project.zip',size:bytes.length,sha256,rightsNote:'原创合成素材独立确认用途',rightsConfirmed:true,acceptNonPortable:true});const id=await repo.idempotentResource(p,{action:'actual-package-transaction-probe',key:randomUUID(),body:{sha256},code:200},()=>transfers.create(p,input,'native-package-transaction'));await transfers.part(p,id,{index:0,contentBase64:bytes.toString('base64'),sha256});await repo.event(p.tenantId,input.workspaceId,id,'media.package_transaction_probe');const part=(await transfers.parts(id))[0];console.log(JSON.stringify({phase:'native_package_upload_staged',transferId:id,storageKey:part.storage_key}));await new Promise<void>(()=>{/* Parent SIGKILL performs the actual transactional rollback. */});});}finally{await db.close();}
