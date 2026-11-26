import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeImportWorker} from '../packages/postgres/src/runtime-import-worker.js';
const root=process.argv[3]??process.cwd(),db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(process.argv[2]),'worker',root),repo=new NativeCoreRepository(db),original=repo.event.bind(repo);
repo.event=async(...args)=>{
 await original(...args);if(args[3]!=='studio.import_review_ready')throw new Error('Unexpected document completion event');
 const importId=args[2],r=(await db.query<{status:string;result:string}>('SELECT status,result FROM studio_imports WHERE id=$1',[importId])).rows[0],media=(await db.query<{id:string;storage_key:string}>('SELECT id,storage_key FROM studio_import_media WHERE import_id=$1',[importId])).rows;
 if(r.status!=='review'||!r.result||!media.length)throw new Error('Actual document not staged');
 console.log(JSON.stringify({phase:'native_document_finish_staged',importId,mediaIds:media.map(m=>m.id),storageKeys:media.map(m=>m.storage_key)}));
 await new Promise<void>(()=>{/* Parent SIGKILL before COMMIT. Preserve the actual prior 90-second claim. */});
};
try{await new NativeImportWorker(repo,root).runOne();}finally{await db.close();}
